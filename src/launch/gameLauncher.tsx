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
 *                       → issue RunGame + navigate to /library
 * 3. Primary launch: window.SteamClient.Apps.RunGame()
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
  LAUNCH_TYPE_GAME,
  LAUNCH_TYPE_SHORTCUT,
  isNonSteamShortcut,
  launchTypeFor,
} from "../utils/launchUtils";

// ------------------------------------------------------------------ //
// Constants                                                            //
// ------------------------------------------------------------------ //

/**
 * Milliseconds to wait after issuing RunGame before navigating back.
 * A small pause ensures Steam registers the launch before the UI transitions.
 */
const NAV_DELAY_MS = 80;

/** Debounce window – ignores repeated calls within this many ms. */
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
    const type = launchTypeFor(appId);
    console.log(`[QuickLaunch] RunGame: appId=${appId} launchType=${type}`);
    window.SteamClient.Apps.RunGame(String(appId), "", type, LAUNCH_TYPE_GAME);
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
    Navigation.Navigate("/library");
  } catch (err) {
    console.warn("[QuickLaunch] Navigation.Navigate failed:", err);
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

// ------------------------------------------------------------------ //
// Debounce guard                                                       //
// ------------------------------------------------------------------ //

let _lastLaunchAt = 0;

// ------------------------------------------------------------------ //
// Public API                                                           //
// ------------------------------------------------------------------ //

/**
 * Check the game's launch state, then either:
 *   • abort (not installed) – show toast, leave detail page visible, or
 *   • bypass – launch via RunGame / URL scheme + navigate to /library.
 *
 * @param appId  The Steam appId of the selected game.
 */
export async function bypassAndLaunch(appId: number): Promise<void> {
  // Debounce: ignore rapid repeated calls for the same navigation event.
  const now = Date.now();
  if (now - _lastLaunchAt < DEBOUNCE_MS) {
    console.log(`[QuickLaunch] bypassAndLaunch debounced for appId=${appId}.`);
    return;
  }
  _lastLaunchAt = now;

  // ── Classify the app ─────────────────────────────────────────────
  const state = getAppLaunchState(appId);
  console.log(`[QuickLaunch] Launch state for appId=${appId}: ${state}`);

  // ── Handle each state ────────────────────────────────────────────
  switch (state) {
    case "not_installed":
      // Do NOT bypass: let the detail page stay so the user can install.
      toastNotInstalled();
      return; // early exit – no launch, no navigation

    case "already_running":
      // Game is running: RunGame will resume the session (bring it to focus).
      // Still navigate away from the detail page so the library reappears.
      toastResuming();
      break; // fall through to launch

    case "update_required":
      // Steam will download the update then auto-launch.  Let it proceed.
      toastUpdating();
      break; // fall through to launch

    case "launchable":
    case "unknown":
    default:
      // Normal launch or unable to determine state → proceed optimistically.
      break;
  }

  // ── Issue the launch command ──────────────────────────────────────
  const apiOk = tryRunGameAPI(appId);
  if (!apiOk) {
    tryUrlSchemeFallback(appId);
  }

  // ── Brief pause, then navigate away from the detail page ─────────
  await sleep(NAV_DELAY_MS);
  navigateToLibrary();
}
