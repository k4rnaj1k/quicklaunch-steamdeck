/**
 * gameLauncher.tsx
 *
 * Handles the core "bypass" behaviour: when a game is selected in the
 * Steam Deck library, check its launch state and immediately launch it.
 *
 * Launch strategy
 * ---------------
 * 1. Call getAppLaunchState() to classify the app (installed? running? etc.)
 * 2. Handle the state:
 *      - not_installed  → abort bypass; show toast; let detail page stay
 *                          visible so the install button remains usable
 *      - already_running / update_required / launchable / unknown
 *                       → issue RunGame; Steam's launch animation
 *                          replaces the overview automatically – no
 *                          NavigateBack required (and the previous
 *                          NavigateBack-based approach caused the
 *                          back-step / library-flash artefact)
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
import { FaRocket } from "react-icons/fa";
import { getAppLaunchState } from "./appStateChecker";
import {
  LAUNCH_TYPE_DEFAULT,
  LAUNCH_TYPE_GAME,
  launchTypeFor,
  toUnsignedAppId,
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
    // ── Normalise to uint32 ──────────────────────────────────────────
    // Non-Steam shortcut appIds exceed the int32 range (they use the
    // top bit).  Some upstream Steam paths hand these over signed-
    // negative; normalising here guarantees downstream logic and the
    // RunGame string conversion work on the correct uint32 value.
    const rawAppId      = appId;
    const unsignedAppId = toUnsignedAppId(appId);
    const signedHex     = (rawAppId < 0 ? "-0x" + Math.abs(rawAppId).toString(16).toUpperCase()
                                        :  "0x" + rawAppId.toString(16).toUpperCase());
    const unsignedHex   = "0x" + unsignedAppId.toString(16).toUpperCase();
    const inNonSteamRange = unsignedAppId >= 0x80000000;
    const wasNegative   = rawAppId < 0;
    console.log(
      `[QuickLaunch] tryRunGameAPI: received appId=${rawAppId}` +
      ` typeof=${typeof rawAppId}` +
      ` signedHex=${signedHex}` +
      ` normalised=${unsignedAppId}` +
      ` unsignedHex=${unsignedHex}` +
      ` wasNegative=${wasNegative}` +
      ` inNonSteamRange(>=0x80000000)=${inNonSteamRange}` +
      ` String(raw)="${String(rawAppId)}"` +
      ` String(normalised)="${String(unsignedAppId)}"`
    );
    if (wasNegative) {
      console.warn(
        "[QuickLaunch] tryRunGameAPI: appId arrived NEGATIVE – normalising to uint32 before RunGame." +
        ` (int32 view=${rawAppId}, uint32 view=${unsignedAppId}).`
      );
    } else if (inNonSteamRange) {
      console.log(
        `[QuickLaunch] tryRunGameAPI: appId is in expected non-Steam range` +
        ` (>= 0x80000000). ok.`
      );
    }

    if (typeof window.SteamClient?.Apps?.RunGame !== "function") {
      console.warn("[QuickLaunch] SteamClient.Apps.RunGame unavailable – falling back.");
      return false;
    }
    // arg 3 = LAUNCH_TYPE_DEFAULT (-1): always let Steam choose the launch option.
    // arg 4 = launchTypeFor(appId):     100 for Steam games, 104 for non-Steam shortcuts.
    //
    // We pass the unsigned-normalised value to both launchTypeFor and
    // RunGame so the String() coercion yields the correct base-10
    // decimal Steam expects for non-Steam shortcuts.
    const type = launchTypeFor(unsignedAppId);
    console.log(
      `[QuickLaunch] RunGame call: appId=${unsignedAppId} (${unsignedHex})` +
      ` arg1(appIdStr)="${String(unsignedAppId)}"` +
      ` arg3(launchOptionIndex)=${LAUNCH_TYPE_DEFAULT}` +
      ` arg4(launchType)=${type}` +
      ` (${type === 104 ? "SHORTCUT" : "GAME"})`
    );
    window.SteamClient.Apps.RunGame(String(unsignedAppId), "", LAUNCH_TYPE_DEFAULT, type);
    console.log(`[QuickLaunch] RunGame: call returned without throwing for appId=${unsignedAppId}.`);
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
  // Normalise to uint32 so a signed-negative non-Steam appId does not
  // produce a "steam://rungameid/-1" URL, which Steam rejects.
  const unsignedAppId = toUnsignedAppId(appId);
  const url = `steam://rungameid/${unsignedAppId}`;
  console.log(
    `[QuickLaunch] Fallback URL scheme: ${url}` +
    (appId !== unsignedAppId ? ` (normalised from ${appId})` : "")
  );
  window.open(url, "_self");
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
 * Checks the app's launch state and shows any appropriate toast.  No
 * navigation is performed here – Steam's launch animation will replace
 * the overview / library when `bypassAndLaunch` issues `RunGame`.
 *
 * Must be called in the same synchronous call-stack as the interception
 * point (`history.push` patch, `Navigation.Navigate` patch, or the
 * route-patch `useLayoutEffect`).
 *
 * @returns `true` if the caller should proceed to launch the game,
 *          `false` if the bypass was aborted (game not installed, or
 *          a duplicate fire was debounced).
 */
export function prepareBypass(appId: number): boolean {
  // Normalise once, at the earliest synchronous entry point, so every
  // subsequent comparison, lookup, and downstream call works with the
  // unsigned uint32 appId.  Without this the debounce cache would miss
  // on a sign-flipped repeat and state/launch lookups would fail for
  // non-Steam shortcuts whose int32 view is negative.
  const rawAppId = appId;
  appId = toUnsignedAppId(appId);
  console.log(
    `[QuickLaunch] prepareBypass: entry rawAppId=${rawAppId}` +
    ` normalised=${appId} (0x${appId.toString(16).toUpperCase()})`
  );
  if (rawAppId !== appId) {
    console.warn(
      `[QuickLaunch] prepareBypass: normalised int32-signed appId` +
      ` ${rawAppId} → uint32 ${appId} (non-Steam shortcut bit pattern).`
    );
  }

  // Per-appId debounce: suppress only if the same game fires again
  // within the window (multiple strategies may observe the same press
  // – e.g. Strategy 0 catches a push that Strategy 2 then re-observes
  // when the route renders).  A different appId always bypasses the
  // guard immediately.
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
      console.log(
        `[QuickLaunch] prepareBypass: aborting for appId=${appId} – not_installed` +
        " (overview kept visible so the install button remains usable)"
      );
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

  console.log(`[QuickLaunch] prepareBypass: returning true for appId=${appId}.`);
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
 * when the plugin IIFE first runs.  Steam's launch animation will
 * cover the overview as soon as `RunGame` resolves, so the user sees
 * a smooth transition into gameplay rather than a back-step pop.
 *
 * @param appId  The Steam appId of the game to launch.
 */
export async function bypassAndLaunch(appId: number): Promise<void> {
  // Normalise once at the public async entry point so every downstream
  // call (tryRunGameAPI, tryUrlSchemeFallback) sees the uint32 form and
  // so log lines reference a consistent value.
  const rawAppId = appId;
  appId = toUnsignedAppId(appId);
  if (rawAppId !== appId) {
    console.warn(
      `[QuickLaunch] bypassAndLaunch: normalised int32-signed appId` +
      ` ${rawAppId} → uint32 ${appId} at async entry.`
    );
  }

  // ── Attempt 1 ────────────────────────────────────────────────────
  if (tryRunGameAPI(appId)) return;

  // ── Retry after 200 ms ───────────────────────────────────────────
  // SteamClient may simply not have been ready yet on the first call;
  // the user sees a brief overview frame, then the launch animation
  // takes over once the second attempt succeeds.
  console.log(`[QuickLaunch] RunGame unavailable for appId=${appId} – retrying in 200 ms.`);
  await sleep(200);

  // ── Attempt 2 ────────────────────────────────────────────────────
  if (tryRunGameAPI(appId)) return;

  // ── Fallback – steam:// URL scheme ───────────────────────────────
  console.warn(`[QuickLaunch] RunGame still unavailable for appId=${appId} – using URL fallback.`);
  tryUrlSchemeFallback(appId);
}
