ARG BUILD_FROM=node:24-bookworm-slim
FROM $BUILD_FROM

# 1. Instalar dependencias ESTRICTAS (Sin basura gráfica de 1GB)
RUN apt-get update && apt-get install -y --no-install-recommends \
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

# 4. Clonar el código completo del repositorio (unica forma de acceder a la raiz desde una subcarpeta HA)
# COPY . . solo ve la subcarpeta addon/, NO la raiz con package.json y server/
RUN git clone --depth 1 https://github.com/Chrisalvir1/Scryvex-Pro-V2.git .

# 5. Instalar dependencias
RUN pnpm install --no-frozen-lockfile

# 6. Permisos y arranque
RUN chmod a+x run.sh
CMD [ "./run.sh" ]
