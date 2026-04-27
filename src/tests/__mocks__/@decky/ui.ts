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
// Navigation is consumed by libraryPatch.ts (Strategy 0b patches
// Navigation.Navigate).  NavigateBack is no longer used by the plugin
// (the previous NavigateBack-based dismiss was removed in v1.4.0 in
// favour of letting Steam's own launch animation cover the overview)
// but is kept here for any third-party imports / future revivals.
export const Navigation = { Navigate: jest.fn(), NavigateBack: jest.fn() };
