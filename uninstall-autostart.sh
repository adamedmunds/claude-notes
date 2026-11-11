#!/bin/sh
# Stops the notes server from starting at login, and stops it now.
set -eu

case "$(uname -s)" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/local.notes-server.plist"
    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    ;;
  Linux)
    UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/notes-server.service"
    systemctl --user disable --now notes-server.service 2>/dev/null || true
    rm -f "$UNIT"
    systemctl --user daemon-reload 2>/dev/null || true
    ;;
  *)
    echo "Unsupported system: $(uname -s). On Windows, run uninstall-autostart.cmd instead." >&2
    exit 1
    ;;
esac
echo "Removed. The notes server no longer starts at login."
