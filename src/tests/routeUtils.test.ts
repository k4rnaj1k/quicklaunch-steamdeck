/**
 * routeUtils.test.ts
 *
 * Tests for extractAppId() – the function that pulls a numeric Steam appId
 * out of the React router args Steam passes to a route's renderFunc.
 *
 * Each test block corresponds to a distinct arg shape that has been observed
 * across SteamOS versions, plus boundary / invalid-input cases.
 */

import { extractAppId } from "../utils/routeUtils";

// ------------------------------------------------------------------ //
// Happy-path: valid appId extracted from each known arg shape          //
// ------------------------------------------------------------------ //

describe("extractAppId – flat params shape (oldest SteamOS)", () => {
  it("extracts a string appId from args[0].appid", () => {
    expect(extractAppId([{ appid: "440" }])).toBe(440);
  });

  it("extracts a numeric appId from args[0].appid", () => {
    expect(extractAppId([{ appid: 730 }])).toBe(730);
  });
});

describe("extractAppId – react-router v5 shape (match.params.appid)", () => {
  it("extracts appId from nested match.params", () => {
    const args = [{ match: { params: { appid: "570" } } }];
    expect(extractAppId(args)).toBe(570);
  });

  it("handles extra properties alongside match", () => {
    const args = [{ path: "/library/app/:appid", match: { params: { appid: "1091500" } } }];
    expect(extractAppId(args)).toBe(1091500);
  });
});

describe("extractAppId – react-router v6 shape (params.appid)", () => {
  it("extracts appId from args[0].params.appid", () => {
    const args = [{ params: { appid: "220" } }];
    expect(extractAppId(args)).toBe(220);
  });
});

// ------------------------------------------------------------------ //
// Game-type specific appId ranges                                      //
// ------------------------------------------------------------------ //

describe("extractAppId – game type appId ranges", () => {
  it("handles native Linux game appId (e.g. TF2 = 440)", () => {
    expect(extractAppId([{ appid: "440" }])).toBe(440);
  });

  it("handles Proton game appId (e.g. Cyberpunk = 1091500)", () => {
    expect(extractAppId([{ appid: "1091500" }])).toBe(1091500);
  });

  it("handles non-Steam shortcut appId (>= 0x80000000)", () => {
    // Non-Steam shortcuts use the high appId range.
    const nonSteamId = 0x80000000 + 12345;
    expect(extractAppId([{ appid: String(nonSteamId) }])).toBe(nonSteamId);
  });

  it("handles large non-Steam shortcut appId near uint32 max", () => {
    const nearMax = 0xffffff00;
    expect(extractAppId([{ appid: String(nearMax) }])).toBe(nearMax);
  });
});

// ------------------------------------------------------------------ //
// Edge / invalid inputs                                                //
// ------------------------------------------------------------------ //

describe("extractAppId – invalid / missing inputs", () => {
  it("returns null for an empty args array", () => {
    expect(extractAppId([])).toBeNull();
  });

  it("returns null when args[0] is null", () => {
    expect(extractAppId([null])).toBeNull();
  });

  it("returns null when args[0] is undefined", () => {
    expect(extractAppId([undefined])).toBeNull();
  });

  it("returns null when appid key is absent", () => {
    expect(extractAppId([{ path: "/library/app/:appid" }])).toBeNull();
  });

  it("returns null for a non-numeric appid string", () => {
    expect(extractAppId([{ appid: "not-a-number" }])).toBeNull();
  });

  it("returns null for an empty appid string", () => {
    expect(extractAppId([{ appid: "" }])).toBeNull();
  });

  it("returns null for appid = 0 (not a valid Steam app)", () => {
    expect(extractAppId([{ appid: "0" }])).toBeNull();
  });

  it("returns null when match.params is missing appid", () => {
    expect(extractAppId([{ match: { params: {} } }])).toBeNull();
  });
});

// ------------------------------------------------------------------ //
// Signed-int32 normalisation (non-Steam shortcuts)                     //
// ------------------------------------------------------------------ //

describe("extractAppId – signed-int32 non-Steam shortcut appIds", () => {
  // Non-Steam shortcuts use uint32 values with the high bit set.
  // When Steam surfaces them through an int32-typed field, they show
  // up in JS as signed-negative numbers.  extractAppId normalises
  // these to their uint32 representation so downstream code sees a
  // valid positive appId.

  it("normalises numeric -1 to 0xFFFFFFFF", () => {
    expect(extractAppId([{ appid: -1 }])).toBe(0xffffffff);
  });

  it("normalises string '-1' to 0xFFFFFFFF", () => {
    expect(extractAppId([{ appid: "-1" }])).toBe(0xffffffff);
  });

  it("normalises numeric -0x80000000 to 0x80000000 (threshold)", () => {
    expect(extractAppId([{ appid: -0x80000000 }])).toBe(0x80000000);
  });

  it("normalises a realistic signed-int32 non-Steam shortcut", () => {
    // int32 bit pattern of uint32 0x80215242 is a negative JS number.
    expect(extractAppId([{ appid: -0x7fdeadbe }])).toBe(0x80215242);
  });

  it("preserves positive non-Steam shortcut appId unchanged", () => {
    // Regression guard: normalisation must be a no-op for already-unsigned inputs.
    const appId = 0x80000000 + 12345;
    expect(extractAppId([{ appid: String(appId) }])).toBe(appId);
  });
});
