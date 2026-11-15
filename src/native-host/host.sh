#!/bin/bash
# Development wrapper for Chrome Native Messaging (the installer writes its own copy).
# Chrome starts native hosts with a minimal PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="${TMPDIR:-/tmp}/appium_locators_inspector_host.log"

NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ]; then
    for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
        if [ -x "$candidate" ]; then
            NODE="$candidate"
            break
        fi
    done
fi

if [ -z "$NODE" ]; then
    echo "$(date): Node.js not found. Install Node.js and make sure it is on your PATH." >> "$LOG_FILE"
    exit 1
fi

# For iOS real devices, export APPLE_TEAM_ID in your shell profile to sign WebDriverAgent.
exec "$NODE" "$DIR/launcher.js" 2>> "$LOG_FILE"
