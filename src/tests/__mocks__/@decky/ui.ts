/** Minimal stub for @decky/ui used in Jest tests. */
export const definePlugin = jest.fn((fn: () => unknown) => fn());
export const PanelSection = jest.fn();
export const PanelSectionRow = jest.fn();
export const ToggleField = jest.fn();
export const staticClasses = { Title: "ql-title" };
// Router exposes the React-Router instance at runtime; here it's a plain
// object so any test that imports libraryPatch.ts doesn't fail at module
// init.  Tests that exercise route patching should override this.
export const Router: Record<string, unknown> = {};
// Navigation is consumed by libraryPatch.ts (Strategy 0b) and by
// gameLauncher.tsx (NavigateBack).  Both Navigate and NavigateBack are
// mocked so tests that import either file don't throw at load time.
export const Navigation = { Navigate: jest.fn(), NavigateBack: jest.fn() };
