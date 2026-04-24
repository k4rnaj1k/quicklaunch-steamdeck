/** Minimal stub for @decky/ui used in Jest tests. */
export const definePlugin = jest.fn((fn: () => unknown) => fn());
export const PanelSection = jest.fn();
export const PanelSectionRow = jest.fn();
export const ToggleField = jest.fn();
export const staticClasses = { Title: "ql-title" };
