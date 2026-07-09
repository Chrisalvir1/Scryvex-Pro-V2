ARG BUILD_FROM
FROM $BUILD_FROM

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    python3 \
    python3-pip \
    libavahi-compat-libdnssd-dev \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm

WORKDIR /usr/src/app

# Clone the repository
RUN git clone https://github.com/Chrisalvir1/Scryvex-Pro.git .

# Install dependencies and build
RUN pnpm install
RUN pnpm run build

# Start the server
CMD ["pnpm", "run", "start"]
