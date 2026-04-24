/**
 * launchUtils.test.ts
 *
 * Tests for isNonSteamShortcut() and launchTypeFor() – the functions that
 * classify a Steam appId and select the correct RunGame launch type.
 *
 * Game-type coverage:
 *   - Native Linux games    (appId < 0x80000000, launchType = 100)
 *   - Proton games          (appId < 0x80000000, launchType = 100)
 *   - Non-Steam shortcuts   (appId >= 0x80000000, launchType = 104)
 */

import {
  NON_STEAM_APPID_THRESHOLD,
  LAUNCH_TYPE_GAME,
  LAUNCH_TYPE_SHORTCUT,
  isNonSteamShortcut,
  launchTypeFor,
} from "../utils/launchUtils";

// ------------------------------------------------------------------ //
// isNonSteamShortcut                                                   //
// ------------------------------------------------------------------ //

describe("isNonSteamShortcut", () => {
  describe("Steam games (should return false)", () => {
    const steamGames: [string, number][] = [
      ["Half-Life 2 (native Linux)", 220],
      ["Team Fortress 2 (native Linux)", 440],
      ["Dota 2 (native Linux)", 570],
      ["Cyberpunk 2077 (Proton)", 1091500],
      ["Elden Ring (Proton)", 1245620],
      ["appId just below threshold", NON_STEAM_APPID_THRESHOLD - 1],
    ];

    it.each(steamGames)("%s – appId %i", (_name, appId) => {
      expect(isNonSteamShortcut(appId)).toBe(false);
    });
  });

  describe("Non-Steam shortcuts (should return true)", () => {
    const shortcuts: [string, number][] = [
      ["exactly at threshold", NON_STEAM_APPID_THRESHOLD],
      ["threshold + 1", NON_STEAM_APPID_THRESHOLD + 1],
      ["typical generated shortcut id", NON_STEAM_APPID_THRESHOLD + 123456],
      ["near uint32 max", 0xffffff00],
    ];

    it.each(shortcuts)("%s – appId %i", (_name, appId) => {
      expect(isNonSteamShortcut(appId)).toBe(true);
    });
  });
});

// ------------------------------------------------------------------ //
// launchTypeFor                                                        //
// ------------------------------------------------------------------ //

describe("launchTypeFor", () => {
  describe("native Linux games → LAUNCH_TYPE_GAME (100)", () => {
    it("Half-Life 2 (220)", () => {
      expect(launchTypeFor(220)).toBe(LAUNCH_TYPE_GAME);
    });

    it("Team Fortress 2 (440)", () => {
      expect(launchTypeFor(440)).toBe(LAUNCH_TYPE_GAME);
    });

    it("Dota 2 (570)", () => {
      expect(launchTypeFor(570)).toBe(LAUNCH_TYPE_GAME);
    });
  });

  describe("Proton games → LAUNCH_TYPE_GAME (100)", () => {
    // Proton games have normal Steam appIds; the Proton layer is chosen
    // by Steam automatically based on the user's compatibility settings.
    it("Cyberpunk 2077 (1091500)", () => {
      expect(launchTypeFor(1091500)).toBe(LAUNCH_TYPE_GAME);
    });

    it("Elden Ring (1245620)", () => {
      expect(launchTypeFor(1245620)).toBe(LAUNCH_TYPE_GAME);
    });

    it("GTA V (271590)", () => {
      expect(launchTypeFor(271590)).toBe(LAUNCH_TYPE_GAME);
    });
  });

  describe("non-Steam shortcuts → LAUNCH_TYPE_SHORTCUT (104)", () => {
    it("appId at threshold", () => {
      expect(launchTypeFor(NON_STEAM_APPID_THRESHOLD)).toBe(LAUNCH_TYPE_SHORTCUT);
    });

    it("typical generated shortcut id", () => {
      expect(launchTypeFor(NON_STEAM_APPID_THRESHOLD + 99999)).toBe(LAUNCH_TYPE_SHORTCUT);
    });
  });

  describe("constant values are correct", () => {
    it("LAUNCH_TYPE_GAME is 100", () => {
      expect(LAUNCH_TYPE_GAME).toBe(100);
    });

    it("LAUNCH_TYPE_SHORTCUT is 104", () => {
      expect(LAUNCH_TYPE_SHORTCUT).toBe(104);
    });

    it("NON_STEAM_APPID_THRESHOLD is 0x80000000", () => {
      expect(NON_STEAM_APPID_THRESHOLD).toBe(0x80000000);
    });
  });
});
