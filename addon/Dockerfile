ARG BUILD_FROM=node:24-bookworm-slim
FROM $BUILD_FROM

# 1. Instalar dependencias del SO
RUN apt-get update && apt-get install -y \
    ffmpeg \
    postgresql-client \
    git \
    python3 \
    python3-pip \
    build-essential \
    libavahi-compat-libdnssd-dev \
    && rm -rf /var/lib/apt/lists/*

# 2. Habilitar pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 3. Directorio de trabajo
WORKDIR /usr/src/app

# 4. Copiar todo el código localmente (SIN GIT CLONE)
COPY . .

# 5. Instalar dependencias (Saltando errores de nube y lockfile)
RUN pnpm install --no-frozen-lockfile

# 6. Permisos y arranque
RUN chmod a+x run.sh
CMD [ "./run.sh" ]
