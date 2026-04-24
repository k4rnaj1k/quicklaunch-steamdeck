/**
 * libraryPatch.ts
 *
 * Detects when the Steam UI navigates to a game's detail page using
 * routerHook.addPatch from @decky/api and extracts the appId from the
 * React element tree via three fallback approaches.
 */

import { routerHook } from "@decky/api";
import { notifyGameSelected } from "../state/pluginState";
import { extractAppId } from "../utils/routeUtils";

const LIBRARY_APP_ROUTE = "/library/app/:appid";
const PATCHED_FLAG = "__qlPatched";

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
// Simple recursive React-tree search (replaces findInReactTree)       //
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
// Route patch callback                                                 //
// ------------------------------------------------------------------ //

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
