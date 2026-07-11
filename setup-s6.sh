#!/bin/bash
set -e

mkdir -p addon/rootfs/etc/s6-overlay/s6-rc.d/postgres/dependencies.d
mkdir -p addon/rootfs/etc/s6-overlay/s6-rc.d/postgres-setup/dependencies.d
mkdir -p addon/rootfs/etc/s6-overlay/s6-rc.d/scryvex-core/dependencies.d
mkdir -p addon/rootfs/etc/s6-overlay/s6-rc.d/scryvex-matter/dependencies.d
mkdir -p addon/rootfs/etc/s6-overlay/s6-rc.d/user/contents.d

# postgres
echo "longrun" > addon/rootfs/etc/s6-overlay/s6-rc.d/postgres/type
cat << 'EOF' > addon/rootfs/etc/s6-overlay/s6-rc.d/postgres/run
#!/command/with-contenv bash
PG_DATA_DIR="/data/scryvex_postgres"
if [ ! -d "$PG_DATA_DIR" ]; then
    mkdir -p "$PG_DATA_DIR"
    chown -R postgres:postgres "$PG_DATA_DIR"
    su - postgres -c "/usr/lib/postgresql/15/bin/initdb -D $PG_DATA_DIR"
fi
chown -R postgres:postgres "$PG_DATA_DIR"
exec su - postgres -c "/usr/lib/postgresql/15/bin/postgres -D $PG_DATA_DIR"
EOF
chmod +x addon/rootfs/etc/s6-overlay/s6-rc.d/postgres/run

# postgres-setup
echo "oneshot" > addon/rootfs/etc/s6-overlay/s6-rc.d/postgres-setup/type
cat << 'EOF' > addon/rootfs/etc/s6-overlay/s6-rc.d/postgres-setup/up
#!/command/execlineb -P
/usr/local/bin/scryvex-postgres-setup
EOF
chmod +x addon/rootfs/etc/s6-overlay/s6-rc.d/postgres-setup/up
touch addon/rootfs/etc/s6-overlay/s6-rc.d/postgres-setup/dependencies.d/postgres

# scryvex-core
echo "longrun" > addon/rootfs/etc/s6-overlay/s6-rc.d/scryvex-core/type
cat << 'EOF' > addon/rootfs/etc/s6-overlay/s6-rc.d/scryvex-core/run
#!/command/with-contenv bash
export DATABASE_URL="postgresql://scryvex:scryvex@localhost/scryvex_core"
export SCRYPTED_VOLUME="/data/.scryvex_pro"
export SCRYPTED_INSECURE_PORT=19090
export SCRYPTED_DEBUG_PORT=10082

cd /usr/src/app/server
if [ "$SCRYVEX_BUILD_ON_START" = "true" ]; then
    pnpm run build
fi
if [ ! -f "dist/scrypted-main.js" ]; then
    echo "ERROR: dist/scrypted-main.js not found."
    exit 1
fi
exec node --expose-gc dist/scrypted-main.js
EOF
chmod +x addon/rootfs/etc/s6-overlay/s6-rc.d/scryvex-core/run
touch addon/rootfs/etc/s6-overlay/s6-rc.d/scryvex-core/dependencies.d/postgres-setup

# scryvex-matter
echo "longrun" > addon/rootfs/etc/s6-overlay/s6-rc.d/scryvex-matter/type
echo "60000" > addon/rootfs/etc/s6-overlay/s6-rc.d/scryvex-matter/timeout-kill
cat << 'EOF' > addon/rootfs/etc/s6-overlay/s6-rc.d/scryvex-matter/run
#!/command/with-contenv bash
export MATTERBRIDGE_HOME="/data/scryvex-matter"
mkdir -p "$MATTERBRIDGE_HOME"
cd /usr/src/app/server
if [ ! -f "dist/matter/scryvex-matter.js" ]; then
    echo "ERROR: dist/matter/scryvex-matter.js not found."
    exit 1
fi
exec node --expose-gc dist/matter/scryvex-matter.js
EOF
chmod +x addon/rootfs/etc/s6-overlay/s6-rc.d/scryvex-matter/run
touch addon/rootfs/etc/s6-overlay/s6-rc.d/scryvex-matter/dependencies.d/scryvex-core

# user bundle
touch addon/rootfs/etc/s6-overlay/s6-rc.d/user/contents.d/scryvex-core
touch addon/rootfs/etc/s6-overlay/s6-rc.d/user/contents.d/scryvex-matter
