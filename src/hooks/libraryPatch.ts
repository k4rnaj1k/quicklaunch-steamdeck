/**
 * libraryPatch.ts
 *
 * Detects when the Steam UI navigates to a game's detail page and fires
 * notifyGameSelected() so the bypass logic can run.
 *
 * Four complementary detection strategies are layered so that at least
 * one fires on every SteamOS/Decky version combination:
 *
 *   0.  Router.history.push patch – intercepts the push *before* the
 *       location commits.  The push is swallowed for launchable games so
 *       the overview page is never entered and NavigateBack is not needed.
 *       Best strategy; eliminates the overview flash entirely.
 *
 *   0b. Navigation.Navigate patch – same pre-commit semantics as
 *       Strategy 0, but covers the @decky/ui code path.  Some SteamOS
 *       versions route the "A on tile" action through
 *       Navigation.Navigate(path) rather than Router.history.push(path);
 *       this strategy catches those.  Per-appId debounce in fire()
 *       prevents double-firing if Steam ever calls both for the same press.
 *
 *   1.  Router.history.listen()  – fires *after* the location changes.
 *       NavigateBack() is required to dismiss the overview.  Fallback when
 *       Strategies 0 / 0b are unavailable or when they let the push through
 *       (not-installed case handled upstream; debounce blocks double-fire).
 *
 *   2.  routerHook.addPatch()    – patches the /library/app/:appid route's
 *       render tree.  Fires at render time.  Last-resort fallback.
 */

import { routerHook } from "@decky/api";
import { Router, Navigation } from "@decky/ui";
import { notifyGameSelected } from "../state/pluginState";
import { extractAppId } from "../utils/routeUtils";
import { toUnsignedAppId } from "../utils/launchUtils";

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
  // Normalise at the module boundary so the debounce cache and the
  // downstream listener always work on the uint32 form.  Non-Steam
  // shortcut appIds (>= 0x80000000) may arrive signed-negative when
  // they flow through Steam internals typed as int32.
  const rawAppId = appId;
  appId = toUnsignedAppId(appId);
  if (rawAppId !== appId) {
    console.warn(
      `[QuickLaunch] fire: normalised int32-signed appId ${rawAppId}` +
      ` → uint32 ${appId} (source=${source}).`
    );
  }

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
  // A navigation event has reached render-time, which means Router (and
  // therefore Router.history) must be live by now.  Give Strategy 0 an
  // opportunity to install itself immediately so subsequent navigations
  // are caught pre-commit even if the initial backoff attempts all
  // ran before Router.history was populated.
  retryHistoryPushPatchNow();

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
    const parsed = parseInt(String(raw), 10);
    // Non-Steam shortcut appIds may arrive signed-negative (int32 view of
    // a uint32 >= 0x80000000).  Normalise before the zero check so they
    // are accepted here and passed through to fire(), which also
    // normalises defensively.
    const appId  = isNaN(parsed) ? NaN : toUnsignedAppId(parsed);
    if (!isNaN(appId) && appId !== 0) fire(appId, "deep-search", true);
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
  console.log("[QuickLaunch] tryPatchHistoryPush: entry – attempting to patch Router.history.push/replace.");
  try {
    const routerRecord = Router as unknown as Record<string, unknown> | undefined;
    console.log(
      `[QuickLaunch] tryPatchHistoryPush: Router=${routerRecord ? "present" : "MISSING"}` +
      ` history=${routerRecord?.["history"] ? "present" : "MISSING"}`
    );

    const history = routerRecord?.["history"] as
      | (Record<string, unknown> & { push: (...a: unknown[]) => void; replace?: (...a: unknown[]) => void })
      | undefined;

    if (!history || typeof history["push"] !== "function") {
      console.warn(
        "[QuickLaunch] Router.history.push not available for patching." +
        ` history=${history ? "object" : "undefined"}` +
        ` push=${typeof history?.["push"]}`
      );
      return null;
    }

    const originalPush    = history["push"].bind(history);
    const originalReplace = typeof history["replace"] === "function"
      ? (history["replace"] as (...a: unknown[]) => void).bind(history)
      : null;

    console.log(
      `[QuickLaunch] tryPatchHistoryPush: capturing originals –` +
      ` push=${typeof originalPush} replace=${originalReplace ? "fn" : "absent"}`
    );

    function intercept(
      original: (...a: unknown[]) => void,
      location: unknown,
      state?: unknown,
      kind: string = "push",
    ): void {
      const pathname =
        typeof location === "string"
          ? location
          : (location as Record<string, unknown> | null)?.["pathname"] as string | undefined;

      console.log(
        `[QuickLaunch] Strategy 0 intercept fired (${kind}):` +
        ` pathname=${pathname ?? "<none>"}` +
        ` locationType=${typeof location}`
      );

      if (pathname) {
        const m = pathname.match(GAME_ROUTE_RE);
        if (m) {
          const appId = parseInt(m[1], 10);
          console.log(
            `[QuickLaunch] Strategy 0: matched game route – rawMatch="${m[1]}"` +
            ` parsedAppId=${appId}`
          );
          if (appId > 0) {
            // navigate=false: we are about to block the push, so the
            // overview page will never be entered and NavigateBack is wrong.
            const bypassed = fire(appId, "history-push", false);
            console.log(
              `[QuickLaunch] Strategy 0: fire() returned bypassed=${bypassed} for appId=${appId}` +
              ` – ${bypassed ? "SWALLOWING" : "forwarding"} ${kind}`
            );
            if (bypassed) {
              // Push swallowed – user stays on current page, game launches.
              return;
            }
            // Bypass aborted (e.g. not installed) – let the push through.
          } else {
            console.warn(
              `[QuickLaunch] Strategy 0: matched game route but parsed appId<=0 (${appId}) – forwarding ${kind}`
            );
          }
        } else {
          // Not a game route – nothing to do; forward silently.
        }
      }
      original(location, state);
    }

    history["push"] = (location: unknown, state?: unknown) =>
      intercept(originalPush, location, state, "push");

    if (originalReplace) {
      history["replace"] = (location: unknown, state?: unknown) =>
        intercept(originalReplace, location, state, "replace");
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
// Strategy 0 – deferred retry wrapper                                  //
// ------------------------------------------------------------------ //

/**
 * Backoff schedule used when Router.history is not yet available at
 * plugin init.  Each entry is the delay (ms) before the next attempt.
 * Total coverage: ~5.6 s after plugin init, which comfortably exceeds
 * the longest observed Router bootstrap time.
 */
const PUSH_PATCH_RETRY_DELAYS_MS = [0, 100, 300, 700, 1500, 3000];

// Module-scope state shared between the deferred-backoff retries and the
// navigation-triggered retry.  These guard against double-installation
// (which would stack wrappers on the already-patched push fn).
let _pushPatchInstalled = false;
let _pushPatchCancelled = false;
let _pushPatchRestore: (() => void) | null = null;
let _pushPatchRetryHandle: ReturnType<typeof setTimeout> | null = null;
let _pushPatchAttempt = 0;

/**
 * Attempts to install the Strategy 0 push patch once.  If Router.history
 * is not available yet, schedules further retries with backoff.  Returns
 * a cleanup function that cancels pending retries and restores any
 * successfully-installed patch.
 *
 * Additionally, Strategies 1 and 2 call retryHistoryPushPatchNow() when a
 * navigation event fires – by that time Router.history is guaranteed to
 * exist, so the patch can be installed synchronously for any subsequent
 * navigations (the current one will not benefit, but rapid repeat
 * A-presses will).
 */
function registerHistoryPushPatch(): () => void {
  _pushPatchInstalled   = false;
  _pushPatchCancelled   = false;
  _pushPatchRestore     = null;
  _pushPatchRetryHandle = null;
  _pushPatchAttempt     = 0;

  function runAttempt(): void {
    _pushPatchRetryHandle = null;
    if (_pushPatchCancelled || _pushPatchInstalled) return;

    _pushPatchAttempt += 1;
    console.log(
      `[QuickLaunch] Strategy 0 patch: attempt #${_pushPatchAttempt}` +
      ` of ${PUSH_PATCH_RETRY_DELAYS_MS.length}.`
    );
    const restore = tryPatchHistoryPush();
    if (restore) {
      _pushPatchInstalled = true;
      _pushPatchRestore   = restore;
      console.log(
        `[QuickLaunch] Strategy 0 patch: installed on attempt #${_pushPatchAttempt}.`
      );
      return;
    }
    scheduleNextRetry();
  }

  function scheduleNextRetry(): void {
    if (_pushPatchCancelled || _pushPatchInstalled) return;
    if (_pushPatchAttempt >= PUSH_PATCH_RETRY_DELAYS_MS.length) {
      console.warn(
        "[QuickLaunch] Strategy 0 patch: giving up after" +
        ` ${PUSH_PATCH_RETRY_DELAYS_MS.length} attempts.` +
        " Strategies 1 & 2 will continue to handle game-page detection." +
        " Navigation events will also trigger one more retry attempt."
      );
      return;
    }
    const delay = PUSH_PATCH_RETRY_DELAYS_MS[_pushPatchAttempt];
    console.log(
      `[QuickLaunch] Strategy 0 patch: scheduling retry #${_pushPatchAttempt + 1}` +
      ` in ${delay} ms.`
    );
    _pushPatchRetryHandle = setTimeout(runAttempt, delay);
  }

  // Kick off the first attempt immediately.
  scheduleNextRetry();

  return () => {
    _pushPatchCancelled = true;
    if (_pushPatchRetryHandle !== null) {
      clearTimeout(_pushPatchRetryHandle);
      _pushPatchRetryHandle = null;
      console.log("[QuickLaunch] Strategy 0 patch: pending retry cancelled during cleanup.");
    }
    if (_pushPatchRestore) {
      try {
        _pushPatchRestore();
      } catch (err) {
        console.warn("[QuickLaunch] Strategy 0 cleanup error:", err);
      }
      _pushPatchRestore = null;
    }
    _pushPatchInstalled = false;
    _pushPatchAttempt   = 0;
  };
}

/**
 * Attempts an immediate patch install when triggered by a navigation
 * event (from Strategy 1 or 2).  A no-op if the patch is already
 * installed or cleanup has been requested.
 *
 * This covers the edge case where Router.history only becomes available
 * after plugin init but before any of the scheduled backoff retries
 * fire – without this path, the very first navigation would still be
 * caught only by Strategies 1/2 (post-commit, overview flashes).
 */
function retryHistoryPushPatchNow(): void {
  if (_pushPatchInstalled || _pushPatchCancelled) return;
  if (_pushPatchRetryHandle !== null) {
    clearTimeout(_pushPatchRetryHandle);
    _pushPatchRetryHandle = null;
  }
  console.log(
    "[QuickLaunch] Strategy 0 patch: navigation-triggered retry (Router.history is now proven live)."
  );
  _pushPatchAttempt += 1;
  const restore = tryPatchHistoryPush();
  if (restore) {
    _pushPatchInstalled = true;
    _pushPatchRestore   = restore;
    console.log(
      `[QuickLaunch] Strategy 0 patch: installed via navigation-triggered retry` +
      ` (attempt #${_pushPatchAttempt}).`
    );
  } else {
    console.warn(
      "[QuickLaunch] Strategy 0 patch: navigation-triggered retry still could not install patch." +
      " Continuing with Strategies 1 & 2."
    );
  }
}

// ------------------------------------------------------------------ //
// Strategy 0b – patch Navigation.Navigate (pre-commit, complementary) //
// ------------------------------------------------------------------ //

/**
 * Some SteamOS / @decky/ui versions route the "A on tile" action through
 * `Navigation.Navigate(path)` rather than `Router.history.push(path)`.
 * Strategy 0 misses this entirely, leaving Strategies 1 / 2 to clean up
 * post-commit – which is exactly the flash the user reports.
 *
 * This patch wraps `Navigation.Navigate` with the same intercept logic
 * as Strategy 0: if the destination is a game-detail route, we fire the
 * bypass with `navigate=false` (so no NavigateBack is needed) and swallow
 * the call when the bypass succeeds.  Otherwise the call is forwarded
 * unchanged.
 *
 * The patch is additive – Strategy 0 stays in place, both can coexist
 * without interfering (the per-appId debounce in `fire()` blocks any
 * double-fire if Steam happens to call both Navigation.Navigate AND
 * Router.history.push for the same press).
 *
 * Returns a cleanup function that restores the original, or null if
 * Navigation.Navigate is unavailable.
 */
function tryPatchNavigationNavigate(): (() => void) | null {
  console.log("[QuickLaunch] tryPatchNavigationNavigate: entry – attempting to patch Navigation.Navigate.");
  try {
    const navRecord = Navigation as unknown as Record<string, unknown> | undefined;
    console.log(
      `[QuickLaunch] tryPatchNavigationNavigate: Navigation=${navRecord ? "present" : "MISSING"}` +
      ` Navigate=${typeof navRecord?.["Navigate"]}`
    );

    if (!navRecord || typeof navRecord["Navigate"] !== "function") {
      console.warn(
        "[QuickLaunch] Navigation.Navigate not available for patching." +
        ` Navigation=${navRecord ? "object" : "undefined"}` +
        ` Navigate=${typeof navRecord?.["Navigate"]}`
      );
      return null;
    }

    const original = (navRecord["Navigate"] as (...a: unknown[]) => void).bind(Navigation);

    navRecord["Navigate"] = (location: unknown, ...rest: unknown[]) => {
      const pathname =
        typeof location === "string"
          ? location
          : (location as Record<string, unknown> | null)?.["pathname"] as string | undefined;

      console.log(
        `[QuickLaunch] Strategy 0b intercept fired (Navigation.Navigate):` +
        ` pathname=${pathname ?? "<none>"} locationType=${typeof location}`
      );

      if (pathname) {
        const m = pathname.match(GAME_ROUTE_RE);
        if (m) {
          const appId = parseInt(m[1], 10);
          console.log(
            `[QuickLaunch] Strategy 0b: matched game route – rawMatch="${m[1]}"` +
            ` parsedAppId=${appId}`
          );
          if (appId > 0) {
            // navigate=false: we are about to block the call, so the
            // overview page is never entered and NavigateBack is wrong.
            const bypassed = fire(appId, "navigation-navigate", false);
            console.log(
              `[QuickLaunch] Strategy 0b: fire() returned bypassed=${bypassed} for appId=${appId}` +
              ` – ${bypassed ? "SWALLOWING" : "forwarding"} Navigation.Navigate`
            );
            if (bypassed) {
              // Call swallowed – user stays on current page, game launches.
              return;
            }
            // Bypass aborted (e.g. not installed) – let the call through.
          } else {
            console.warn(
              `[QuickLaunch] Strategy 0b: matched game route but parsed appId<=0 (${appId})` +
              ` – forwarding Navigation.Navigate`
            );
          }
        }
      }
      return original(location, ...rest);
    };

    console.log("[QuickLaunch] Navigation.Navigate patched (Strategy 0b).");

    return () => {
      navRecord["Navigate"] = original;
      console.log("[QuickLaunch] Navigation.Navigate restored.");
    };
  } catch (err) {
    console.warn("[QuickLaunch] tryPatchNavigationNavigate error:", err);
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
        // A navigation event has fired – Router.history is demonstrably
        // alive.  Give Strategy 0 a chance to install itself right now so
        // subsequent navigations are caught pre-commit.
        retryHistoryPushPatchNow();

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
  //
  // registerHistoryPushPatch() returns a cleanup unconditionally: if the
  // initial patch attempt fails (Router.history not yet available at
  // plugin IIFE time), it schedules retries with backoff AND re-attempts
  // on any subsequent navigation event observed via Strategies 1 or 2.
  const unpatchPush = registerHistoryPushPatch();
  cleanups.push(unpatchPush);

  // ── Strategy 0b: patch Navigation.Navigate (pre-commit, complementary) ──
  // Some SteamOS versions route the "A on tile" action through
  // Navigation.Navigate(path) rather than Router.history.push(path).
  // Strategy 0 misses these; Strategy 0b catches them with the same
  // pre-commit semantics.  Per-appId debounce in fire() prevents any
  // double-firing if Steam ever calls both for the same press.
  const unpatchNavigate = tryPatchNavigationNavigate();
  if (unpatchNavigate) {
    cleanups.push(unpatchNavigate);
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
