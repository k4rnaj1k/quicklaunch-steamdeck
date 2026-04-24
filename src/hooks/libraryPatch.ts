/**
 * libraryPatch.ts
 *
 * Detects when the Steam UI navigates to a game's detail page.
 *
 * Steam Deck's game mode uses React Router with MemoryHistory — window.location
 * never changes and history.pushState is never called.  The ONLY reliable
 * detection method is routerHook.addPatch from decky-frontend-lib, which
 * directly patches Steam's Router component and fires on every route render.
 *
 * AppId extraction uses three approaches in priority order:
 *   1. afterPatch on renderFunc args (most precise, proven technique)
 *   2. extractAppId on the tree root (handles React Router v6 shape)
 *   3. findInReactTree deep search for any appid-bearing node
 */

import { routerHook, findInReactTree, afterPatch } from "decky-frontend-lib";
import { notifyGameSelected } from "../state/pluginState";
import { extractAppId } from "../utils/routeUtils";

const LIBRARY_APP_ROUTE = "/library/app/:appid";
const PATCHED_FLAG = "__qlPatched";

// Debounce so rapid re-renders don't fire multiple bypasses.
let _lastFiredAt = 0;
const DEBOUNCE_MS = 600;

function fire(appId: number, source: string): void {
  const now = Date.now();
  if (now - _lastFiredAt < DEBOUNCE_MS) return;
  _lastFiredAt = now;
  console.log(`[QuickLaunch] bypass triggered appId=${appId} via ${source}`);
  setTimeout(() => notifyGameSelected(appId), 0);
}

// ------------------------------------------------------------------ //
// Route patch callback                                                 //
// ------------------------------------------------------------------ //

function patchLibraryRoute(tree: unknown): unknown {
  // ── Approach 1: extract from tree root (React Router v5/v6 props) ──
  const appIdFromRoot = extractAppId([tree]);
  if (appIdFromRoot && appIdFromRoot > 0) {
    fire(appIdFromRoot, "tree-root");
    return tree;
  }

  // ── Approach 2: find renderFunc and afterPatch its args ────────────
  const routeProps = findInReactTree(
    tree,
    (node: unknown) =>
      node !== null &&
      typeof node === "object" &&
      typeof (node as Record<string, unknown>)["renderFunc"] === "function",
  ) as Record<string, unknown> | null;

  if (routeProps) {
    if (!(routeProps["renderFunc"] as Record<string, unknown>)[PATCHED_FLAG]) {
      afterPatch(
        routeProps,
        "renderFunc",
        (args: unknown[], ret: unknown): unknown => {
          const appId = extractAppId(args as unknown[]);
          if (appId && appId > 0) fire(appId, "renderFunc-args");
          return ret;
        },
      );
      (routeProps["renderFunc"] as Record<string, unknown>)[PATCHED_FLAG] = true;
      console.log("[QuickLaunch] renderFunc wrapped via afterPatch.");
    }
    return tree;
  }

  // ── Approach 3: deep-search tree for any node with appid ──────────
  const nodeWithAppId = findInReactTree(
    tree,
    (node: unknown) => {
      if (!node || typeof node !== "object") return false;
      const n = node as Record<string, unknown>;
      const raw = n["appid"] ?? n["appId"] ??
        (n["params"] as Record<string, unknown> | undefined)?.["appid"] ??
        (n["match"] as Record<string, unknown> | undefined)
          ?.["params"]?.["appid"];
      return raw !== undefined && raw !== null;
    },
  ) as Record<string, unknown> | null;

  if (nodeWithAppId) {
    const raw =
      nodeWithAppId["appid"] ??
      nodeWithAppId["appId"] ??
      (nodeWithAppId["params"] as Record<string, unknown>)?.["appid"] ??
      (nodeWithAppId["match"] as Record<string, unknown>)
        ?.["params"]?.["appid"];
    const appId = parseInt(String(raw), 10);
    if (!isNaN(appId) && appId > 0) fire(appId, "deep-search");
  } else {
    console.warn("[QuickLaunch] patchLibraryRoute fired but no appId found in tree.");
  }

  return tree;
}

// ------------------------------------------------------------------ //
// Public API                                                           //
// ------------------------------------------------------------------ //

export function registerLibraryPatch(): () => void {
  const patch = routerHook.addPatch(LIBRARY_APP_ROUTE, patchLibraryRoute);
  console.log(`[QuickLaunch] Route patch registered on "${LIBRARY_APP_ROUTE}".`);

  return () => {
    routerHook.removePatch(LIBRARY_APP_ROUTE, patch);
    console.log("[QuickLaunch] Route patch removed.");
  };
}
