FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY engine ./engine
COPY server ./server
COPY web ./web
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://localhost:${PORT}/healthz || exit 1
CMD ["node", "server/server.js"]
