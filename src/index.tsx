/**
 * QuickLaunch – Decky Loader Plugin
 *
 * Launches games immediately when selected in the Steam Deck library,
 * bypassing the game detail / content preview page.
 *
 * Entry point: Decky calls the default export produced by definePlugin.
 */

import {
  definePlugin,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  staticClasses,
} from "@decky/ui";
import { callable, toaster } from "@decky/api";
import React, { useEffect, useState, VFC } from "react";
import { FaRocket } from "react-icons/fa";

import { registerLibraryPatch } from "./hooks/libraryPatch";
import { bypassAndLaunch } from "./launch/gameLauncher";
import { startRunningAppsTracker } from "./launch/appStateChecker";
import {
  isEnabled,
  setEnabled,
  setGameSelectedListener,
  subscribeToEnabled,
} from "./state/pluginState";

// ---------------------------------------------------------------------- //
// Backend callables                                                        //
// ---------------------------------------------------------------------- //

/** Fetch persisted settings from the Python backend. */
const getSettings = callable<[], { enabled: boolean }>("get_settings");

/** Save settings to the Python backend. */
const saveSettings = callable<[{ enabled: boolean }], boolean>("save_settings");

// ---------------------------------------------------------------------- //
// Quick Access Menu (QAM) content component                               //
// ---------------------------------------------------------------------- //

/**
 * QuickLaunchQAM
 *
 * Renders a single ToggleField that shows and controls whether quick-launch
 * is active.  Local React state (`enabled`) is initialised from the module
 * state and stays in sync via `subscribeToEnabled`, so async events such as
 * the initial settings load from the Python backend are reflected
 * automatically without any prop-drilling or context provider.
 */
const QuickLaunchQAM: VFC<{
  onToggle: (next: boolean) => Promise<void>;
}> = ({ onToggle }) => {
  const [enabled, setLocalEnabled] = useState<boolean>(isEnabled());

  // Keep local React state in sync with the module state.
  // subscribeToEnabled returns an unsubscribe function used as cleanup.
  useEffect(() => subscribeToEnabled(setLocalEnabled), []);

  return (
    <PanelSection title="QuickLaunch">
      <PanelSectionRow>
        <ToggleField
          label="Quick Launch"
          description={
            enabled
              ? "Selecting a game launches it immediately."
              : "Normal Steam behaviour restored."
          }
          checked={enabled}
          onChange={onToggle}
        />
      </PanelSectionRow>
    </PanelSection>
  );
};

// ---------------------------------------------------------------------- //
// Plugin definition                                                        //
// ---------------------------------------------------------------------- //

export default definePlugin(() => {
  /** Cleanup functions collected during onMount; drained in onDismount. */
  let cleanupHooks: Array<() => void> = [];

  // ---------------------------------------------------------------- //
  // Load persisted settings on startup                                //
  // Calling setEnabled() here propagates to all subscribeToEnabled    //
  // listeners, so the QAM ToggleField re-renders automatically once   //
  // the async call resolves.                                           //
  // ---------------------------------------------------------------- //
  (async () => {
    try {
      const settings = await getSettings();
      setEnabled(settings.enabled ?? true);
    } catch (err) {
      console.error("[QuickLaunch] Failed to load settings:", err);
    }
  })();

  // ---------------------------------------------------------------- //
  // Game-selection handler                                             //
  // ---------------------------------------------------------------- //

  /**
   * Fired by libraryPatch whenever the Steam router navigates to
   * /library/app/:appid (i.e. the user selects a game in the library).
   *
   * Immediately launches the game and navigates back to the library,
   * effectively bypassing the game detail / preview page entirely.
   */
  function onGameSelected(appId: number): void {
    if (!isEnabled()) {
      console.log(
        `[QuickLaunch] Game ${appId} selected but plugin is disabled – passing through.`
      );
      return;
    }

    // Fire-and-forget: bypassAndLaunch is async but must not block the
    // route patch callback, which runs in Steam's render pipeline.
    bypassAndLaunch(appId).catch((err) => {
      console.error(`[QuickLaunch] bypassAndLaunch failed for appId=${appId}:`, err);
    });
  }

  // ---------------------------------------------------------------- //
  // Toggle handler (called by the ToggleField's onChange)             //
  // ---------------------------------------------------------------- //

  /**
   * Persists the new value to the Python backend, updates module state
   * (which notifies all subscribeToEnabled listeners including the QAM
   * component), and shows a brief confirmation toast.
   *
   * @param next  The new toggle value emitted by ToggleField.onChange.
   */
  const handleToggle = async (next: boolean): Promise<void> => {
    // Update module state immediately (optimistic) so the bypass logic
    // reflects the new value without waiting for the backend round-trip.
    setEnabled(next);

    try {
      await saveSettings({ enabled: next });
    } catch (err) {
      console.error("[QuickLaunch] Failed to save settings:", err);
      // On error: roll back module state and re-notify subscribers.
      setEnabled(!next);
    }

    toaster.toast({
      title: "QuickLaunch",
      body: next ? "Quick-launch enabled." : "Quick-launch disabled.",
      icon: <FaRocket />,
      duration: 2000,
    });
  };

  // ---------------------------------------------------------------- //
  // Plugin descriptor                                                  //
  // ---------------------------------------------------------------- //

  return {
    name: "QuickLaunch",
    title: <div className={staticClasses.Title}>QuickLaunch</div>,
    icon: <FaRocket />,

    // Keep the plugin mounted so the route patch stays active when the
    // QAM is closed.
    alwaysRender: true,

    content: <QuickLaunchQAM onToggle={handleToggle} />,

    onMount(): void {
      // 1. Start tracking which games are currently running so
      //    appStateChecker can answer isAppRunning() in O(1).
      const stopTracker = startRunningAppsTracker();
      cleanupHooks.push(stopTracker);

      // 2. Register the library route patch – intercepts /library/app/:appid
      //    navigation to detect game selection and trigger the bypass.
      const removeLibraryPatch = registerLibraryPatch();
      cleanupHooks.push(removeLibraryPatch);

      // 3. Wire our handler into the shared state so the patch can call it.
      setGameSelectedListener(onGameSelected);

      console.log(
        "[QuickLaunch] Plugin mounted – route patch and running-apps tracker active."
      );
    },

    onDismount(): void {
      // Remove the game-selection listener first so no callbacks fire
      // during teardown.
      setGameSelectedListener(null);

      // Run all registered cleanup functions (route patches, trackers, etc.).
      for (const cleanup of cleanupHooks) {
        try {
          cleanup();
        } catch (err) {
          console.error("[QuickLaunch] Error during hook cleanup:", err);
        }
      }
      cleanupHooks = [];

      console.log("[QuickLaunch] Plugin dismounted – all hooks cleaned up.");
    },
  };
});
