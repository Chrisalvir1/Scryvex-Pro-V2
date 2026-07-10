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

# 2. pnpm 11 (Con dangerouslyAllowAllBuilds en pnpm-workspace.yaml)
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate

# 3. TypeScript e utilidades globales
RUN npm install -g typescript rimraf

# 4. Directorio de trabajo
WORKDIR /usr/src/app

# 5. Copiar el código del Add-on (provisto directamente por HA Supervisor)
COPY . .

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

# 8.6 Validar build y generar build-info.json en la imagen
RUN if [ ! -f "server/dist/scrypted-main.js" ]; then echo "Error: Backend build failed, scrypted-main.js not found!" && exit 1; fi \
    && echo "{\"version\": \"$(cat addon/config.yaml | grep version | awk -F'\"' '{print $2}')\", \"buildTime\": \"$(date -Iseconds)\", \"node\": \"$(node -v)\", \"typescript\": \"7.0.2\"}" > server/dist/build-info.json

# 9. Permisos y arranque
RUN chmod a+x run.sh
CMD [ "./run.sh" ]
