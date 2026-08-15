# syntax=docker/dockerfile:1
# Build context: repo root (socket.js requires ../config, ../models,
# ../shared, and its Redis client from ../backend/lib/redis.js, so backend's
# package has to be installed here too).
#   docker build -t teamspace-socket -f socket/Dockerfile .

FROM node:22-alpine AS base
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY config ./config
COPY models ./models
COPY shared ./shared

# socket.js: const redisClient = require("../backend/lib/redis")
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev
COPY backend ./backend

COPY socket/package.json socket/package-lock.json ./socket/
RUN npm --prefix socket ci --omit=dev
COPY socket ./socket

WORKDIR /app/socket
ENV NODE_ENV=production \
    SOCKET_PORT=5001

USER node
EXPOSE 5001
CMD ["node", "index.js"]
