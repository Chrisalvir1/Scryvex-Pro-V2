ARG TARGETARCH
FROM ghcr.io/home-assistant/aarch64-base-debian:bookworm AS base-arm64
FROM ghcr.io/home-assistant/amd64-base-debian:bookworm AS base-amd64

FROM base-${TARGETARCH}

ARG BUILD_VERSION
ARG TARGETARCH

LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="addon" \
    io.hass.arch="${TARGETARCH}" \
    org.opencontainers.image.source="https://github.com/Chrisalvir1/Scryvex-Pro-V2" \
    org.opencontainers.image.version="${BUILD_VERSION}" \
    org.opencontainers.image.title="Scryvex Pro"
# 1. Instalar dependencias base
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    git \
    python3 \
    python3-pip \
    build-essential \
    libavahi-compat-libdnssd-dev \
    postgresql \
    postgresql-contrib \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN command -v ffmpeg \
    && command -v ffprobe \
    && ffmpeg -hide_banner -version \
    && ffprobe -hide_banner -version

# 2. pnpm 11 (Con dangerouslyAllowAllBuilds en pnpm-workspace.yaml)
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate

# 3. TypeScript e utilidades globales
RUN npm install -g typescript rimraf

# 4. Directorio de trabajo
WORKDIR /usr/src/app

# 5. Configurar el origen de código (version + ref exacto)
ARG BUILD_VERSION
# Home Assistant only supplies BUILD_VERSION from config.yaml. Version labels
# are not necessarily Git refs during alpha/beta builds, so use main unless CI
# explicitly supplies a branch, tag or immutable SHA through SOURCE_REF.
ARG SOURCE_REF=main

RUN set -eux; \
    REF="${SOURCE_REF}"; \
    echo "Building Scryvex ${BUILD_VERSION} from ${REF}"; \
    git init .; \
    git remote add origin https://github.com/Chrisalvir1/Scryvex-Pro-V2.git; \
    git fetch --depth 1 origin "${REF}"; \
    git checkout --detach FETCH_HEAD

# 6. Descargas manuales de submódulos (probado localmente - NECESARIOS)
RUN rm -rf external/werift && git clone --depth 1 https://github.com/koush/werift-webrtc.git external/werift
RUN rm -rf external/unifi-protect && git clone --depth 1 https://github.com/koush/unifi-protect.git external/unifi-protect
RUN rm -rf external/ring-client-api && git clone --depth 1 -b fork https://github.com/koush/ring.git external/ring-client-api
RUN rm -rf plugins/onvif/onvif && git clone --depth 1 https://github.com/koush/onvif.git plugins/onvif/onvif

# 7. Parches: borrar engines (bloquea pnpm 11)
RUN node -e "const fs=require('fs'); let p='package.json'; let d=JSON.parse(fs.readFileSync(p)); delete d.engines; fs.writeFileSync(p,JSON.stringify(d,null,2));"

# 8. Instalar solamente el núcleo y sus dependencias transitivas. Los plugins
# no publicados por este add-on se validan por separado en monorepo-integrity.
RUN set -eux; \
    for i in 1 2 3; do \
      pnpm \
        --filter "@scryvex/contracts..." \
        --filter "@scryvex/server..." \
        --filter "frontend..." \
        install --frozen-lockfile && break || sleep 15; \
    done

# 8.5 Compilar Contratos, Backend y Frontend
RUN pnpm --filter @scryvex/contracts run build
RUN pnpm --filter @scryvex/server run build
RUN pnpm --filter frontend run build

# 8.6 Validar build y generar build-info.json en la imagen usando BUILD_VERSION
RUN test -f packages/contracts/dist/index.d.ts \
    && test -f server/dist/scrypted-main.js \
    && test -f server/dist/scrypted-server-main.js \
    && test -f frontend/dist/index.html \
    || { echo "Error: Build validation failed!"; exit 1; } \
    && echo "{\"version\": \"${BUILD_VERSION}\", \"buildTime\": \"$(date -Iseconds)\", \"node\": \"$(node -v)\", \"typescript\": \"7.0.2\"}" > server/dist/build-info.json

# 8.7 Validar que los logos existen en dist (no fatal — marcas opcionales)
RUN echo "=== Logos in public ===" \
    && find frontend/public/logos -maxdepth 1 -type f -print 2>/dev/null || echo "[WARN] No logos in frontend/public/logos" \
    && echo "=== Logos in dist ===" \
    && find frontend/dist/logos -maxdepth 1 -type f -print 2>/dev/null || echo "[WARN] No logos in frontend/dist/logos"

# 9. Copiar rootfs (servicios s6-rc)
COPY rootfs /

RUN set -eux; \
    test -x /usr/local/bin/scryvex-postgres-setup; \
    test -x /etc/s6-overlay/s6-rc.d/postgres-setup/up; \
    head -n 1 /etc/s6-overlay/s6-rc.d/postgres-setup/up | grep -qx '#!/command/execlineb -P'; \
    grep -qx '/usr/local/bin/scryvex-postgres-setup' \
        /etc/s6-overlay/s6-rc.d/postgres-setup/up; \
    ! grep -q '^until ' \
        /etc/s6-overlay/s6-rc.d/postgres-setup/up; \
    ls -la /usr/local/bin/scryvex-postgres-setup; \
    cat /etc/s6-overlay/s6-rc.d/postgres-setup/up; \
    bash -n /usr/local/bin/scryvex-postgres-setup; \
    command -v su; \
    command -v psql; \
    command -v createdb; \
    command -v pg_isready; \
    ls -la /usr/lib/postgresql/15/bin/

# 10. Validar versiones requeridas (Fase 0 - Matter Base)
RUN echo "=== Validating required versions ===" \
    && test -f /usr/src/app/server/node_modules/matterbridge/package.json
RUN set -eux; \
    NODE_VERSION="$(node --version)"; \
    MATTERBRIDGE_VERSION="$(node -e "\
        const fs = require('fs'); \
        const pkg = JSON.parse( \
            fs.readFileSync('/usr/src/app/server/node_modules/matterbridge/package.json', 'utf8') \
        ); \
        process.stdout.write(pkg.version); \
    ")"; \
    echo "Node.js version: ${NODE_VERSION}"; \
    echo "Matterbridge version: ${MATTERBRIDGE_VERSION}"; \
    case "${NODE_VERSION}" in \
        v24.*) ;; \
        *) echo "Error: Node.js 24 is required"; exit 1 ;; \
    esac; \
    test "${MATTERBRIDGE_VERSION}" = "3.9.4"; \
    echo "Node and Matterbridge versions OK"

# 11. Arranque gestionado por Home Assistant Base Image (ENTRYPOINT /init)
