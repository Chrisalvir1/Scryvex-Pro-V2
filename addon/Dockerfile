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

# 2. Forzar pnpm 8 (Que no tiene candados paranoicos de seguridad)
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate

# 3. Directorio de trabajo
WORKDIR /usr/src/app

# 4. Clonar el repositorio base
ARG CACHE_BUST=8
RUN git clone --depth 1 https://github.com/Chrisalvir1/Scryvex-Pro-V2.git .

# 5. Descargas manuales (Solucionan los submódulos rotos)
RUN rm -rf external/werift && git clone --depth 1 https://github.com/koush/werift-webrtc.git external/werift
RUN rm -rf external/unifi-protect && git clone --depth 1 https://github.com/koush/unifi-protect.git external/unifi-protect
RUN rm -rf external/ring-client-api && git clone --depth 1 -b fork https://github.com/koush/ring.git external/ring-client-api
RUN rm -rf plugins/onvif/onvif && git clone --depth 1 https://github.com/koush/onvif.git plugins/onvif/onvif

# 6. Borrar el script de publicación que rompe TypeScript
RUN node -e "const fs = require('fs'); const p = 'sdk/package.json'; const d = JSON.parse(fs.readFileSync(p)); delete d.scripts.prepublishOnly; fs.writeFileSync(p, JSON.stringify(d, null, 2));"

# 7. EL GOLPE FINAL: Instalar ignorando estrictamente si pide la versión 9
RUN pnpm config set engine-strict false
RUN pnpm install --no-frozen-lockfile --config.engine-strict=false

# 8. Permisos y arranque
RUN chmod a+x run.sh
CMD [ "./run.sh" ]
