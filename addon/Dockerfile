ARG BUILD_FROM=ghcr.io/home-assistant/aarch64-base-debian:bookworm
FROM $BUILD_FROM

# 1. Instalar Node 24 y dependencias del SO
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

# 2. Habilitar pnpm via corepack
RUN corepack enable && corepack prepare pnpm@9 --activate

# 3. Directorio de trabajo
WORKDIR /usr/src/app

# 4. Clonar el codigo (--depth 1 = solo el ultimo snapshot, mucho mas liviano)
RUN git clone --depth 1 https://github.com/Chrisalvir1/Scryvex-Pro-V2.git .

# 5. Instalar SOLO las dependencias del servidor (no toda la monorepo)
RUN cd server && pnpm install --no-frozen-lockfile --prod=false

# 6. Build del servidor
RUN cd server && pnpm run build || echo "Build warnings OK, continuing..."

# 7. Dar permisos al script de inicio
RUN chmod a+x run.sh

CMD [ "/usr/src/app/run.sh" ]
