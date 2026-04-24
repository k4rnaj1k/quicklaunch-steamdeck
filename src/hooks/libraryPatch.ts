/**
 * libraryPatch.ts
 *
 * Detects when the Steam UI navigates to a game's detail page and fires
 * notifyGameSelected() so the bypass logic can run.
 *
 * Three complementary detection strategies are layered so that at least
 * one fires on every SteamOS/Decky version combination:
 *
 *   0. Router.history.push patch – intercepts the push *before* the
 *      location commits.  The push is swallowed for launchable games so
 *      the overview page is never entered and NavigateBack is not needed.
 *      Best strategy; eliminates the overview flash entirely.
 *
 *   1. Router.history.listen()   – fires *after* the location changes.
 *      NavigateBack() is required to dismiss the overview.  Fallback when
 *      Strategy 0 is unavailable or when Strategy 0 lets the push through
 *      (not-installed case handled upstream; debounce blocks double-fire).
 *
 *   2. routerHook.addPatch()     – patches the /library/app/:appid route's
 *      render tree.  Fires at render time.  Last-resort fallback.
 */

import { routerHook } from "@decky/api";
import { Router } from "@decky/ui";
import { notifyGameSelected } from "../state/pluginState";
import { extractAppId } from "../utils/routeUtils";

// ------------------------------------------------------------------ //
// Route patterns                                                       //
// ------------------------------------------------------------------ //

const LIBRARY_APP_ROUTE = "/library/app/:appid";

/** Regex covering all known game-detail paths across SteamOS versions. */
const GAME_ROUTE_RE =
  /^(?:\/library\/app\/|\/appdetails\/)(\d+)/;

// ------------------------------------------------------------------ //
// Debounce guard (per-appId)                                          //
// ------------------------------------------------------------------ //

/**
 * Suppress duplicate fires for the **same** appId within this window.
 * A different appId always passes through immediately so that rapid
 * A-presses on two different games are never swallowed.
 */
const DEBOUNCE_MS = 600;
let _lastFiredAppId = -1;
let _lastFiredAt   = 0;

/**
 * Debounce-guarded notification.
 *
 * @param navigate  Forwarded to notifyGameSelected / prepareBypass.
 *                  false = push was blocked (no NavigateBack needed).
 *                  true  = navigation already committed (NavigateBack needed).
 * @returns The boolean returned by the game-selected listener.
 */
function fire(appId: number, source: string, navigate: boolean): boolean {
  const now = Date.now();
  if (appId === _lastFiredAppId && now - _lastFiredAt < DEBOUNCE_MS) return false;
  _lastFiredAppId = appId;
  _lastFiredAt    = now;
  console.log(`[QuickLaunch] bypass triggered appId=${appId} via ${source} navigate=${navigate}`);
  return notifyGameSelected(appId, navigate);
}

// ------------------------------------------------------------------ //
// Simple recursive React-tree search                                  //
// ------------------------------------------------------------------ //

type TreeNode = Record<string, unknown>;

function findInTree(
  tree: unknown,
  predicate: (n: TreeNode) => boolean,
  depth = 0,
): TreeNode | null {
  if (depth > 25 || tree === null || tree === undefined) return null;
  if (typeof tree !== "object") return null;
  if (Array.isArray(tree)) {
    for (const item of tree) {
      const found = findInTree(item, predicate, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = tree as TreeNode;
  if (predicate(obj)) return obj;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === "object") {
      const found = findInTree(val, predicate, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// ------------------------------------------------------------------ //
// Route patch callback (strategy 2)                                   //
// ------------------------------------------------------------------ //

const PATCHED_FLAG = "__qlPatched";

function patchLibraryRoute(tree: unknown): unknown {
  // ── Approach 1: extractAppId on tree root (React Router v5/v6) ────
  const appIdFromRoot = extractAppId([tree]);
  if (appIdFromRoot && appIdFromRoot > 0) {
    fire(appIdFromRoot, "tree-root", true);
    return tree;
  }

  // ── Approach 2: find renderFunc node and wrap it ──────────────────
  const routeNode = findInTree(tree, (n) => typeof n["renderFunc"] === "function");
  if (routeNode && !(routeNode["renderFunc"] as TreeNode)[PATCHED_FLAG]) {
    const original = routeNode["renderFunc"] as (...args: unknown[]) => unknown;
    routeNode["renderFunc"] = function (...args: unknown[]) {
      const ret = original.apply(this as unknown, args);
      const appId = extractAppId(args);
      if (appId && appId > 0) fire(appId, "renderFunc-args", true);
      return ret;
    };
    (routeNode["renderFunc"] as TreeNode)[PATCHED_FLAG] = true;
    return tree;
  }

  // ── Approach 3: deep-search for any node carrying appid ───────────
  const nodeWithId = findInTree(tree, (n) => {
    const params = n["params"] as TreeNode | undefined;
    const match  = n["match"]  as TreeNode | undefined;
    const matchParams = match?.["params"] as TreeNode | undefined;
    return (
      n["appid"] !== undefined ||
      n["appId"] !== undefined ||
      params?.["appid"] !== undefined ||
      matchParams?.["appid"] !== undefined
    );
  });

  if (nodeWithId) {
    const params      = nodeWithId["params"]  as TreeNode | undefined;
    const match       = nodeWithId["match"]   as TreeNode | undefined;
    const matchParams = match?.["params"]     as TreeNode | undefined;
    const raw =
      nodeWithId["appid"] ??
      nodeWithId["appId"] ??
      params?.["appid"] ??
      matchParams?.["appid"];
    const appId = parseInt(String(raw), 10);
    if (!isNaN(appId) && appId > 0) fire(appId, "deep-search", true);
  } else {
    console.warn("[QuickLaunch] patchLibraryRoute fired but no appId found in tree.");
  }

  return tree;
}

// ------------------------------------------------------------------ //
// Strategy 0 – patch Router.history.push / replace (pre-commit)      //
// ------------------------------------------------------------------ //

/**
 * Monkey-patches Router.history.push (and .replace) so we intercept
 * game-page navigations *before* the location commits.
 *
 * When a game route is detected:
 *   • fire() is called with navigate=false (no NavigateBack needed – we
 *     swallow the push entirely so the user never leaves the current page).
 *   • If the bypass succeeds (game is launchable) the push is dropped.
 *   • If the bypass is aborted (game not installed) the original push
 *     is forwarded so the detail page opens normally.
 *
 * Returns a cleanup function that restores the originals, or null if
 * the history object is unavailable.
 */
function tryPatchHistoryPush(): (() => void) | null {
  try {
    const history = (Router as unknown as Record<string, unknown>)?.["history"] as
      | (Record<string, unknown> & { push: (...a: unknown[]) => void; replace?: (...a: unknown[]) => void })
      | undefined;

    if (!history || typeof history["push"] !== "function") {
      console.warn("[QuickLaunch] Router.history.push not available for patching.");
      return null;
    }

    const originalPush    = history["push"].bind(history);
    const originalReplace = typeof history["replace"] === "function"
      ? (history["replace"] as (...a: unknown[]) => void).bind(history)
      : null;

    function intercept(
      original: (...a: unknown[]) => void,
      location: unknown,
      state?: unknown,
    ): void {
      const pathname =
        typeof location === "string"
          ? location
          : (location as Record<string, unknown> | null)?.["pathname"] as string | undefined;

      if (pathname) {
        const m = pathname.match(GAME_ROUTE_RE);
        if (m) {
          const appId = parseInt(m[1], 10);
          if (appId > 0) {
            // navigate=false: we are about to block the push, so the
            // overview page will never be entered and NavigateBack is wrong.
            const bypassed = fire(appId, "history-push", false);
            if (bypassed) {
              // Push swallowed – user stays on current page, game launches.
              return;
            }
            // Bypass aborted (e.g. not installed) – let the push through.
          }
        }
      }
      original(location, state);
    }

    history["push"] = (location: unknown, state?: unknown) =>
      intercept(originalPush, location, state);

    if (originalReplace) {
      history["replace"] = (location: unknown, state?: unknown) =>
        intercept(originalReplace, location, state);
    }

    console.log("[QuickLaunch] Router.history.push/replace patched (Strategy 0).");

    return () => {
      history["push"] = originalPush;
      if (originalReplace) history["replace"] = originalReplace;
      console.log("[QuickLaunch] Router.history.push/replace restored.");
    };
  } catch (err) {
    console.warn("[QuickLaunch] tryPatchHistoryPush error:", err);
    return null;
  }
}

// ------------------------------------------------------------------ //
// Strategy 1 – Router.history.listen()                                //
// ------------------------------------------------------------------ //

function tryRegisterHistoryListener(): (() => void) | null {
  try {
    // @decky/ui v4+ exposes the React-Router instance as `Router`.
    // Its `.history` is a MemoryHistory whose pathname reflects the
    // current in-app route (window.location doesn't change on the Deck).
    const history = (Router as unknown as Record<string, unknown>)?.["history"];
    if (!history || typeof (history as Record<string, unknown>)["listen"] !== "function") {
      console.warn("[QuickLaunch] Router.history.listen not available.");
      return null;
    }

    // React-Router v5 history.listen signature:
    //   listen((location: Location, action: Action) => void): UnregisterCallback
    const unlisten = (history as { listen: (cb: (loc: unknown) => void) => () => void }).listen(
      (location: unknown) => {
        // location may be a Location object or a string depending on RR version.
        const pathname =
          typeof location === "string"
            ? location
            : (location as Record<string, unknown>)?.["pathname"] as string | undefined;

        if (!pathname) return;

        const m = pathname.match(GAME_ROUTE_RE);
        if (!m) return;

        const appId = parseInt(m[1], 10);
        // history.listen fires after the push commits → NavigateBack needed.
        if (appId > 0) fire(appId, "history-listen", true);
      }
    );

    if (typeof unlisten !== "function") {
      console.warn("[QuickLaunch] Router.history.listen did not return a cleanup fn.");
      return null;
    }

    console.log("[QuickLaunch] Router.history.listen registered.");
    return unlisten;
  } catch (err) {
    console.warn("[QuickLaunch] tryRegisterHistoryListener error:", err);
    return null;
  }
}

// ------------------------------------------------------------------ //
// Public API                                                           //
// ------------------------------------------------------------------ //

export function registerLibraryPatch(): () => void {
  const cleanups: Array<() => void> = [];

  // ── Strategy 0: patch history.push/replace (pre-commit, best) ────
  // Intercepts navigation before the location commits, so the overview
  // page is never entered and NavigateBack is not needed.
  const unpatchPush = tryPatchHistoryPush();
  if (unpatchPush) {
    cleanups.push(unpatchPush);
  }

  // ── Strategy 1: history.listen (post-commit fallback) ────────────
  // Fires after the location has changed; NavigateBack is required.
  // Registered even when Strategy 0 succeeded – the per-appId debounce
  // prevents double-firing since a blocked push never changes the location.
  const unlistenHistory = tryRegisterHistoryListener();
  if (unlistenHistory) {
    cleanups.push(unlistenHistory);
  }

  // ── Strategy 2: routerHook route patch (render-time fallback) ────
  try {
    const patch = routerHook.addPatch(LIBRARY_APP_ROUTE, patchLibraryRoute);
    cleanups.push(() => routerHook.removePatch(LIBRARY_APP_ROUTE, patch));
    console.log(`[QuickLaunch] Route patch registered on "${LIBRARY_APP_ROUTE}".`);
  } catch (err) {
    console.warn("[QuickLaunch] routerHook.addPatch failed:", err);
  }

  return () => {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (err) {
        console.warn("[QuickLaunch] Cleanup error:", err);
      }
    }
    console.log("[QuickLaunch] Library patch removed.");
  };
}
