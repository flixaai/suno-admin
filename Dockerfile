FROM ghcr.io/puppeteer/puppeteer:22.6.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Beralih ke root untuk install dependencies
USER root

WORKDIR /app

# Copy package files dulu (layer cache)
COPY package.json ./

# Install dependencies sebagai root
RUN npm install --omit=dev --no-package-lock && \
    npm cache clean --force

# Copy sisa source code
COPY . .

# Buat folder runtime + set ownership ke pptruser
RUN mkdir -p sessions data logs && \
    echo '[]' > data/accounts.json && \
    echo '[]' > data/queue.json && \
    chown -R pptruser:pptruser /app

# Kembali ke user non-root (best practice keamanan)
USER pptruser

EXPOSE 3000

CMD ["node", "server.js"]