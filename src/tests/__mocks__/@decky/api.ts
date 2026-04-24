/** Minimal stub for @decky/api used in Jest tests. */
export const routerHook = {
  addPatch: jest.fn(),
  removePatch: jest.fn(),
};
export const toaster = { toast: jest.fn() };
export const Navigation = { Navigate: jest.fn(), NavigateBack: jest.fn() };
export const callable = jest.fn(() => jest.fn());
