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
