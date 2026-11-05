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
  ipg: {
    baseUrl: process.env.IPG_BASE_URL ?? 'http://localhost:4000',
    apiKey: process.env.IPG_API_KEY ?? 'sandbox-ipg-key',
  },
  // ZarinPal — the real-money gateway deposits are verified through (see
  // ZarinpalClientService). Defaults to ZarinPal's public sandbox, which
  // accepts any well-formed merchant id and settles no real money.
  zarinpal: {
    baseUrl: process.env.ZARINPAL_BASE_URL ?? 'https://sandbox.zarinpal.com',
    merchantId:
      process.env.ZARINPAL_MERCHANT_ID ??
      'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  },
  // Sadad (Bank Melli PSP) — the alternative real-money gateway a
  // super-admin can switch to from the admin panel (see
  // PaymentGatewayService). Credentials come from Sadad; the TerminalKey is
  // Base64 (24 bytes once decoded). Wallet amounts are multiplied by
  // amountMultiplier before being sent (10 = Toman wallet → Rial for Sadad).
  sadad: {
    merchantId: process.env.SADAD_MERCHANT_ID ?? '',
    terminalId: process.env.SADAD_TERMINAL_ID ?? '',
    terminalKey: process.env.SADAD_TERMINAL_KEY ?? '',
    apiBaseUrl: process.env.SADAD_API_URL ?? 'https://sadad.shaparak.ir',
    purchaseBaseUrl:
      process.env.SADAD_PURCHASE_URL ?? 'https://sadad.shaparak.ir',
    amountMultiplier: parseInt(process.env.SADAD_AMOUNT_MULTIPLIER ?? '10', 10),
  },
  // This backend's public, browser-reachable base URL (e.g.
  // https://packeta.ir/api). Sadad POSTs the customer back to
  // <backendPublicUrl>/payment-gateway/sadad/return.
  backendPublicUrl: process.env.BACKEND_PUBLIC_URL ?? 'http://localhost:3000',
  // Where the customer's browser lands after the IPG redirects back — used
  // to build each purchase's callbackUrl.
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  // The IPG's own pay page (ipg-frontend) — used to send a ZarinPal credit
  // shortfall top-up's callback back to the branded merchant-purchase flow
  // instead of Packeta's own (login-gated) app, since the customer never
  // had a Packeta session to begin with. See
  // TransactionsService.initiateSupportTopUp.
  ipgFrontendUrl: process.env.IPG_FRONTEND_URL ?? 'http://localhost:5174',
});
