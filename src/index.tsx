/**
 * QuickLaunch – Decky Loader Plugin
 *
 * Launches games immediately when selected in the Steam Deck library,
 * bypassing the game detail / content preview page.
 *
 * Entry point: Decky calls the default export produced by definePlugin.
 */

import {
  ButtonItem,
  definePlugin,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import { callable, toaster } from "@decky/api";
import { VFC } from "react";
import { FaRocket } from "react-icons/fa";

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

const QuickLaunchQAM: VFC<{ enabled: boolean; onToggle: () => void }> = ({
  enabled,
  onToggle,
}) => (
  <PanelSection title="QuickLaunch">
    <PanelSectionRow>
      <ButtonItem
        layout="below"
        onClick={onToggle}
        description={
          enabled
            ? "Click a game to launch it immediately."
            : "Normal Steam behaviour restored."
        }
      >
        {enabled ? "Enabled – click to disable" : "Disabled – click to enable"}
      </ButtonItem>
    </PanelSectionRow>
  </PanelSection>
);

// ---------------------------------------------------------------------- //
// Plugin definition                                                        //
// ---------------------------------------------------------------------- //

export default definePlugin(() => {
  /** Whether quick-launch behaviour is currently active. */
  let enabled = true;

  /**
   * Placeholders for the hooks registered during onMount.
   * Will be populated in the "intercept game launch navigation" task.
   */
  let cleanupHooks: Array<() => void> = [];

  // Load persisted settings from the backend on startup.
  (async () => {
    try {
      const settings = await getSettings();
      enabled = settings.enabled ?? true;
    } catch (err) {
      console.error("[QuickLaunch] Failed to load settings:", err);
    }
  })();

  /** Persist the current toggle state and notify the user. */
  const handleToggle = async () => {
    enabled = !enabled;
    try {
      await saveSettings({ enabled });
      toaster.toast({
        title: "QuickLaunch",
        body: enabled ? "Quick-launch enabled." : "Quick-launch disabled.",
        icon: <FaRocket />,
      });
    } catch (err) {
      console.error("[QuickLaunch] Failed to save settings:", err);
    }
  };

  return {
    // Plugin metadata shown in the QAM sidebar.
    name: "QuickLaunch",
    title: <div className={staticClasses.Title}>QuickLaunch</div>,
    icon: <FaRocket />,

    // Keep the plugin mounted so hooks remain active when QAM is closed.
    alwaysRender: true,

    // QAM panel content.
    content: <QuickLaunchQAM enabled={enabled} onToggle={handleToggle} />,

    onMount() {
      /**
       * TODO (next task): Register routerHook / SteamClient hooks here to
       * intercept navigation to the game detail page and trigger immediate
       * game launch instead.
       *
       * Example pattern:
       *   const unregister = routerHook.addRoute(...)
       *   cleanupHooks.push(unregister);
       */
      console.log("[QuickLaunch] Plugin mounted – hooks placeholder ready.");
    },

    onDismount() {
      // Unregister all hooks to avoid memory leaks.
      for (const cleanup of cleanupHooks) {
        try {
          cleanup();
        } catch (err) {
          console.error("[QuickLaunch] Error during hook cleanup:", err);
        }
      }
      cleanupHooks = [];
      console.log("[QuickLaunch] Plugin dismounted – hooks cleaned up.");
    },
  };
});
