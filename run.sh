#!/bin/bash
set -e

echo "Iniciando Scryvex Pro Add-on..."

PG_DATA_DIR="/data/scryvex_postgres"

# Paso 1: Configurar PostgreSQL
if [ ! -d "$PG_DATA_DIR" ]; then
    echo "Inicializando base de datos PostgreSQL en $PG_DATA_DIR..."
    mkdir -p "$PG_DATA_DIR"
    chown -R postgres:postgres "$PG_DATA_DIR"
    # Execute initdb as postgres user
    su - postgres -c "/usr/lib/postgresql/15/bin/initdb -D $PG_DATA_DIR"
else
    echo "Directorio de PostgreSQL encontrado en $PG_DATA_DIR."
    chown -R postgres:postgres "$PG_DATA_DIR"
fi

# Paso 2: Arrancar el demonio y esperar conexiones
echo "Arrancando demonio de PostgreSQL..."
su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D $PG_DATA_DIR -l /data/postgres.log start"

# Polling hasta que postgres responda
echo "Esperando a que PostgreSQL esté listo..."
until su - postgres -c "pg_isready -q"; do
    sleep 1
done
echo "PostgreSQL está listo."

# Paso 3: Crear usuario y base de datos scryvex_core
echo "Verificando base de datos scryvex_core..."
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname = 'scryvex_core'\" | grep -q 1 || psql -c \"CREATE DATABASE scryvex_core\""
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname = 'scryvex'\" | grep -q 1 || psql -c \"CREATE USER scryvex WITH PASSWORD 'scryvex'\""
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE scryvex_core TO scryvex\""
su - postgres -c "psql -d scryvex_core -c \"GRANT ALL ON SCHEMA public TO scryvex\""

# Paso 4: Inicio del Core
export DATABASE_URL="postgresql://scryvex:scryvex@localhost/scryvex_core"
export SCRYPTED_VOLUME="/data/.scryvex_pro"

echo "Arrancando Scryvex Pro Core en Node 24..."
cd /app/server
pnpm run serve
