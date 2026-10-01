FROM ghcr.io/puppeteer/puppeteer:22.6.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV NODE_ENV=production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Use npm install (bukan npm ci) karena package-lock.json mungkin belum ada
# --omit=dev = skip devDependencies (pengganti --only=production yang sudah deprecated)
RUN npm install --omit=dev

# Copy seluruh source code
COPY . .

# Buat folder sessions & data
RUN mkdir -p sessions data && \
    echo '[]' > data/accounts.json && \
    echo '[]' > data/queue.json

EXPOSE 3000

USER root
CMD ["node", "server.js"]