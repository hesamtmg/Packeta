# See backend/Dockerfile for the rationale (single-stage, dev/demo-oriented,
# migrations run via ts-node at container startup).
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 4000

CMD ["sh", "-c", "npm run migration:run && node dist/main.js"]
