/**
 * libraryPatch.ts
 *
 * Detects when the Steam UI navigates to a game's detail page and fires
 * notifyGameSelected() so the bypass logic can run.
 *
 * Three complementary detection strategies are layered so that at least
 * one fires on every SteamOS/Decky version combination:
 *
 *   0.  Router.history.push patch – intercepts the push *before* the
 *       location commits.  The push is swallowed for launchable games so
 *       the overview page is never entered.  Best strategy on builds
 *       where Steam routes "A on tile" through Router.history.push.
 *
 *   0b. Navigation.Navigate patch – same pre-commit semantics as Strategy
 *       0, but covers the @decky/ui code path.  Some SteamOS versions
 *       route the "A on tile" action through Navigation.Navigate(path)
 *       rather than Router.history.push(path); this strategy catches
 *       those.  Per-appId debounce in fire() prevents double-firing.
 *
 *   2.  routerHook.addPatch() – injects a tiny <QuickLaunchAutoLauncher>
 *       component into the /library/app/:appid render tree that fires
 *       `notifyGameSelected` from a useLayoutEffect.  The effect runs
 *       before paint, so when Steam's launch animation kicks in quickly
 *       enough the overview content is never visibly committed to the
 *       screen.  Last-resort fallback when Strategies 0 / 0b miss.
 *
 * The previous Strategy 1 (Router.history.listen) has been removed –
 * it only existed to drive NavigateBack, which we no longer call.
 * Steam's own launch animation now covers the overview, so post-commit
 * fallbacks are no longer needed.
 */

import React, { useLayoutEffect } from "react";
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
 * @returns The boolean returned by the game-selected listener.
 */
function fire(appId: number, source: string): boolean {
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
  console.log(`[QuickLaunch] bypass triggered appId=${appId} via ${source}`);
  return notifyGameSelected(appId);
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
// AppId extraction (for Strategy 2)                                    //
// ------------------------------------------------------------------ //

/**
 * Best-effort appId lookup against the route's render tree.  Returns
 * 0 if no appId can be located – the caller treats that as "skip".
 *
 * Tried in order:
 *   1. extractAppId() on the tree root (covers React-Router v5/v6
 *      where the params live on the route element directly).
 *   2. Deep search for any node carrying `appid` / `appId`, including
 *      `match.params.appid` for older React-Router shapes.
 */
function extractAppIdFromRouteTree(tree: unknown): number {
  // Approach 1: extractAppId on tree root (React-Router v5/v6).
  const appIdFromRoot = extractAppId([tree]);
  if (appIdFromRoot && appIdFromRoot > 0) {
    return toUnsignedAppId(appIdFromRoot);
  }

  // Approach 2: deep-search for any node carrying appid info.
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
    if (!isNaN(parsed)) {
      const normalised = toUnsignedAppId(parsed);
      if (normalised !== 0) return normalised;
    }
  }

  return 0;
}

// ------------------------------------------------------------------ //
// Strategy 2 – <QuickLaunchAutoLauncher> useLayoutEffect injection    //
// ------------------------------------------------------------------ //

/**
 * Tiny invisible component injected at the top of the route tree.
 * Its `useLayoutEffect` fires after React commits the DOM but before
 * the browser paints the next frame, so on most devices the overview
 * content is never visibly committed to the screen – Steam's launch
 * animation replaces it before paint.
 *
 * Renders `null` so it adds no DOM, no pixels, no styling impact.
 *
 * The effect only re-fires when `appId` changes (React reconciliation
 * with key=`ql-${appId}` would also force a remount on appId change),
 * so a route re-render with the same appId does not retrigger fire().
 * Combined with the per-appId debounce in fire(), this provides two
 * independent layers of double-trigger protection.
 */
const QuickLaunchAutoLauncher: React.FC<{ appId: number }> = ({ appId }) => {
  useLayoutEffect(() => {
    if (appId > 0) {
      console.log(
        `[QuickLaunch] Strategy 2 (useLayoutEffect): firing for appId=${appId}.`
      );
      fire(appId, "useLayoutEffect");
    }
  }, [appId]);
  return null;
};

// ------------------------------------------------------------------ //
// Strategy 2 – route patch callback                                    //
// ------------------------------------------------------------------ //

function patchLibraryRoute(tree: unknown): unknown {
  // A navigation event has reached render-time, which means Router (and
  // therefore Router.history) must be live by now.  Give Strategy 0 an
  // opportunity to install itself immediately so subsequent navigations
  // are caught pre-commit even if the initial backoff attempts all
  // ran before Router.history was populated.
  retryHistoryPushPatchNow();

  const appId = extractAppIdFromRouteTree(tree);
  if (appId <= 0) {
    console.warn("[QuickLaunch] patchLibraryRoute fired but no appId found in tree.");
    return tree;
  }

  // Inject the auto-launcher above the original tree.  Using a key tied
  // to the appId guarantees React remounts the component (and re-runs
  // useLayoutEffect) whenever the user navigates between two different
  // games without the route element itself unmounting first.
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(QuickLaunchAutoLauncher, { key: `ql-${appId}`, appId }),
    tree as React.ReactNode,
  );
}

// ------------------------------------------------------------------ //
// Strategy 0 – patch Router.history.push / replace (pre-commit)      //
// ------------------------------------------------------------------ //

/**
 * Monkey-patches Router.history.push (and .replace) so we intercept
 * game-page navigations *before* the location commits.
 *
 * When a game route is detected:
 *   • fire() is called.
 *   • If the bypass succeeds (game is launchable) the push is dropped
 *     and the user never leaves the current page – Steam's launch
 *     animation takes over.
 *   • If the bypass is aborted (game not installed) the original push
 *     is forwarded so the detail page opens normally and the user can
 *     hit the Install button.
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
            const bypassed = fire(appId, "history-push");
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
 * Additionally, Strategy 2 calls retryHistoryPushPatchNow() when a
 * navigation event reaches render-time – by that time Router.history is
 * guaranteed to exist, so the patch can be installed synchronously for
 * any subsequent navigations (the current one will not benefit, but
 * rapid repeat A-presses will).
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
        " Strategies 0b & 2 will continue to handle game-page detection." +
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
 * event (from Strategy 2).  A no-op if the patch is already installed
 * or cleanup has been requested.
 *
 * This covers the edge case where Router.history only becomes available
 * after plugin init but before any of the scheduled backoff retries
 * fire – without this path, the very first navigation would still be
 * caught only by Strategy 2.
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
      " Continuing with Strategies 0b & 2."
    );
  }
}

// ------------------------------------------------------------------ //
// Strategy 0b – patch Navigation.Navigate (pre-commit, complementary) //
// ------------------------------------------------------------------ //

/**
 * Some SteamOS / @decky/ui versions route the "A on tile" action through
 * `Navigation.Navigate(path)` rather than `Router.history.push(path)`.
 * Strategy 0 misses this entirely; Strategy 0b catches it with the same
 * pre-commit semantics.
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
            const bypassed = fire(appId, "navigation-navigate");
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
// Public API                                                           //
// ------------------------------------------------------------------ //

export function registerLibraryPatch(): () => void {
  const cleanups: Array<() => void> = [];

  // ── Strategy 0: patch history.push/replace (pre-commit, best) ────
  // Intercepts navigation before the location commits, so the overview
  // page is never entered.
  //
  // registerHistoryPushPatch() returns a cleanup unconditionally: if the
  // initial patch attempt fails (Router.history not yet available at
  // plugin IIFE time), it schedules retries with backoff AND re-attempts
  // on any subsequent navigation event observed via Strategy 2.
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

  // ── Strategy 2: routerHook route patch (useLayoutEffect injection) ──
  // The injected <QuickLaunchAutoLauncher> fires fire() from a
  // useLayoutEffect, which runs after React commits the DOM but before
  // the next browser paint.  When this fires Steam's launch animation
  // typically replaces the overview before any of its content is
  // visibly committed to the screen.
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
