# See ../frontend/Dockerfile for the VITE_* build-time-baking rationale.
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ARG VITE_API_URL
ARG VITE_PACKETA_API_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PACKETA_API_URL=$VITE_PACKETA_API_URL

RUN npm run build

EXPOSE 5174

CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5174"]
