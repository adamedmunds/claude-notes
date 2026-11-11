#!/bin/sh
# Makes the notes server start automatically when you log in.
#   macOS: installs a launchd agent  (~/Library/LaunchAgents/local.notes-server.plist)
#   Linux: installs a systemd user service (~/.config/systemd/user/notes-server.service)
# Run again after moving this folder or changing Node versions (e.g. with nvm).
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
NODE=$(command -v node || true)
if [ -z "$NODE" ]; then
  echo "Node.js isn't installed or isn't on your PATH. Install Node 18 or newer, then run this again." >&2
  exit 1
fi
LOG="$DIR/notes-server.log"

case "$(uname -s)" in
  Darwin)
    AGENTS="$HOME/Library/LaunchAgents"
    PLIST="$AGENTS/local.notes-server.plist"
    mkdir -p "$AGENTS"
    ENV_BLOCK=""
    if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
      ENV_BLOCK="<key>EnvironmentVariables</key><dict><key>CLAUDE_CONFIG_DIR</key><string>$CLAUDE_CONFIG_DIR</string></dict>"
    fi
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.notes-server</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$DIR/server.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  $ENV_BLOCK
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed. The notes server now starts when you log in, and is running now."
    echo "Open http://localhost:6683 (or http://notes.localhost:6683 in Chrome, Edge or Firefox)."
    ;;
  Linux)
    if ! command -v systemctl >/dev/null 2>&1; then
      echo "This system has no systemd, so I can't set up automatic start." >&2
      echo "Add this to your desktop's startup programs instead:  $NODE \"$DIR/server.js\"" >&2
      exit 1
    fi
    UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    mkdir -p "$UNITS"
    {
      echo "[Unit]"
      echo "Description=Notes site for Claude memory notes (http://notes.localhost:6683)"
      echo ""
      echo "[Service]"
      echo "ExecStart=\"$NODE\" \"$DIR/server.js\""
      echo "WorkingDirectory=$DIR"
      [ -n "${CLAUDE_CONFIG_DIR:-}" ] && echo "Environment=\"CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR\""
      echo "Restart=on-failure"
      echo "StandardOutput=append:$LOG"
      echo "StandardError=append:$LOG"
      echo ""
      echo "[Install]"
      echo "WantedBy=default.target"
    } > "$UNITS/notes-server.service"
    systemctl --user daemon-reload
    systemctl --user enable --now notes-server.service
    echo "Installed. The notes server now starts when you log in, and is running now."
    echo "Open http://notes.localhost:6683"
    ;;
  *)
    echo "Unsupported system: $(uname -s). On Windows, run install-autostart.cmd instead." >&2
    exit 1
    ;;
esac
