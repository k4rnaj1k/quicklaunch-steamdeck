/**
 * gameLauncher.ts
 *
 * Handles the core "bypass" behaviour: when a game is selected in the
 * Steam Deck library, immediately launch it and navigate away from the
 * game detail / preview page so the user never has to interact with it.
 *
 * Launch strategy
 * ---------------
 * 1. Call window.SteamClient.Apps.RunGame() – the same internal API Steam
 *    uses when the user presses Play on the detail page.
 * 2. Navigate back to /library so the detail page disappears while the
 *    game loads (Steam will switch focus to the game session automatically).
 *
 * Fallback strategy
 * -----------------
 * If SteamClient.Apps.RunGame is not available (future SteamOS API change),
 * we fall back to the steam://rungameid/<appId> URL scheme, which Valve
 * supports for external invocations and is very stable across versions.
 *
 * Launch type constants
 * ---------------------
 * These are the values the Steam UI itself uses for the launchType parameter.
 * Passing the wrong value can result in the game not launching or launching
 * with the wrong Proton layer, so we detect the app type before calling.
 *
 *   LAUNCH_TYPE_DEFAULT  (-1)  – let Steam decide (safe fallback)
 *   LAUNCH_TYPE_GAME    (100)  – normal Steam game / Proton game
 *   LAUNCH_TYPE_SHORTCUT(104)  – non-Steam shortcut (added via "Add Non-Steam Game")
 *
 * Non-Steam shortcuts use a different appId range (>= 0x80000000 / 2147483648).
 * We detect this heuristically to pick the right launch type.
 */

import { Navigation } from "@decky/api";
import "../types/steamClient.d";

// ------------------------------------------------------------------ //
// Constants                                                            //
// ------------------------------------------------------------------ //

/** Steam appId threshold above which an id is a non-Steam shortcut. */
const NON_STEAM_APPID_THRESHOLD = 0x80000000; // 2 147 483 648

/** launchType values passed to SteamClient.Apps.RunGame. */
const LAUNCH_TYPE_DEFAULT = -1;
const LAUNCH_TYPE_GAME = 100;
const LAUNCH_TYPE_SHORTCUT = 104;

/**
 * Milliseconds to wait after issuing RunGame before navigating back.
 * A small pause ensures Steam has registered the launch request before
 * the UI transitions away.
 */
const NAV_DELAY_MS = 80;

// ------------------------------------------------------------------ //
// Helpers                                                              //
// ------------------------------------------------------------------ //

function isNonSteamShortcut(appId: number): boolean {
  return appId >= NON_STEAM_APPID_THRESHOLD;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine the correct launchType for RunGame based on the appId.
 * Edge-case handling (e.g. Play / Continue prompts) is left to the next task.
 */
function launchTypeFor(appId: number): number {
  if (isNonSteamShortcut(appId)) return LAUNCH_TYPE_SHORTCUT;
  return LAUNCH_TYPE_GAME;
}

// ------------------------------------------------------------------ //
// Primary launch path – SteamClient.Apps.RunGame                      //
// ------------------------------------------------------------------ //

/**
 * Launch via the internal SteamClient API.
 * Returns true on success, false if the API is unavailable.
 */
function tryRunGameAPI(appId: number): boolean {
  try {
    if (
      typeof window.SteamClient?.Apps?.RunGame !== "function"
    ) {
      console.warn(
        "[QuickLaunch] SteamClient.Apps.RunGame not available – will fall back."
      );
      return false;
    }

    const type = launchTypeFor(appId);
    console.log(
      `[QuickLaunch] RunGame: appId=${appId} launchType=${type}`
    );

    window.SteamClient.Apps.RunGame(String(appId), "", type, LAUNCH_TYPE_GAME);
    return true;
  } catch (err) {
    console.error("[QuickLaunch] RunGame threw:", err);
    return false;
  }
}

// ------------------------------------------------------------------ //
// Fallback launch path – steam:// URL scheme                          //
// ------------------------------------------------------------------ //

/**
 * Fallback: open the steam://rungameid URL scheme.
 * This works for both Steam games and non-Steam shortcuts.
 */
function tryUrlSchemeFallback(appId: number): void {
  const url = `steam://rungameid/${appId}`;
  console.log(`[QuickLaunch] Fallback URL scheme: ${url}`);
  window.open(url, "_self");
}

// ------------------------------------------------------------------ //
// Navigation – exit the detail page                                   //
// ------------------------------------------------------------------ //

/**
 * Navigate back to the library root.
 * We use Navigation.Navigate (from @decky/api) rather than history.back()
 * so the Steam router handles the transition cleanly and the detail page
 * doesn't remain in the forward-history stack.
 */
function navigateToLibrary(): void {
  try {
    Navigation.Navigate("/library");
  } catch (err) {
    // Navigation can fail if Steam's router is mid-transition; log and ignore.
    console.warn("[QuickLaunch] Navigation.Navigate failed:", err);
  }
}

// ------------------------------------------------------------------ //
// Debounce guard                                                       //
// ------------------------------------------------------------------ //

/**
 * Timestamp of the last launch attempt.  Prevents double-fires that can
 * occur when the route patch triggers more than once for the same navigation
 * (e.g. on React strict-mode double-render during development).
 */
let _lastLaunchAt = 0;
const DEBOUNCE_MS = 500;

// ------------------------------------------------------------------ //
// Public API                                                           //
// ------------------------------------------------------------------ //

/**
 * Bypass the game detail page and immediately launch the specified game.
 *
 * Call this from the onGameSelected handler (index.tsx) when the library
 * route patch detects that the user has selected a game.
 *
 * @param appId  The Steam appId of the selected game.
 */
export async function bypassAndLaunch(appId: number): Promise<void> {
  // Debounce: ignore rapid repeated calls for the same navigation event.
  const now = Date.now();
  if (now - _lastLaunchAt < DEBOUNCE_MS) {
    console.log(
      `[QuickLaunch] bypassAndLaunch debounced for appId=${appId}.`
    );
    return;
  }
  _lastLaunchAt = now;

  console.log(`[QuickLaunch] Bypassing detail page – launching appId=${appId}`);

  // 1. Issue the launch command.
  const apiOk = tryRunGameAPI(appId);
  if (!apiOk) {
    tryUrlSchemeFallback(appId);
  }

  // 2. Brief pause so Steam registers the launch before we navigate.
  await sleep(NAV_DELAY_MS);

  // 3. Navigate back to the library – the detail page disappears.
  navigateToLibrary();
}
