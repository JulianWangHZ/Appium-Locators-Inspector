# appium-locators-inspector

Local companion for the [Appium Locators Inspector](https://chromewebstore.google.com/detail/appium-locators-inspector/annejeomdlkidljonmpmhcdnekkadjfb) Chrome extension.

## Recommended: set up once

```bash
npx appium-locators-inspector setup
```

Then reload the extension in `chrome://extensions`. From now on, **Start servers** in the extension popup starts the companion in the background, with no terminal to keep open. Undo with `npx appium-locators-inspector uninstall`.

## Or run it in a terminal

```bash
npx appium-locators-inspector
```

This starts the local backend (and Appium, if it is not already running). Keep the terminal open, then open the extension popup and pick your device. Press Ctrl+C to stop.

Requirements: Node.js 18+, Appium 3 (`npm install -g appium`) with the `uiautomator2` and/or `xcuitest` driver.

## Options

| Option | Default | |
| --- | --- | --- |
| `--port <n>` | 8765 | Backend port; must match the extension settings |
| `--appium-port <n>` | 4723 | Appium port |
| `--fps <n>` | 3 | Screen mirror frames per second (1-30) |
| `--no-appium` | | Use an Appium server you start yourself |
| `--verbose` | | Show Appium's log in the terminal |
| `--extension-id <id>` | | `setup` only: also allow an unpacked development build (Settings → Setup shows the exact command) |

For iOS real devices, set `APPLE_TEAM_ID` to sign WebDriverAgent. Set `APPIUM_PATH` if Appium is installed outside your `PATH`. Appium's log goes to `~/.appium_locators_inspector/appium.log` (add `--verbose` to see it in the terminal). Everything runs on your machine; the backend listens on 127.0.0.1 only.

[MIT](https://github.com/JulianWangHZ/Appium-Locators-Inspector/blob/main/LICENSE)
