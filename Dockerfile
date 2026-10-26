FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev --ignore-scripts && \
    chown -R node:node /app

COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
