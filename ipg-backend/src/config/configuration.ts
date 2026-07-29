export default () => ({
  port: parseInt(process.env.PORT ?? '4000', 10),
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5433', 10),
    username: process.env.DB_USERNAME ?? 'ipg',
    password: process.env.DB_PASSWORD ?? 'ipg',
    name: process.env.DB_DATABASE ?? 'packeta_ipg',
  },
  ipgApiKey: process.env.IPG_API_KEY ?? 'sandbox-ipg-key',
  frontendUrl: process.env.IPG_FRONTEND_URL ?? 'http://localhost:5174',
});
