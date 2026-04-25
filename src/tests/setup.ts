/**
 * Jest global setup for the Node test environment.
 *
 * Jest's "node" environment does not provide a `window` global, but the
 * source modules (appStateChecker.ts) and the test files themselves reference
 * `window.SteamClient` / `window.appStore`.  Aliasing `global.window` to
 * `global` makes those references resolve correctly without switching to the
 * heavier jsdom environment.
 */
(global as unknown as Record<string, unknown>).window = global;

/**
 * Silence the diagnostic console output that the production code emits
 * (e.g. `[QuickLaunch] isNonSteamShortcut: appId=…`).  These logs are
 * essential at runtime on the Steam Deck for diagnosing user-visible
 * issues, but they make the Jest output noisy and hard to scan during
 * normal test runs / CI.
 *
 * console.error and console.warn are kept intact so genuine problems
 * (e.g. tests asserting on warning paths) still surface.
 */
console.log  = () => {};
console.info = () => {};
console.debug = () => {};
