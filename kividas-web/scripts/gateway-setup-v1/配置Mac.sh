#!/bin/bash
set -eu
umask 077
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
exec /usr/bin/osascript -l JavaScript "$SCRIPT_DIR/mac.js" "$SCRIPT_DIR" "$@"
