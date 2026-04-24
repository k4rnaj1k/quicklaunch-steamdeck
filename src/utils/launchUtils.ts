/**
 * launchUtils.ts
 *
 * Pure utility functions for determining how to launch a Steam app.
 * Extracted into a standalone module so they can be unit-tested without
 * importing browser-only APIs (Navigation, toaster, SteamClient, etc.).
 */

/**
 * Steam appId threshold above which an id belongs to a non-Steam shortcut
 * (added via "Add Non-Steam Game").
 *
 * Steam uses the range [0x80000000, 0xFFFFFFFF] for non-Steam shortcuts.
 * Regular Steam games always have appIds below this threshold.
 */
export const NON_STEAM_APPID_THRESHOLD = 0x80000000; // 2 147 483 648

/**
 * launchType constants for the 4th argument of SteamClient.Apps.RunGame.
 *
 * RunGame signature (as observed from Steam's internal UI code):
 *   RunGame(appId: string, launchData: string, launchOptionIndex: number, launchType: number)
 *
 *   launchOptionIndex (arg 3):
 *     -1  → LAUNCH_TYPE_DEFAULT: let Steam pick the launch option (always correct)
 *
 *   launchType (arg 4):
 *     100 → LAUNCH_TYPE_GAME:     standard Steam game / Proton title
 *     104 → LAUNCH_TYPE_SHORTCUT: non-Steam shortcut added via "Add Non-Steam Game"
 *
 * Always use LAUNCH_TYPE_DEFAULT for arg 3.  Use launchTypeFor() for arg 4.
 */
export const LAUNCH_TYPE_DEFAULT  = -1;  // arg 3: always use this (let Steam decide)
export const LAUNCH_TYPE_GAME     = 100; // arg 4: standard Steam game / Proton
export const LAUNCH_TYPE_SHORTCUT = 104; // arg 4: non-Steam shortcut

/**
 * Returns true when the given appId belongs to a non-Steam shortcut.
 *
 * Non-Steam shortcuts are added via Steam's "Add Non-Steam Game" dialog.
 * They use a high appId range (>= 0x80000000) and require launchType=104
 * rather than the standard 100.
 */
export function isNonSteamShortcut(appId: number): boolean {
  const result = appId >= NON_STEAM_APPID_THRESHOLD;
  console.log(
    `[QuickLaunch] isNonSteamShortcut: appId=${appId} (0x${appId.toString(16).toUpperCase()})` +
    ` threshold=0x${NON_STEAM_APPID_THRESHOLD.toString(16).toUpperCase()}` +
    ` → ${result ? "NON-STEAM SHORTCUT" : "steam game"}`
  );
  return result;
}

/**
 * Determine the correct launchType for SteamClient.Apps.RunGame based on
 * the appId.
 *
 * - Regular Steam games (native Linux or Proton): 100
 * - Non-Steam shortcuts:                          104
 */
export function launchTypeFor(appId: number): number {
  const type = isNonSteamShortcut(appId) ? LAUNCH_TYPE_SHORTCUT : LAUNCH_TYPE_GAME;
  console.log(
    `[QuickLaunch] launchTypeFor: appId=${appId}` +
    ` → launchType=${type}` +
    ` (${type === LAUNCH_TYPE_SHORTCUT ? "SHORTCUT/104" : "GAME/100"})`
  );
  return type;
}
