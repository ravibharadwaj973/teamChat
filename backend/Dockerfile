# syntax=docker/dockerfile:1
# Build context: repo root (backend/ requires ../config, ../models, ../shared
# and embeds+starts ../socket/socket.js in-process, so all of that has to be
# in the image alongside backend/ itself).
#   docker build -t teamspace-backend -f backend/Dockerfile .

FROM node:22-alpine AS base
WORKDIR /app

# Root-level workspace: config/db.js, models/*.js and shared/*.js all
# resolve `require("mongoose")` against THIS node_modules.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY config ./config
COPY models ./models
COPY shared ./shared

# server.js does `new (require("../socket/socket"))().start(5001)` in-process.
COPY socket/package.json socket/package-lock.json ./socket/
RUN npm --prefix socket ci --omit=dev
COPY socket ./socket

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev
COPY backend ./backend

WORKDIR /app/backend
ENV NODE_ENV=production \
    PORT=7000

USER node
# 7000 = REST API, 5001 = the Socket.IO server backend embeds and starts itself
EXPOSE 7000 5001
CMD ["node", "server.js"]
