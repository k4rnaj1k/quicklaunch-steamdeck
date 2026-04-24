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
 * launchType constants passed to SteamClient.Apps.RunGame.
 * These mirror the values the Steam UI uses internally.
 */
export const LAUNCH_TYPE_GAME = 100;     // Standard Steam game / Proton
export const LAUNCH_TYPE_SHORTCUT = 104; // Non-Steam shortcut

/**
 * Returns true when the given appId belongs to a non-Steam shortcut.
 *
 * Non-Steam shortcuts are added via Steam's "Add Non-Steam Game" dialog.
 * They use a high appId range (>= 0x80000000) and require launchType=104
 * rather than the standard 100.
 */
export function isNonSteamShortcut(appId: number): boolean {
  return appId >= NON_STEAM_APPID_THRESHOLD;
}

/**
 * Determine the correct launchType for SteamClient.Apps.RunGame based on
 * the appId.
 *
 * - Regular Steam games (native Linux or Proton): 100
 * - Non-Steam shortcuts:                          104
 */
export function launchTypeFor(appId: number): number {
  return isNonSteamShortcut(appId) ? LAUNCH_TYPE_SHORTCUT : LAUNCH_TYPE_GAME;
}
