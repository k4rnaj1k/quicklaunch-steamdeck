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
 * Normalise an appId to its unsigned 32-bit representation.
 *
 * Why this is needed
 * ------------------
 * Non-Steam shortcuts use appIds in the range [0x80000000, 0xFFFFFFFF]
 * (i.e. the high bit is set).  Some Steam code paths — notably when the
 * appId flows through native/C++ code typed as `int32_t` — surface these
 * values in JS as signed-negative numbers (e.g. 0x80000000 comes across
 * as -2147483648, 0xFFFFFFFF as -1).
 *
 * JS bitwise operators are defined on 32-bit signed integers, but the
 * unsigned right shift `>>> 0` produces the uint32 interpretation as a
 * non-negative JS number.  Applying it is a no-op for values already in
 * the uint32 range, and a lossless bit-pattern-preserving conversion for
 * negative signed-int32 inputs:
 *
 *      -1        >>> 0 === 0xFFFFFFFF (4294967295)
 *      -0x80000000 >>> 0 === 0x80000000 (2147483648)
 *      1091500   >>> 0 === 1091500
 *
 * Use this at every entry point where an appId enters our code from an
 * external source (React-Router params, Steam router tree, RunGame
 * callers) so downstream logic can rely on `appId >= 0x80000000` for the
 * non-Steam-shortcut check without worrying about signed-negative input.
 */
export function toUnsignedAppId(appId: number): number {
  if (typeof appId !== "number" || !Number.isFinite(appId)) return appId;
  // `appId | 0` coerces to int32 first (in case the input is a non-integer
  // number), then `>>> 0` reinterprets that bit pattern as uint32.
  return (appId | 0) >>> 0;
}

/**
 * Returns true when the given appId belongs to a non-Steam shortcut.
 *
 * Non-Steam shortcuts are added via Steam's "Add Non-Steam Game" dialog.
 * They use a high appId range (>= 0x80000000) and require launchType=104
 * rather than the standard 100.
 *
 * Input is normalised via toUnsignedAppId() so signed-int32 inputs from
 * Steam internals (e.g. -1 for 0xFFFFFFFF) are classified correctly.
 */
export function isNonSteamShortcut(appId: number): boolean {
  const normalised = toUnsignedAppId(appId);
  const result = normalised >= NON_STEAM_APPID_THRESHOLD;
  console.log(
    `[QuickLaunch] isNonSteamShortcut: appId=${appId} (0x${appId.toString(16).toUpperCase()})` +
    ` normalised=${normalised} (0x${normalised.toString(16).toUpperCase()})` +
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
 *
 * Input is normalised via isNonSteamShortcut() → toUnsignedAppId() so
 * signed-int32 inputs do not cause a misclassification as "game".
 */
export function launchTypeFor(appId: number): number {
  const type = isNonSteamShortcut(appId) ? LAUNCH_TYPE_SHORTCUT : LAUNCH_TYPE_GAME;
  console.log(
    `[QuickLaunch] launchTypeFor: appId=${appId}` +
    ` (unsigned=${toUnsignedAppId(appId)})` +
    ` → launchType=${type}` +
    ` (${type === LAUNCH_TYPE_SHORTCUT ? "SHORTCUT/104" : "GAME/100"})`
  );
  return type;
}
