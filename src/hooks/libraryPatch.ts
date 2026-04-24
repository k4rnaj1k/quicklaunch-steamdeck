/**
 * libraryPatch.ts
 *
 * Detects when the Steam UI navigates to a game's detail page and fires
 * notifyGameSelected() so the bypass logic can run.
 *
 * Two complementary detection strategies are used so that at least one
 * fires on every SteamOS/Decky version combination:
 *
 *   1. Router.history.listen()   – hooks into the React-Router MemoryHistory
 *      directly.  Fires on every pathname change including home-screen taps.
 *      This is the most reliable strategy on Decky / @decky/ui ≥ 4.x.
 *
 *   2. routerHook.addPatch()     – patches the /library/app/:appid route's
 *      render tree.  Fires at render time and provides the appId from the
 *      route params.  Acts as backup when history.listen is unavailable.
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
// Debounce guard                                                       //
// ------------------------------------------------------------------ //

let _lastFiredAt = 0;
const DEBOUNCE_MS = 600;

function fire(appId: number, source: string): void {
  const now = Date.now();
  if (now - _lastFiredAt < DEBOUNCE_MS) return;
  _lastFiredAt = now;
  console.log(`[QuickLaunch] bypass triggered appId=${appId} via ${source}`);
  notifyGameSelected(appId);
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
    fire(appIdFromRoot, "tree-root");
    return tree;
  }

  // ── Approach 2: find renderFunc node and wrap it ──────────────────
  const routeNode = findInTree(tree, (n) => typeof n["renderFunc"] === "function");
  if (routeNode && !(routeNode["renderFunc"] as TreeNode)[PATCHED_FLAG]) {
    const original = routeNode["renderFunc"] as (...args: unknown[]) => unknown;
    routeNode["renderFunc"] = function (...args: unknown[]) {
      const ret = original.apply(this as unknown, args);
      const appId = extractAppId(args);
      if (appId && appId > 0) fire(appId, "renderFunc-args");
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
    if (!isNaN(appId) && appId > 0) fire(appId, "deep-search");
  } else {
    console.warn("[QuickLaunch] patchLibraryRoute fired but no appId found in tree.");
  }

  return tree;
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
        if (appId > 0) fire(appId, "history-listen");
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

  // ── Strategy 1: history listener ─────────────────────────────────
  const unlistenHistory = tryRegisterHistoryListener();
  if (unlistenHistory) {
    cleanups.push(unlistenHistory);
  }

  // ── Strategy 2: routerHook route patch ───────────────────────────
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
