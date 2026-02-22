#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
PLIST_PATH="$HOME/Library/LaunchAgents/com.olesbrain.screen-time-sync.plist"
LOG_PATH="$REPO_ROOT/data/screen-time-sync.log"
ERR_PATH="$REPO_ROOT/data/screen-time-sync.err.log"

KEY=""
BASE_URL="${OLES_BRAIN_BASE_URL:-https://oles-brain.netlify.app}"
HOUR="${SCREEN_TIME_HOUR:-7}"
MINUTE="${SCREEN_TIME_MINUTE:-0}"
SOURCE="${SCREEN_TIME_SOURCE:-}"
MODE="${SCREEN_TIME_MODE:-mac-db}"
UI_DEVICE_MATCH="${SCREEN_TIME_UI_DEVICE_MATCH:-iphone}"
STREAMS="${SCREEN_TIME_STREAMS:-}"
AGGREGATION="${SCREEN_TIME_STREAM_AGGREGATION:-}"
DEVICE_FILTER="${SCREEN_TIME_DEVICE_FILTER:-}"
UI_FALLBACK="${SCREEN_TIME_FALLBACK_TO_UI:-}"
KNOWLEDGE_DB_PATH="${KNOWLEDGE_DB_PATH:-$HOME/Library/Application Support/Knowledge/knowledgeC.db}"

usage() {
  cat <<EOF
Bruk:
  $0 --key DIN_KEY [--url URL] [--hour 7] [--minute 0] [--mode mac-db|iphone-db|iphone-ui] [--ui-fallback true|false]

Eksempel:
  $0 --key min-nokkel-123 --url https://oles-brain.netlify.app --hour 7 --minute 0
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)
      KEY="${2:-}"
      shift 2
      ;;
    --url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --hour)
      HOUR="${2:-}"
      shift 2
      ;;
    --minute)
      MINUTE="${2:-}"
      shift 2
      ;;
    --source)
      SOURCE="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --ui-device)
      UI_DEVICE_MATCH="${2:-}"
      shift 2
      ;;
    --streams)
      STREAMS="${2:-}"
      shift 2
      ;;
    --aggregation)
      AGGREGATION="${2:-}"
      shift 2
      ;;
    --device-filter)
      DEVICE_FILTER="${2:-}"
      shift 2
      ;;
    --ui-fallback)
      UI_FALLBACK="${2:-}"
      shift 2
      ;;
    --knowledge-db)
      KNOWLEDGE_DB_PATH="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Ukjent argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$KEY" ]]; then
  echo "Mangler --key" >&2
  usage
  exit 1
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "Fant ikke node i PATH." >&2
  exit 1
fi

if ! [[ "$HOUR" =~ ^[0-9]+$ ]] || (( HOUR < 0 || HOUR > 23 )); then
  echo "Ugyldig --hour: $HOUR" >&2
  exit 1
fi

if ! [[ "$MINUTE" =~ ^[0-9]+$ ]] || (( MINUTE < 0 || MINUTE > 59 )); then
  echo "Ugyldig --minute: $MINUTE" >&2
  exit 1
fi

if [[ "$MODE" != "mac-db" && "$MODE" != "iphone-db" && "$MODE" != "iphone-ui" ]]; then
  echo "Ugyldig --mode: $MODE (bruk mac-db, iphone-db eller iphone-ui)" >&2
  exit 1
fi

if [[ -z "$SOURCE" ]]; then
  case "$MODE" in
    iphone-ui) SOURCE="iphone-system-settings-ui" ;;
    iphone-db) SOURCE="iphone-knowledge-db" ;;
    *) SOURCE="mac-knowledge-db" ;;
  esac
fi

if [[ -z "$STREAMS" ]]; then
  if [[ "$MODE" == "iphone-db" ]]; then
    STREAMS="/app/usage,/app/webUsage,/app/mediaUsage"
  else
    STREAMS="/app/usage"
  fi
fi

if [[ -z "$AGGREGATION" ]]; then
  if [[ "$MODE" == "iphone-db" ]]; then
    AGGREGATION="best-stream"
  else
    AGGREGATION="sum"
  fi
fi

if [[ "$AGGREGATION" != "sum" && "$AGGREGATION" != "best-stream" ]]; then
  echo "Ugyldig --aggregation: $AGGREGATION (bruk sum eller best-stream)" >&2
  exit 1
fi

if [[ "$MODE" == "iphone-db" && -z "$DEVICE_FILTER" ]]; then
  DEVICE_FILTER="iphone"
fi

if [[ -z "$UI_FALLBACK" ]]; then
  if [[ "$MODE" == "iphone-db" ]]; then
    UI_FALLBACK="true"
  else
    UI_FALLBACK="false"
  fi
fi

if [[ "$UI_FALLBACK" != "true" && "$UI_FALLBACK" != "false" ]]; then
  echo "Ugyldig --ui-fallback: $UI_FALLBACK (bruk true eller false)" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$REPO_ROOT/data"

cat >"$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.olesbrain.screen-time-sync</string>

    <key>ProgramArguments</key>
    <array>
      <string>$NODE_BIN</string>
      <string>$REPO_ROOT/scripts/push-mac-screen-time.js</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$REPO_ROOT</string>

    <key>EnvironmentVariables</key>
    <dict>
      <key>SCREEN_TIME_KEY</key>
      <string>$KEY</string>
      <key>OLES_BRAIN_BASE_URL</key>
      <string>$BASE_URL</string>
      <key>SCREEN_TIME_SOURCE</key>
      <string>$SOURCE</string>
      <key>SCREEN_TIME_MODE</key>
      <string>$MODE</string>
      <key>SCREEN_TIME_UI_DEVICE_MATCH</key>
      <string>$UI_DEVICE_MATCH</string>
      <key>SCREEN_TIME_STREAMS</key>
      <string>$STREAMS</string>
      <key>SCREEN_TIME_STREAM_AGGREGATION</key>
      <string>$AGGREGATION</string>
      <key>SCREEN_TIME_DEVICE_FILTER</key>
      <string>$DEVICE_FILTER</string>
      <key>SCREEN_TIME_FALLBACK_TO_UI</key>
      <string>$UI_FALLBACK</string>
      <key>KNOWLEDGE_DB_PATH</key>
      <string>$KNOWLEDGE_DB_PATH</string>
    </dict>

    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>$HOUR</integer>
      <key>Minute</key>
      <integer>$MINUTE</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>$LOG_PATH</string>
    <key>StandardErrorPath</key>
    <string>$ERR_PATH</string>
  </dict>
</plist>
EOF

UID_VALUE="$(id -u)"
launchctl bootout "gui/$UID_VALUE" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID_VALUE" "$PLIST_PATH"
launchctl enable "gui/$UID_VALUE/com.olesbrain.screen-time-sync"

echo "Installert launchd-jobb: $PLIST_PATH"
echo "Kjør manuelt test nå:"
echo "  launchctl kickstart -k gui/$UID_VALUE/com.olesbrain.screen-time-sync"
echo "Se logg:"
echo "  tail -n 80 \"$LOG_PATH\""
echo "  tail -n 80 \"$ERR_PATH\""
