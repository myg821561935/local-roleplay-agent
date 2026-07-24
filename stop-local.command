#!/bin/zsh
set -eu

ROOT_DIR="${0:A:h}"
exec "$ROOT_DIR/scripts/stop-local.sh"
