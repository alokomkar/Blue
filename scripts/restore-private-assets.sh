#!/usr/bin/env bash
# Recreates the git-ignored private files the "original" demo build needs, from the original
# (private) game repository on this machine:
#   public/models/private/        the original characters and animation clips (not CC0)
#   private-overlay/src/...       the matching original source files
# Usage: scripts/restore-private-assets.sh [path-to-original-repo]
set -euo pipefail
cd "$(dirname "$0")/.."
ORIG="${1:-$HOME/AndroidStudioProjects/AI/maze-heist-tower}"
[ -d "$ORIG/public/models" ] || { echo "original repo not found at $ORIG" >&2; exit 1; }

mkdir -p public/models/private/anims
cp "$ORIG"/public/models/{soldier,agent_male,agent_female}.glb public/models/private/
for c in crouchIdle crouchWalk crouchLeft crouchRight hide wall; do cp "$ORIG/public/models/anims/$c.glb" public/models/private/anims/; done

OV=private-overlay/src/client/game
mkdir -p "$OV"
for f in actor bots highwall outfit player portrait retarget skins stash ual; do cp "$ORIG/src/client/game/$f.ts" "$OV/$f.ts"; done
# a module was renamed in this repo: the rules for that are in the git-ignored scripts/private-rename.sed
[ -f scripts/private-rename.sed ] && sed -i.bak -f scripts/private-rename.sed "$OV/bots.ts" && rm "$OV/bots.ts.bak"
echo "done. Build the original-look demo with: npm run build:original   (output: dist-original/)"
