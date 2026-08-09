# Dev/demo-oriented image: builds the SPA then serves it with Vite's own
# preview server (no separate nginx config to maintain). VITE_* variables
# are baked into the built bundle at *build* time — Vite inlines
# import.meta.env.VITE_* references — so they must already be set to
# whatever the *browser* on the host machine can reach (typically
# http://localhost:<published-port>), not an internal docker-network
# hostname. docker-compose passes these in via `build.args`.
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

EXPOSE 5173

CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
