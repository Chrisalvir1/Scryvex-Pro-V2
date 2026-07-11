ARG BUILD_FROM=ghcr.io/home-assistant/aarch64-base-debian:bookworm
FROM $BUILD_FROM

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

# 5. Clonar el repositorio base usando BUILD_VERSION como cache-buster y branch target
ARG BUILD_VERSION
RUN echo "Fetching Scryvex source tag ${BUILD_VERSION}" \
    && git clone --depth 1 --branch "${BUILD_VERSION}" https://github.com/Chrisalvir1/Scryvex-Pro-V2.git .

# 6. Descargas manuales de submódulos (probado localmente - NECESARIOS)
RUN rm -rf external/werift && git clone --depth 1 https://github.com/koush/werift-webrtc.git external/werift
RUN rm -rf external/unifi-protect && git clone --depth 1 https://github.com/koush/unifi-protect.git external/unifi-protect
RUN rm -rf external/ring-client-api && git clone --depth 1 -b fork https://github.com/koush/ring.git external/ring-client-api
RUN rm -rf plugins/onvif/onvif && git clone --depth 1 https://github.com/koush/onvif.git plugins/onvif/onvif

# 7. Parches: borrar engines (bloquea pnpm 11)
RUN node -e "const fs=require('fs'); let p='package.json'; let d=JSON.parse(fs.readFileSync(p)); delete d.engines; fs.writeFileSync(p,JSON.stringify(d,null,2));"

# 8. Instalar (dangerouslyAllowAllBuilds en pnpm-workspace.yaml autoriza nativos)
RUN pnpm install --no-frozen-lockfile

# 8.5 Compilar Backend y Frontend
RUN pnpm --filter @scryvex/server run build
RUN pnpm --filter frontend run build

# 8.6 Validar build y generar build-info.json en la imagen usando BUILD_VERSION
RUN if [ ! -f "server/dist/scrypted-main.js" ]; then echo "Error: Backend build failed, scrypted-main.js not found!" && exit 1; fi \
    && echo "{\"version\": \"${BUILD_VERSION}\", \"buildTime\": \"$(date -Iseconds)\", \"node\": \"$(node -v)\", \"typescript\": \"7.0.2\"}" > server/dist/build-info.json

# 8.7 Validar que los logos existen en dist (no fatal — marcas opcionales)
RUN echo "=== Logos in public ===" \
    && find frontend/public/logos -maxdepth 1 -type f -print 2>/dev/null || echo "[WARN] No logos in frontend/public/logos" \
    && echo "=== Logos in dist ===" \
    && find frontend/dist/logos -maxdepth 1 -type f -print 2>/dev/null || echo "[WARN] No logos in frontend/dist/logos"

# 9. Copiar rootfs (servicios s6-rc)
COPY rootfs /

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

# 11. Arranque con s6-overlay
CMD [ "/init" ]
