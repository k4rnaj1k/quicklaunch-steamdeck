/**
 * pluginState.ts
 *
 * Centralised, module-level state shared between the route-patch hook,
 * the launch logic, and the QAM UI.  Using a plain module (rather than
 * React context) keeps the state alive while the QAM panel is unmounted
 * and allows non-component code (hooks, patchers) to read/write it.
 *
 * The `enabled` flag additionally supports a lightweight subscriber set
 * so that React components can stay in sync with async state changes
 * (e.g. the initial settings load from the Python backend) without
 * needing a full context provider.
 */

// ------------------------------------------------------------------ //
// Types                                                                //
// ------------------------------------------------------------------ //

export type AppId = number;

/**
 * Fired whenever the user navigates to a game's detail page.
 *
 * The listener is expected to issue `RunGame` and let Steam's launch
 * animation cover the overview – we no longer call `NavigateBack` to
 * dismiss it (that approach created a back-step / library-flash artefact
 * and raced Steam's render cycle).  Detection strategies are therefore
 * uniform: whoever sees the navigation calls `notifyGameSelected(appId)`
 * exactly once and Steam handles the UI transition.
 *
 * @returns true if the bypass was applied, false if it was aborted.
 */
export type GameSelectedListener = (appId: AppId) => boolean;

/** Fired whenever the `enabled` flag changes. */
export type EnabledChangeListener = (enabled: boolean) => void;

// ------------------------------------------------------------------ //
// State                                                                //
// ------------------------------------------------------------------ //

/** The appId of the game the user most recently navigated to. */
let _lastSelectedAppId: AppId | null = null;

/** Whether quick-launch is currently enabled. */
let _enabled = true;

/** Registered listener – only one at a time is needed for this plugin. */
let _onGameSelected: GameSelectedListener | null = null;


/** Subscribers notified on every enabled-state change. */
const _enabledListeners = new Set<EnabledChangeListener>();

// ------------------------------------------------------------------ //
// Accessors                                                            //
// ------------------------------------------------------------------ //

export function getLastSelectedAppId(): AppId | null {
  return _lastSelectedAppId;
}

export function isEnabled(): boolean {
  return _enabled;
}

/**
 * Update the enabled flag and notify all subscribers.
 * Components that called `subscribeToEnabled` will re-render automatically.
 */
export function setEnabled(value: boolean): void {
  _enabled = value;
  _enabledListeners.forEach((fn) => fn(value));
}

// ------------------------------------------------------------------ //
// Enabled-state subscription                                           //
// ------------------------------------------------------------------ //

/**
 * Subscribe to enabled-state changes.  Returns an unsubscribe function
 * suitable for use in a React `useEffect` cleanup.
 *
 * @example
 *   useEffect(() => subscribeToEnabled(setLocalEnabled), []);
 */
export function subscribeToEnabled(fn: EnabledChangeListener): () => void {
  _enabledListeners.add(fn);
  return () => {
    _enabledListeners.delete(fn);
  };
}

// ------------------------------------------------------------------ //
// Selection event                                                      //
// ------------------------------------------------------------------ //

/**
 * Called by the library route patcher when a game's detail page is
 * about to be (or has been) entered.
 *
 * @returns The boolean returned by the listener, or false if no listener.
 */
export function notifyGameSelected(appId: AppId): boolean {
  _lastSelectedAppId = appId;
  console.log(`[QuickLaunch] Game selected: appId=${appId}`);
  return _onGameSelected?.(appId) ?? false;
}

/** Register the single game-selection listener (replaces any previous one). */
export function setGameSelectedListener(fn: GameSelectedListener | null): void {
  _onGameSelected = fn;
}
