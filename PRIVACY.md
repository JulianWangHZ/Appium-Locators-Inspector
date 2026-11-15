# Privacy Policy

**Appium Locators Inspector**

_Last updated: 2026-08-31_

## Summary

Appium Locators Inspector does **not** collect, store, transmit, or sell any personal
or usage data. The extension runs entirely on your own machine.

## What data we collect

**None.** The extension does not collect any user data of any kind — no personal
information, no browsing activity, no analytics, and no telemetry.

## How the extension works

All functionality is local:

- The extension communicates with a small companion application running on your own
  computer (started with `npx appium-locators-inspector`, or by Chrome via native
  messaging), over `localhost` only.
- That companion drives a local [Appium](https://appium.io/) server (on `localhost`) to
  read the connected device's screen and UI hierarchy and to perform taps and gestures.
- Locators, recorded steps, and generated test code are produced on your machine and are
  only shown to you inside the extension.

The extension **never** connects to any external or remote server. Only `localhost` is
contacted.

## Local storage

The extension uses Chrome's local `storage` to remember your preferences (for example,
the light/dark theme and the last-used platform and device). This data stays on your
machine and is never transmitted anywhere.

## Third parties

We do not use any third-party analytics, advertising, or tracking services. No data is
shared with, sold to, or transferred to any third party.

## Permissions

- **storage** — save your local preferences (theme, last-used device).
- **nativeMessaging** — talk to the local companion that runs Appium on your machine.
- **host permission (`http://localhost/*`)** — connect to the local backend and Appium
  server. Only `localhost` is used.

## Changes to this policy

If this policy changes, the updated version will be published at this URL with a new
"Last updated" date.

## Contact

Questions? Open an issue at
<https://github.com/JulianWangHZ/Appium-Locators-Inspector/issues>.
