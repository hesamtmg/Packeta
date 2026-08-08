/**
 * server-example.js — the server half of the "no UI engineer" Packeta
 * integration. packeta.js (the browser script) never talks to Packeta
 * directly — it talks to this, because your Packeta account credentials
 * must never reach the browser.
 *
 * This is a working reference in Express, but it's genuinely ~20 lines of
 * logic: fetch a token, cache it, POST to /transactions/purchase/charge,
 * hand back the redirectUrl. The same shape works in any backend language.
 *
 * Wire it in with:
 *   const packeta = require('./server-example');
 *   app.use(packeta);
 *
 * Required env vars:
 *   PACKETA_API_URL   e.g. https://api.packeta.example.com
 *   PACKETA_EMAIL     your merchant account's login email
 *   PACKETA_PASSWORD  your merchant account's login password
 *
 * Requires Node 18+ (built-in fetch and crypto.randomUUID). On older Node,
 * swap in node-fetch and the `uuid` package instead.
 */

const express = require('express');
const crypto = require('crypto');

const { PACKETA_API_URL, PACKETA_EMAIL, PACKETA_PASSWORD } = process.env;

const router = express.Router();
router.use(express.json());

// ---------------------------------------------------------------------
// Token cache. Packeta issues no refresh token — logging in again *is*
// the refresh — so this just re-logs-in a few minutes before the current
// token would expire (default token lifetime is 1h; see backend
// JWT_EXPIRES_IN). A module-level variable is fine for a single-process
// deployment; behind a load balancer, swap this for a shared cache (Redis
// etc.) so every instance isn't logging in independently.
// ---------------------------------------------------------------------
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }
  const res = await fetch(`${PACKETA_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PACKETA_EMAIL, password: PACKETA_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Packeta login failed (HTTP ${res.status})`);
  }
  const data = await res.json();
  cachedToken = data.accessToken;
  cachedTokenExpiresAt = Date.now() + 55 * 60 * 1000; // refresh 5 min early
  return cachedToken;
}

// ---------------------------------------------------------------------
// POST /api/packeta/charge — what packeta.js's Pay button calls.
// Creates the charge and hands back just enough for the browser to
// redirect: nothing here needs your Packeta credentials.
// ---------------------------------------------------------------------
router.post('/api/packeta/charge', async (req, res) => {
  const { amount, currency, language } = req.body || {};
  if (!Number.isInteger(amount) || amount < 1) {
    return res.status(400).json({ message: 'amount must be a positive integer in minor units' });
  }
  if (!currency) {
    return res.status(400).json({ message: 'currency is required' });
  }

  try {
    const token = await getToken();
    const chargeRes = await fetch(`${PACKETA_API_URL}/transactions/purchase/charge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        // A fresh key per charge — see the idempotency section of
        // THIRD_PARTY_INTEGRATION.md for what this protects against.
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        amount,
        currencyCode: currency,
        language: language || 'en',
      }),
    });
    const data = await chargeRes.json();
    if (!chargeRes.ok) {
      return res.status(chargeRes.status).json(data);
    }
    res.json({
      redirectUrl: data.redirectUrl,
      transactionId: data.transactionId,
      expiresAt: data.expiresAt,
    });
  } catch (err) {
    res.status(502).json({ message: 'Could not reach Packeta', detail: err.message });
  }
});

// ---------------------------------------------------------------------
// POST /webhooks/packeta — Packeta calls this when a charge settles.
// Point your merchant wallet's callbackUrl at this route.
// ---------------------------------------------------------------------
router.post('/webhooks/packeta', express.json(), (req, res) => {
  const { transactionId, status, amount } = req.body || {};

  // TODO: replace with your own order lookup + fulfillment.
  // Two things to get right:
  //   1. This delivery is best-effort and at-least-once — the same
  //      transactionId can arrive more than once, so make whatever you do
  //      here idempotent (e.g. "set order X to paid" rather than
  //      "increment paid orders by one").
  //   2. status is one of PENDING | COMPLETED | REVERSED — only COMPLETED
  //      means the money actually moved.
  console.log('Packeta webhook:', { transactionId, status, amount });

  res.sendStatus(200);
});

module.exports = router;
