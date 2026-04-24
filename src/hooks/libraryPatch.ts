/**
 * libraryPatch.ts
 *
 * Detects when the Steam UI navigates to a game's detail page by patching
 * window.history.pushState — the underlying browser API that React Router
 * calls for every client-side navigation.  This is version-agnostic: it
 * works regardless of the SteamOS React Router version or the exact route
 * path string used internally.
 *
 * We also keep a routerHook.addPatch as a secondary signal in case Steam
 * routes the navigation differently on some firmware versions.
 *
 * Detection: /library/app/<appid> in the pushed URL
 * Navigation back: window.history.back() — always reliable
 */

import { routerHook } from "@decky/api";
import { notifyGameSelected } from "../state/pluginState";

const LIBRARY_APP_ROUTE = "/library/app/:appid";
const APP_PATH_RE = /\/library\/app\/(\d+)/;

// ------------------------------------------------------------------ //
// Helpers                                                              //
// ------------------------------------------------------------------ //

function tryExtractAndFire(url: string | URL | null | undefined): void {
  if (!url) return;
  const str = typeof url === "string" ? url : url.toString();
  const match = str.match(APP_PATH_RE);
  if (!match) return;

  const appId = parseInt(match[1], 10);
  if (isNaN(appId) || appId <= 0) return;

  console.log(`[QuickLaunch] detected navigation to appId=${appId}`);
  setTimeout(() => notifyGameSelected(appId), 0);
}

// ------------------------------------------------------------------ //
// Public API                                                           //
// ------------------------------------------------------------------ //

export function registerLibraryPatch(): () => void {
  // ── Primary: intercept pushState ────────────────────────────────────
  // React Router calls history.pushState for every SPA navigation.
  // Patching here catches the navigation before any route component renders.
  const originalPushState = window.history.pushState.bind(window.history);

  window.history.pushState = function (
    state: unknown,
    title: string,
    url?: string | URL | null,
  ) {
    const result = originalPushState(state, title, url);
    tryExtractAndFire(url);
    return result;
  };

  // ── Secondary: routerHook.addPatch ───────────────────────────────────
  // Fires during React render of the matched route — catches cases where
  // Steam uses replaceState instead of pushState, or for re-renders.
  const routerPatch = routerHook.addPatch(
    LIBRARY_APP_ROUTE,
    (tree: unknown) => {
      // At render time the URL should already be updated.
      tryExtractAndFire(window.location.pathname);
      return tree;
    },
  );

  console.log("[QuickLaunch] Library patch registered (pushState + routerHook).");

  // ── Cleanup ──────────────────────────────────────────────────────────
  return () => {
    window.history.pushState = originalPushState;
    routerHook.removePatch(LIBRARY_APP_ROUTE, routerPatch);
    console.log("[QuickLaunch] Library patch removed.");
  };
}
