# Tilting Heads Catalogue — production image
FROM node:20-alpine AS base

WORKDIR /app

# Install deps first (better layer cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App source
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY data ./data

ENV NODE_ENV=production
ENV PORT=5050

EXPOSE 5050

USER node

CMD ["node", "src/server.js"]
