#!/bin/bash
# Scrypted Pro G&C - First-boot plugin seeder
# Copies our custom-compiled plugins into the Scrypted volume so they
# are used instead of the official NPM versions from first launch.

SCRYPTED_VOLUME="${SCRYPTED_VOLUME:-/data/scrypted_data}"
PLUGINS_DIR="$SCRYPTED_VOLUME/plugins"
CUSTOM_PLUGINS_DIR="${SCRYPTED_CUSTOM_PLUGINS_DIR:-/scrypted-src/plugins}"
SEED_FLAG="$SCRYPTED_VOLUME/.gc_plugins_seeded"

# Only seed once - skip if already done
if [ -f "$SEED_FLAG" ]; then
    echo "[Scrypted Pro G&C] Custom plugins already seeded, skipping."
    exit 0
fi

echo "[Scrypted Pro G&C] First boot detected - seeding custom plugins..."

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
    echo "[Scrypted Pro G&C] Seeding plugin: $pkg_id -> $dest"
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
    echo "[Scrypted Pro G&C] Seeding core UI: $core_ui_src -> $core_ui_dest"
    mkdir -p "$core_ui_dest"
    cp -r "$core_ui_src/." "$core_ui_dest/"
fi

# Mark as seeded so we don't repeat on every boot
echo "Seeded by Scrypted Pro G&C on $(date)" > "$SEED_FLAG"
echo "[Scrypted Pro G&C] Plugin seeding complete!"
