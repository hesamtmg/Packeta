# Single-stage, dev/demo-oriented image — installs full dependencies
# (including devDependencies, since migrations run via ts-node at startup
# through the same `npm run migration:run` script developers already use
# locally) and runs the compiled app. Not optimized for minimal image size;
# optimized for "docker compose up" just working.
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

# Run pending migrations, then start the compiled server. Safe to run on
# every container start — typeorm's migration:run is a no-op once the DB
# is already up to date.
CMD ["sh", "-c", "npm run migration:run && node dist/main.js"]
