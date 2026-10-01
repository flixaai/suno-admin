FROM ghcr.io/puppeteer/puppeteer:22.6.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p sessions data && \
    echo '[]' > data/accounts.json 2>/dev/null || true && \
    echo '[]' > data/queue.json 2>/dev/null || true

EXPOSE 3000

CMD ["node", "server.js"]