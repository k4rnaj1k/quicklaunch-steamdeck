"""
QuickLaunch – Decky Loader Plugin Backend
Provides helper methods callable from the frontend via @decky/api.
"""

import decky  # type: ignore  # provided by Decky Loader at runtime


class Plugin:
    # ------------------------------------------------------------------ #
    # Lifecycle hooks (called by Decky Loader)                            #
    # ------------------------------------------------------------------ #

    async def _main(self) -> None:
        """Entry point – called once when the plugin is loaded."""
        decky.logger.info("QuickLaunch plugin started.")

    async def _unload(self) -> None:
        """Called when the plugin is unloaded / Decky shuts down."""
        decky.logger.info("QuickLaunch plugin unloaded.")

    async def _migration(self) -> None:
        """
        Called on first load after an update to migrate old settings/data.
        Relocate legacy files to the directories Decky manages.
        """
        decky.logger.info("QuickLaunch running migration check.")
        decky.migrate_settings(
            decky.DECKY_HOME + "/settings/quicklaunch.json"
        )

    # ------------------------------------------------------------------ #
    # Public methods (callable from the frontend via call / callable)     #
    # ------------------------------------------------------------------ #

    async def get_settings(self) -> dict:
        """Return the plugin's persisted settings."""
        # Placeholder – real read/write will be added in the settings task.
        return {
            "enabled": True,
        }

    async def save_settings(self, settings: dict) -> bool:
        """Persist the plugin's settings."""
        decky.logger.info(f"QuickLaunch saving settings: {settings}")
        # Placeholder – real file I/O will be added in the settings task.
        return True

    async def log_info(self, message: str) -> None:
        """Forward log messages emitted by the frontend."""
        decky.logger.info(f"[frontend] {message}")
