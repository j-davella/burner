#!/bin/sh
# Burner launcher for Linux/macOS without Nix: starts the bridge and opens the browser.
# On NixOS prefer:  nix run github:j-davella/burner
cd "$(dirname "$0")" || exit 1
exec python3 burner_bridge.py --open "$@"
