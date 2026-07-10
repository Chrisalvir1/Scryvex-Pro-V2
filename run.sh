#!/bin/bash
set -e

echo "Iniciando Scryvex Pro Add-on..."

PG_DATA_DIR="/data/scryvex_postgres"

# Paso 1: Configurar PostgreSQL
if [ ! -d "$PG_DATA_DIR" ]; then
    echo "Inicializando base de datos PostgreSQL en $PG_DATA_DIR..."
    mkdir -p "$PG_DATA_DIR"
    chown -R postgres:postgres "$PG_DATA_DIR"
    su - postgres -c "/usr/lib/postgresql/15/bin/initdb -D $PG_DATA_DIR"
else
    echo "Directorio de PostgreSQL encontrado en $PG_DATA_DIR."
    chown -R postgres:postgres "$PG_DATA_DIR"
fi

# Paso 2: Arrancar PostgreSQL
echo "Arrancando demonio de PostgreSQL..."
touch /data/postgres.log
chown postgres:postgres /data/postgres.log
su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D $PG_DATA_DIR -l /data/postgres.log start"

# Polling hasta que postgres responda
echo "Esperando a que PostgreSQL esté listo..."
until su - postgres -c "pg_isready -q"; do
    sleep 1
done
echo "PostgreSQL está listo."

# Paso 3: Crear usuario y base de datos
echo "Verificando base de datos scryvex_core..."
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname = 'scryvex_core'\" | grep -q 1 || psql -c \"CREATE DATABASE scryvex_core\""
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname = 'scryvex'\" | grep -q 1 || psql -c \"CREATE USER scryvex WITH PASSWORD 'scryvex'\""
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE scryvex_core TO scryvex\""
su - postgres -c "psql -d scryvex_core -c \"GRANT ALL ON SCHEMA public TO scryvex\""

# Paso 4: Inicio del Core (ruta correcta donde git clone dejó el código)
export DATABASE_URL="postgresql://scryvex:scryvex@localhost/scryvex_core"
export SCRYPTED_VOLUME="/data/.scryvex_pro"
export SCRYPTED_INSECURE_PORT=19090
export SCRYPTED_DEBUG_PORT=10082

echo "Arrancando Scryvex Pro Core en Node 24..."
cd /usr/src/app/server

# Modo Desarrollo Opcional
if [ "$SCRYVEX_BUILD_ON_START" = "true" ]; then
    echo "[DEV] SCRYVEX_BUILD_ON_START activo. Compilando backend..."
    pnpm run build
fi

# Validar que el código compilado existe
if [ ! -f "dist/scrypted-main.js" ]; then
    echo "¡ERROR CRÍTICO! No se encontró dist/scrypted-main.js."
    echo "Esto indica que la imagen Docker se construyó sin compilar el backend."
    echo "El add-on se detendrá para evitar caché corrupta."
    exit 1
fi

# Mostrar info de la versión instalada (generada en el Dockerfile)
if [ -f "dist/build-info.json" ]; then
    echo "=== Build Info ==="
    cat dist/build-info.json
    echo "=================="
else
    echo "[WARN] No se encontró dist/build-info.json. Usando versión desconocida."
fi

echo "Iniciando proceso principal..."
node --expose-gc dist/scrypted-main.js
