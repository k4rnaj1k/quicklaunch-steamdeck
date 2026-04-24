/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Only run files under src/tests/ to avoid accidentally picking up
  // source files that import browser-only Decky / Steam CEF globals.
  testMatch: ["**/src/tests/**/*.test.ts"],
  // Map module paths that would otherwise resolve to Decky runtime
  // packages (unavailable in Node) to lightweight stubs.
  moduleNameMapper: {
    "^@decky/api$": "<rootDir>/src/tests/__mocks__/@decky/api.ts",
    "^@decky/ui$": "<rootDir>/src/tests/__mocks__/@decky/ui.ts",
    "^decky-frontend-lib$": "<rootDir>/src/tests/__mocks__/decky-frontend-lib.ts",
    "^react-icons/fa$": "<rootDir>/src/tests/__mocks__/react-icons-fa.ts",
  },
  collectCoverageFrom: [
    "src/utils/**/*.ts",
    "src/launch/appStateChecker.ts",
    "src/state/pluginState.ts",
  ],
  coverageReporters: ["text", "lcov"],
};
