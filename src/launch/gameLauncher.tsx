/**
 * gameLauncher.tsx
 *
 * Handles the core "bypass" behaviour: when a game is selected in the
 * Steam Deck library, check its launch state, then immediately launch it
 * and navigate away from the game detail / preview page.
 *
 * Launch strategy
 * ---------------
 * 1. Call getAppLaunchState() to classify the app (installed? running? etc.)
 * 2. Handle the state:
 *      - not_installed  → abort bypass; show toast; let detail page stay
 *      - already_running / update_required / launchable / unknown
 *                       → issue RunGame first, then navigate to /library
 * 3. Primary launch: window.SteamClient.Apps.RunGame()  ← called BEFORE NavigateBack
 *    Fallback launch:  steam://rungameid/<appId> URL scheme
 *
 * Launch type constants
 * ---------------------
 *   LAUNCH_TYPE_DEFAULT  (-1)  – let Steam decide (safe for multi-option games)
 *   LAUNCH_TYPE_GAME    (100)  – normal Steam game / Proton game
 *   LAUNCH_TYPE_SHORTCUT(104)  – non-Steam shortcut (appId >= 0x80000000)
 */

import React from "react";
import { toaster } from "@decky/api";
import { Navigation } from "@decky/ui";
import { FaRocket } from "react-icons/fa";
import { getAppLaunchState } from "./appStateChecker";
import {
  LAUNCH_TYPE_DEFAULT,
  LAUNCH_TYPE_GAME,
  launchTypeFor,
} from "../utils/launchUtils";

// ------------------------------------------------------------------ //
// Constants                                                            //
// ------------------------------------------------------------------ //

/**
 * Suppress duplicate launches for the **same** appId within this window.
 * A different appId passes through immediately so rapid A-presses on
 * two different games are never swallowed.
 */
const DEBOUNCE_MS = 500;

// ------------------------------------------------------------------ //
// Helpers                                                              //
// ------------------------------------------------------------------ //

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------------ //
// Primary launch – SteamClient.Apps.RunGame                           //
// ------------------------------------------------------------------ //

function tryRunGameAPI(appId: number): boolean {
  try {
    if (typeof window.SteamClient?.Apps?.RunGame !== "function") {
      console.warn("[QuickLaunch] SteamClient.Apps.RunGame unavailable – falling back.");
      return false;
    }
    // arg 3 = LAUNCH_TYPE_DEFAULT (-1): always let Steam choose the launch option.
    // arg 4 = launchTypeFor(appId):     100 for Steam games, 104 for non-Steam shortcuts.
    const type = launchTypeFor(appId);
    console.log(
      `[QuickLaunch] RunGame call: appId=${appId}` +
      ` arg3(launchOptionIndex)=${LAUNCH_TYPE_DEFAULT}` +
      ` arg4(launchType)=${type}`
    );
    window.SteamClient.Apps.RunGame(String(appId), "", LAUNCH_TYPE_DEFAULT, type);
    return true;
  } catch (err) {
    console.error("[QuickLaunch] RunGame threw:", err);
    return false;
  }
}

// ------------------------------------------------------------------ //
// Fallback – steam:// URL scheme                                       //
// ------------------------------------------------------------------ //

function tryUrlSchemeFallback(appId: number): void {
  const url = `steam://rungameid/${appId}`;
  console.log(`[QuickLaunch] Fallback URL scheme: ${url}`);
  window.open(url, "_self");
}

// ------------------------------------------------------------------ //
// Navigation                                                           //
// ------------------------------------------------------------------ //

function navigateToLibrary(): void {
  try {
    Navigation.NavigateBack();
  } catch (err) {
    console.warn("[QuickLaunch] NavigateBack failed:", err);
  }
}

// ------------------------------------------------------------------ //
// Toast helpers                                                        //
// ------------------------------------------------------------------ //

function toastNotInstalled(): void {
  toaster.toast({
    title: "QuickLaunch",
    body: "Game not installed – open the game page to install it first.",
    icon: <FaRocket />,
    duration: 4000,
  });
}

function toastResuming(): void {
  toaster.toast({
    title: "QuickLaunch",
    body: "Resuming game session…",
    icon: <FaRocket />,
    duration: 2000,
  });
}

function toastUpdating(): void {
  toaster.toast({
    title: "QuickLaunch",
    body: "Update pending – Steam will launch the game once it finishes.",
    icon: <FaRocket />,
    duration: 3000,
  });
}

function toastLaunching(): void {
  toaster.toast({
    title: "QuickLaunch",
    body: "Launching…",
    icon: <FaRocket />,
    duration: 2000,
  });
}

// ------------------------------------------------------------------ //
// Debounce guard                                                       //
// ------------------------------------------------------------------ //

let _lastLaunchAppId = -1;
let _lastLaunchAt    = 0;

// ------------------------------------------------------------------ //
// Public API                                                           //
// ------------------------------------------------------------------ //

/**
 * Synchronous first half of the bypass.
 *
 * Checks the app's launch state, shows any appropriate toast, and —
 * when navigateBack is true — calls NavigateBack() immediately so the
 * overview page is dismissed before React finishes rendering it.
 *
 * Pass navigateBack=false when the caller has already blocked the
 * history push so the overview was never entered; NavigateBack is then
 * unnecessary and would pop the wrong entry.
 *
 * Must be called in the same synchronous call-stack as the interception
 * point (history.push patch or history.listen callback).
 *
 * @param navigateBack  Whether to call NavigateBack() (default true).
 * @returns `true` if the caller should proceed to launch the game,
 *          `false` if the bypass was aborted (game not installed).
 */
export function prepareBypass(appId: number, navigateBack = true): boolean {
  // Per-appId debounce: suppress only if the same game fires again
  // within the window (e.g. history-listen + routerHook both trigger).
  // A different appId always bypasses the guard immediately.
  const now = Date.now();
  if (appId === _lastLaunchAppId && now - _lastLaunchAt < DEBOUNCE_MS) {
    console.log(`[QuickLaunch] prepareBypass debounced for appId=${appId}.`);
    return false;
  }
  _lastLaunchAppId = appId;
  _lastLaunchAt    = now;

  // ── Classify the app ─────────────────────────────────────────────
  const state = getAppLaunchState(appId);
  console.log(`[QuickLaunch] Launch state for appId=${appId}: ${state}`);

  // ── Handle each state ────────────────────────────────────────────
  switch (state) {
    case "not_installed":
      // Abort: keep the detail page visible so the user can install.
      toastNotInstalled();
      return false;

    case "already_running":
      toastResuming();
      break;

    case "update_required":
      toastUpdating();
      break;

    case "launchable":
    case "unknown":
    default:
      // Normal launch – confirm to the user that the bypass fired.
      toastLaunching();
      break;
  }

  // ── Navigate back synchronously (fallback strategies only) ──────────
  // When the history.push was blocked upstream, the user never left the
  // current page so NavigateBack is not needed (and would be wrong).
  if (navigateBack) {
    navigateToLibrary();
  }
  return true;
}

/**
 * Async second half of the bypass: issues the RunGame command.
 *
 * Must be called only after prepareBypass() returns true.
 *
 * Launch sequence:
 *   1. Try SteamClient.Apps.RunGame() immediately.
 *   2. If the API is not yet available, wait 200 ms and try once more.
 *   3. If both attempts fail, fall back to the steam://rungameid/ URL scheme.
 *
 * The retry handles the case where SteamClient is still initialising
 * when the plugin IIFE first runs; NavigateBack has already fired
 * synchronously so this delay never affects the UI transition.
 *
 * @param appId  The Steam appId of the game to launch.
 */
export async function bypassAndLaunch(appId: number): Promise<void> {
  // ── Attempt 1 ────────────────────────────────────────────────────
  if (tryRunGameAPI(appId)) return;

  // ── Retry after 200 ms ───────────────────────────────────────────
  // NavigateBack already ran synchronously, so this delay is invisible
  // to the user.  SteamClient may simply not have been ready yet.
  console.log(`[QuickLaunch] RunGame unavailable for appId=${appId} – retrying in 200 ms.`);
  await sleep(200);

  // ── Attempt 2 ────────────────────────────────────────────────────
  if (tryRunGameAPI(appId)) return;

  // ── Fallback – steam:// URL scheme ───────────────────────────────
  console.warn(`[QuickLaunch] RunGame still unavailable for appId=${appId} – using URL fallback.`);
  tryUrlSchemeFallback(appId);
}
