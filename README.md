# QuickLaunch

A [Decky Loader](https://decky.xyz/) plugin for the Steam Deck that launches
games **immediately** when you select them in the library — skipping the game
detail / content preview page entirely.

---

## What it does

Normally, pressing **A** on a game in the Steam Deck library opens a detail
page with the game's store art, description, play-time stats, and a Play
button.  QuickLaunch intercepts that navigation and fires `RunGame` directly,
so the game starts loading the instant you select it.

| Without QuickLaunch | With QuickLaunch |
|---|---|
| Select game → detail page → press Play → game loads | Select game → game loads |

---

## Features

- **Instant launch** for native Linux games, Proton titles, and non-Steam
  shortcuts
- **Smart edge-case handling**:
  - *Not installed* → detail page stays visible so you can click Install; a
    toast tells you why
  - *Already running* → resumes / focuses the existing session
  - *Update pending* → Steam queues the update then auto-launches
  - *Multiple launch options* (e.g. GTA V, AoE II DE) → Steam's picker dialog
    appears over the library as a graceful fallback
- **Toggle in Quick Access Menu** — enable or disable at any time; state
  persists across reboots
- **500 ms debounce** prevents accidental double-launches from repeated button
  presses

---

## Requirements

- Steam Deck running **SteamOS 3.x**
- [Decky Loader](https://decky.xyz/) **v3.0.0 or later**

---

## Installation

### Via Decky Plugin Store (recommended)

1. Open the **Quick Access Menu** (the `···` button).
2. Navigate to the **Decky** tab (plug icon).
3. Open the **Plugin Store** (shopping-bag icon in the top-right).
4. Search for **QuickLaunch** and press **Install**.

### Manual installation

1. Download `QuickLaunch.zip` from the
   [latest GitHub Release](https://github.com/vladliasota/steam-decky-quicklaunch-plugin/releases/latest).
2. Extract the zip.  You should see a `QuickLaunch/` folder containing
   `dist/`, `plugin.json`, `main.py`, and `LICENSE`.
3. Copy the `QuickLaunch/` folder to your Steam Deck:
   ```
   ~/homebrew/plugins/QuickLaunch/
   ```
   Via SSH or in Desktop Mode:
   ```bash
   scp -r QuickLaunch/ deck@steamdeck.local:~/homebrew/plugins/
   ```
4. Restart Decky Loader (or reboot the Steam Deck).

---

## Usage

QuickLaunch is **enabled by default** as soon as it is installed.

### Launching a game

Just select any installed game in your library with the **A** button — the
game starts loading immediately without any extra step.

### Toggling quick-launch on / off

1. Press the **Quick Access Menu** button (`···`).
2. Open the **QuickLaunch** panel (rocket icon).
3. Flip the **Quick Launch** toggle.

The toggle state is saved to disk and restored on every boot.

| Toggle state | Behaviour |
|---|---|
| **On** | Games launch immediately on selection |
| **Off** | Normal Steam behaviour — detail page appears as usual |

---

## Edge cases

| Situation | What happens |
|---|---|
| Game is **not installed** | Toast notification: *"Game not installed – open the game page to install it first."* The detail page stays open so you can click **Install**. |
| Game is **already running** | Toast: *"Resuming game session…"* The existing session is brought to focus. |
| Game has a **pending update** | Toast: *"Update pending – Steam will launch the game once it finishes."* Steam downloads the update then auto-launches. |
| Game has **multiple launch options** | Steam's own picker dialog appears over the library. QuickLaunch cannot detect this case in advance, so it gracefully falls back to Steam's built-in UI. |
| Plugin is **disabled** | The detail page appears exactly as it would without QuickLaunch installed. |

---

## How it works

QuickLaunch hooks into Steam's React router using Decky's `routerHook.addPatch`
API.  When the router navigates to `/library/app/:appid` (the game detail
route), the patch fires before the page renders and calls
`window.SteamClient.Apps.RunGame()` — the same internal API Steam uses when
you press **Play** on the detail page.  It then immediately navigates back to
`/library`, so the detail page never becomes visible.

```
User presses A
      │
      ▼
Steam router → /library/app/:appid
      │
      ▼  (routerHook.addPatch)
QuickLaunch intercepts
      │
      ├─ Check appState: not_installed? → abort, show toast
      │
      ├─ SteamClient.Apps.RunGame(appId, …)
      │
      └─ Navigation.Navigate("/library")   ← detail page never seen
```

A **Python backend** (`main.py`) handles settings persistence: the enabled /
disabled toggle is stored in
`~/homebrew/settings/QuickLaunch/settings.json` and survives across reboots
and Decky restarts.

---

## Development

### Prerequisites

- Node.js 20+
- Python 3.11+ (for linting `main.py` locally)
- A Steam Deck or a machine running SteamOS with Decky Loader installed

### Build

```bash
npm install
npm run build       # produces dist/index.js
```

### Test

```bash
npm test            # runs all unit tests with coverage
npm run test:watch  # watch mode
```

See [TESTING.md](TESTING.md) for the full manual on-device test plan (27
scenarios covering all game types, toggle persistence, debounce, and edge
cases).

### Deploy to Steam Deck (via SSH)

```bash
npm run build
rsync -av --delete dist/ plugin.json main.py LICENSE \
  deck@steamdeck.local:~/homebrew/plugins/QuickLaunch/
# Then reload Decky on the device
```

### Release

Push a version tag to trigger the GitHub Actions release workflow:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow runs unit tests, builds the bundle, packages
`QuickLaunch.zip`, and attaches it to a GitHub Release automatically.

---

## Project structure

```
steam-decky-quicklaunch-plugin/
├── src/
│   ├── index.tsx               # Plugin entry point (definePlugin)
│   ├── hooks/
│   │   └── libraryPatch.ts     # routerHook patch – detects game selection
│   ├── launch/
│   │   ├── gameLauncher.ts     # bypassAndLaunch – RunGame + navigate
│   │   └── appStateChecker.ts  # install/running/update state detection
│   ├── state/
│   │   └── pluginState.ts      # Shared module state + subscriber system
│   ├── utils/
│   │   ├── routeUtils.ts       # extractAppId (pure, unit-tested)
│   │   └── launchUtils.ts      # isNonSteamShortcut, launchTypeFor (pure)
│   ├── types/
│   │   └── steamClient.d.ts    # Ambient types for window.SteamClient
│   └── tests/                  # Jest unit tests + mocks
├── main.py                     # Python backend – settings persistence
├── plugin.json                 # Decky plugin metadata
├── rollup.config.js            # Frontend bundler config
├── jest.config.js              # Unit test config
├── TESTING.md                  # Manual on-device test plan
├── LICENSE                     # MIT
└── .github/workflows/
    └── release.yml             # CI: test → build → release zip
```

---

## License

[MIT](LICENSE) © vladliasota
