/**
 * pluginState.ts
 *
 * Centralised, module-level state shared between the route-patch hook,
 * the launch logic, and the QAM UI.  Using a plain module (rather than
 * React context) keeps the state alive while the QAM panel is unmounted
 * and allows non-component code (hooks, patchers) to read/write it.
 */

// ------------------------------------------------------------------ //
// Types                                                                //
// ------------------------------------------------------------------ //

export type AppId = number;

/** Fired whenever the user navigates to a game's detail page. */
export type GameSelectedListener = (appId: AppId) => void;

// ------------------------------------------------------------------ //
// State                                                                //
// ------------------------------------------------------------------ //

/** The appId of the game the user most recently navigated to. */
let _lastSelectedAppId: AppId | null = null;

/** Whether quick-launch is currently enabled. */
let _enabled = true;

/** Registered listener – only one at a time is needed for this plugin. */
let _onGameSelected: GameSelectedListener | null = null;

// ------------------------------------------------------------------ //
// Accessors                                                            //
// ------------------------------------------------------------------ //

export function getLastSelectedAppId(): AppId | null {
  return _lastSelectedAppId;
}

export function isEnabled(): boolean {
  return _enabled;
}

export function setEnabled(value: boolean): void {
  _enabled = value;
}

// ------------------------------------------------------------------ //
// Selection event                                                      //
// ------------------------------------------------------------------ //

/**
 * Called by the library route patcher when a game's detail page is
 * entered.  Stores the appId and fires the registered listener.
 */
export function notifyGameSelected(appId: AppId): void {
  _lastSelectedAppId = appId;
  console.log(`[QuickLaunch] Game selected: appId=${appId}`);
  _onGameSelected?.(appId);
}

/** Register the single game-selection listener (replaces any previous one). */
export function setGameSelectedListener(fn: GameSelectedListener | null): void {
  _onGameSelected = fn;
}
