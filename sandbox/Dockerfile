FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive DISPLAY=:99 CHROMIUM_PATH=/usr/bin/chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb openbox x11vnc novnc websockify \
    git python3 python3-pip python3-venv curl ca-certificates \
    fonts-noto-cjk fonts-liberation ripgrep unzip zip \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1000 agent 2>/dev/null || true
RUN usermod -l agent -d /home/agent node \
    && mkdir -p /workspace /home/agent \
    && chown -R 1000:1000 /workspace /home/agent

WORKDIR /opt/picoding
COPY package.json package-lock.json .npmrc tsconfig.json tsconfig.server.json ./
RUN npm ci --ignore-scripts --omit=optional --no-audit --no-fund
COPY shared ./shared
COPY server ./server
COPY sandbox ./sandbox
COPY scripts/doctor.ts ./scripts/doctor.ts
RUN npx tsc -p tsconfig.server.json
RUN chmod +x /opt/picoding/sandbox/entrypoint.sh

USER 1000:1000
WORKDIR /workspace
EXPOSE 4311
ENTRYPOINT ["/opt/picoding/sandbox/entrypoint.sh"]
