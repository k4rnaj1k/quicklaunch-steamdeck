/**
 * libraryPatch.ts
 *
 * Registers a Decky routerHook patch on the Steam library game-detail route
 * (/library/app/:appid).  Every time the Steam UI navigates to a game's
 * detail page (i.e. the user selects / highlights a game and presses A),
 * the patch fires, extracts the numeric appId from the React router tree,
 * and calls notifyGameSelected().
 *
 * Detection mechanism
 * -------------------
 * Steam's game-mode UI is a React SPA.  When the user selects a game in
 * the library grid, the router navigates to /library/app/<appid>.
 * routerHook.addPatch lets us intercept that navigation and receive the
 * React element tree for the matched route before it is committed to the
 * DOM.  We use findInReactTree + afterPatch (from decky-frontend-lib) to
 * wrap the route's renderFunc and read the appId out of the route params
 * that Steam passes as the first argument.
 *
 * Lifecycle
 * ---------
 *   registerLibraryPatch()  →  call from plugin onMount
 *   returned cleanup fn     →  call from plugin onDismount
 */

import { routerHook } from "@decky/api";
// findInReactTree / afterPatch live in decky-frontend-lib (re-exported by
// @decky/ui in some Decky versions – fall back to direct import if needed).
import { findInReactTree, afterPatch } from "decky-frontend-lib";

import { notifyGameSelected } from "../state/pluginState";
import { extractAppId } from "../utils/routeUtils";

// ------------------------------------------------------------------ //
// Constants                                                            //
// ------------------------------------------------------------------ //

/** The Steam router path for a game's detail / preview page. */
const LIBRARY_APP_ROUTE = "/library/app/:appid";

/** Symbol used to flag a renderFunc that has already been patched. */
const PATCHED_FLAG = "__qlLibraryPatched";

// extractAppId is imported from ../utils/routeUtils (see above).

// ------------------------------------------------------------------ //
// Route patcher                                                        //
// ------------------------------------------------------------------ //

/**
 * Called by Decky's routerHook for every render cycle on the
 * /library/app/:appid route.  Wraps the route's renderFunc once (guarded
 * by PATCHED_FLAG) so we don't double-wrap on re-renders.
 */
function patchLibraryRoute(tree: unknown): unknown {
  // Find the node that owns the renderFunc – this is the route element
  // returned by Steam's router that actually renders the game detail page.
  const routeProps = findInReactTree(
    tree,
    (node: unknown) =>
      node !== null &&
      typeof node === "object" &&
      typeof (node as Record<string, unknown>)["renderFunc"] === "function"
  ) as Record<string, unknown> | null;

  if (!routeProps) {
    console.warn("[QuickLaunch] libraryPatch: could not find renderFunc in route tree.");
    return tree;
  }

  // Guard: only wrap once per renderFunc instance.
  if ((routeProps["renderFunc"] as Record<string, unknown>)[PATCHED_FLAG]) {
    return tree;
  }

  afterPatch(
    routeProps,
    "renderFunc",
    (args: unknown[], ret: unknown): unknown => {
      const appId = extractAppId(args as unknown[]);

      if (appId !== null) {
        notifyGameSelected(appId);
      } else {
        console.warn(
          "[QuickLaunch] libraryPatch: renderFunc fired but appId could not be extracted.",
          args
        );
      }

      // Always return the original React element unchanged – detection only.
      // The *bypass* (navigating away / launching the game) is handled in
      // the next task and will augment this same patch point.
      return ret;
    }
  );

  // Mark so we don't re-wrap on subsequent route renders.
  (routeProps["renderFunc"] as Record<string, unknown>)[PATCHED_FLAG] = true;

  console.log("[QuickLaunch] libraryPatch: renderFunc wrapped successfully.");
  return tree;
}

// ------------------------------------------------------------------ //
// Public API                                                           //
// ------------------------------------------------------------------ //

/**
 * Register the library route patch with Decky's routerHook.
 *
 * @returns A cleanup function that removes the patch – call it from
 *          the plugin's onDismount to prevent memory leaks.
 *
 * @example
 *   // In definePlugin → onMount:
 *   const removeLibraryPatch = registerLibraryPatch();
 *   cleanupHooks.push(removeLibraryPatch);
 */
export function registerLibraryPatch(): () => void {
  const patch = routerHook.addPatch(LIBRARY_APP_ROUTE, patchLibraryRoute);

  console.log(
    `[QuickLaunch] Registered library route patch on "${LIBRARY_APP_ROUTE}".`
  );

  return () => {
    routerHook.removePatch(LIBRARY_APP_ROUTE, patch);
    console.log("[QuickLaunch] Removed library route patch.");
  };
}
