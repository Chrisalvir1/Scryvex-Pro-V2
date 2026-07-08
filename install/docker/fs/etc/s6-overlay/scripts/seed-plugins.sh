#!/bin/bash
# Scryvex Pro - Version-aware plugin seeder
# Copies our custom-compiled plugins into the Scrypted volume so they
# are used instead of the official NPM versions.
# Re-seeds automatically whenever the addon image version changes.

SCRYPTED_VOLUME="${SCRYPTED_VOLUME:-/data/scrypted_data}"
PLUGINS_DIR="$SCRYPTED_VOLUME/plugins"
CUSTOM_PLUGINS_DIR="${SCRYPTED_CUSTOM_PLUGINS_DIR:-/scrypted-src/plugins}"
SEED_FLAG="$SCRYPTED_VOLUME/.gc_plugins_seeded"

# Determine current image version from config.yaml baked into the image.
# Falls back to a build-time hash of the plugins dir so any change triggers a re-seed.
CONFIG_YAML="/scrypted-src/install/config.yaml"
if [ -f "$CONFIG_YAML" ]; then
    CURRENT_VERSION=$(grep '^version:' "$CONFIG_YAML" | sed 's/version:[[:space:]]*"\?//;s/"\?$//' | tr -d ' ')
else
    CURRENT_VERSION="unknown"
fi

# Read the version that was seeded last time (if any)
SEEDED_VERSION=""
if [ -f "$SEED_FLAG" ]; then
    SEEDED_VERSION=$(grep 'version=' "$SEED_FLAG" | sed 's/version=//')
fi

# Skip re-seed only when the version matches exactly
if [ -f "$SEED_FLAG" ] && [ "$SEEDED_VERSION" = "$CURRENT_VERSION" ]; then
    echo "[Scryvex Pro] Plugins already seeded for version $CURRENT_VERSION, skipping."
    exit 0
fi

if [ -n "$SEEDED_VERSION" ]; then
    echo "[Scryvex Pro] Image updated: $SEEDED_VERSION -> $CURRENT_VERSION. Re-seeding plugins..."
else
    echo "[Scryvex Pro] First boot detected - seeding custom plugins..."
fi

mkdir -p "$PLUGINS_DIR"

# Seed each custom plugin that has a built dist/out folder
for plugin_dir in "$CUSTOM_PLUGINS_DIR"/*/; do
    plugin_name=$(basename "$plugin_dir")
    pkg_json="$plugin_dir/package.json"

    # Only process if package.json exists and has a built artifact
    if [ ! -f "$pkg_json" ]; then
        continue
    fi

    has_build=false
    [ -d "$plugin_dir/dist" ] && has_build=true
    [ -d "$plugin_dir/out" ]  && has_build=true

    if [ "$has_build" = "false" ]; then
        continue
    fi

    pkg_id=$(node -e "try{console.log(require('$pkg_json').name)}catch(e){}" 2>/dev/null)
    if [ -z "$pkg_id" ]; then
        continue
    fi

    dest="$PLUGINS_DIR/$pkg_id"
    echo "[Scryvex Pro] Seeding plugin: $pkg_id -> $dest"
    mkdir -p "$dest"
    cp "$pkg_json" "$dest/package.json"
    [ -d "$plugin_dir/dist" ] && cp -r "$plugin_dir/dist" "$dest/dist"
    [ -d "$plugin_dir/out" ]  && cp -r "$plugin_dir/out"  "$dest/out"
    [ -f "$plugin_dir/README.md" ] && cp "$plugin_dir/README.md" "$dest/README.md"
done

# Also seed the core UI (built into plugins/core/dist, served by the core plugin)
core_ui_src="$CUSTOM_PLUGINS_DIR/core/dist"
core_ui_dest="$PLUGINS_DIR/@scrypted/core/dist"
if [ -d "$core_ui_src" ]; then
    echo "[Scryvex Pro] Seeding core UI: $core_ui_src -> $core_ui_dest"
    mkdir -p "$core_ui_dest"
    cp -r "$core_ui_src/." "$core_ui_dest/"
fi

# Mark as seeded with current version so next boot can detect upgrades
printf "Seeded by Scryvex Pro on $(date)\nversion=%s\n" "$CURRENT_VERSION" > "$SEED_FLAG"
echo "[Scryvex Pro] Plugin seeding complete for version $CURRENT_VERSION!"
