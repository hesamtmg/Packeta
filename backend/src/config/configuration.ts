export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'packeta',
    password: process.env.DB_PASSWORD ?? 'packeta',
    name: process.env.DB_DATABASE ?? 'packeta',
  },
  mongo: {
    uri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/packeta_logs',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  },
});
