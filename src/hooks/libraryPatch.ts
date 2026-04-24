/**
 * libraryPatch.ts
 *
 * Registers a Decky routerHook patch on the Steam library game-detail route
 * (/library/app/:appid).  When Steam navigates to a game's detail page
 * (user selects a game and presses A), the patch fires, reads the appId
 * from the current URL, and schedules the bypass via setTimeout so it runs
 * outside the React render cycle.
 *
 * Why URL-based detection instead of findInReactTree/afterPatch:
 *   The React tree structure varies across SteamOS versions — findInReactTree
 *   looking for a renderFunc node is fragile and silently no-ops when the
 *   node shape changes.  Reading window.location.pathname is version-agnostic
 *   and always reliable when the route has matched.
 */

import { routerHook } from "@decky/api";
import { notifyGameSelected } from "../state/pluginState";

/** The Steam router path for a game's detail / preview page. */
const LIBRARY_APP_ROUTE = "/library/app/:appid";

/** Regex to pull the numeric appId out of the current pathname. */
const APP_PATH_RE = /\/library\/app\/(\d+)/;

// ------------------------------------------------------------------ //
// Route patcher                                                        //
// ------------------------------------------------------------------ //

function patchLibraryRoute(tree: unknown): unknown {
  const match = window.location.pathname.match(APP_PATH_RE);
  if (!match) {
    console.warn("[QuickLaunch] libraryPatch: route fired but pathname did not match.", window.location.pathname);
    return tree;
  }

  const appId = parseInt(match[1], 10);
  if (isNaN(appId) || appId <= 0) {
    console.warn("[QuickLaunch] libraryPatch: parsed appId is invalid:", match[1]);
    return tree;
  }

  console.log(`[QuickLaunch] libraryPatch: detected appId=${appId}, scheduling bypass.`);

  // Defer outside the render cycle so React doesn't see a navigation
  // triggered synchronously during a route render.
  setTimeout(() => notifyGameSelected(appId), 0);

  return tree;
}

// ------------------------------------------------------------------ //
// Public API                                                           //
// ------------------------------------------------------------------ //

export function registerLibraryPatch(): () => void {
  const patch = routerHook.addPatch(LIBRARY_APP_ROUTE, patchLibraryRoute);
  console.log(`[QuickLaunch] Registered library route patch on "${LIBRARY_APP_ROUTE}".`);

  return () => {
    routerHook.removePatch(LIBRARY_APP_ROUTE, patch);
    console.log("[QuickLaunch] Removed library route patch.");
  };
}
