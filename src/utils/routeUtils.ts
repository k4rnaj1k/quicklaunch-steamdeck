/**
 * routeUtils.ts
 *
 * Pure utility functions for working with Steam router arguments.
 * Extracted into a standalone module so they can be unit-tested without
 * importing browser-only Decky APIs (routerHook, afterPatch, etc.).
 */

/**
 * Extract a numeric appId from the arguments that Steam passes to a
 * route's renderFunc.  Steam passes a params / match object as the first
 * argument; the exact shape varies across SteamOS versions.
 *
 * Known argument shapes (oldest → newest):
 *   args[0] = { appid: "123456" }                         (flat params)
 *   args[0] = { match: { params: { appid: "123456" } } }  (react-router v5)
 *   args[0] = { params: { appid: "123456" } }             (react-router v6)
 *
 * @param args  The raw arguments array passed to renderFunc.
 * @returns     A positive integer appId, or null if extraction failed.
 */
export function extractAppId(args: unknown[]): number | null {
  if (!args || args.length === 0) return null;

  const arg = args[0] as Record<string, unknown> | null | undefined;
  if (!arg) return null;

  // Try each known shape, most-specific first.
  const raw =
    (arg["appid"] as string | number | undefined) ??
    (
      (arg["match"] as Record<string, unknown> | undefined)
        ?.["params"] as Record<string, string> | undefined
    )?.["appid"] ??
    (arg["params"] as Record<string, string> | undefined)?.["appid"] ??
    null;

  if (raw === null || raw === undefined) return null;

  const id = typeof raw === "number" ? raw : parseInt(raw as string, 10);
  return isNaN(id) || id <= 0 ? null : id;
}
