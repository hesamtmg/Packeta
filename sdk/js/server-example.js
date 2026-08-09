/**
 * server-example.js — the server half of the "no UI engineer" Packeta
 * integration. Neither browser script in this folder (packeta.js for
 * payments, wallet-widget.js for the inline wallet widget) ever talks to
 * Packeta directly — they talk to this, because your Packeta account
 * credentials must never reach the browser.
 *
 * This is a working reference in Express, but it's genuinely ~20 lines of
 * logic per endpoint: fetch a token, cache it, POST to the relevant Packeta
 * endpoint, hand back only what the browser needs. The same shape works in
 * any backend language.
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
// POST /api/packeta/widget-session — what wallet-widget.js's auto-wired
// container calls. Mints a short-lived, wallet-scoped session token
// server-to-server (your real Packeta login never reaches the browser,
// same reasoning as the charge endpoint above) and hands back just enough
// for the browser to mount the widget.
// ---------------------------------------------------------------------
router.post('/api/packeta/widget-session', async (req, res) => {
  const { walletId, phoneNumber } = req.body || {};
  if (!walletId) {
    return res.status(400).json({ message: 'walletId is required' });
  }

  try {
    const token = await getToken();
    const sessionRes = await fetch(`${PACKETA_API_URL}/widget/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // phoneNumber is only meaningful (and required) when the wallet
      // type's widgetRequiresOtp is off — see the "non-OTP" mode in
      // README.md. Harmless to always forward it: Packeta ignores it for
      // OTP-mode wallets.
      body: JSON.stringify({ walletId, phoneNumber }),
    });
    const data = await sessionRes.json();
    if (!sessionRes.ok) {
      return res.status(sessionRes.status).json(data);
    }
    res.json({
      sessionToken: data.sessionToken,
      widgetUrl: data.widgetUrl,
      expiresAt: data.expiresAt,
    });
  } catch (err) {
    res.status(502).json({ message: 'Could not reach Packeta', detail: err.message });
  }
});

// ---------------------------------------------------------------------
// Confirmed-status store, keyed by transactionId. Fed two ways below:
// pushed into by the webhook handler, or filled lazily by the polling
// endpoint. A module-level Map is fine for a single-process demo; a real
// deployment would persist this on the order record itself (see the
// TODO in the webhook handler).
// ---------------------------------------------------------------------
const chargeStatusStore = new Map();

// ---------------------------------------------------------------------
// POST /webhooks/packeta — Packeta calls this when a charge settles
// (the "reverse"/push confirmation: Packeta's backend calls yours). Point
// your merchant wallet's callbackUrl at this route.
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

  if (transactionId) {
    chargeStatusStore.set(transactionId, {
      status,
      amount,
      confirmedVia: 'webhook',
    });
  }

  res.sendStatus(200);
});

// ---------------------------------------------------------------------
// GET /api/packeta/charge/:transactionId/status — the "forward"/pull
// confirmation: your own backend asks Packeta for the ground truth,
// using your merchant credentials, instead of trusting whatever the
// customer's browser reports via onComplete. Never mark an order paid off
// the browser callback alone — a tampered client could report anything;
// this route (or the webhook above) is the only status your fulfillment
// logic should ever act on.
//
// Checks the webhook store first (near-instant, no extra network call if
// Packeta has already pushed the result); falls back to asking Packeta
// directly for anyone who calls this before the webhook arrives, or who
// hasn't wired a callbackUrl up at all.
// ---------------------------------------------------------------------
router.get('/api/packeta/charge/:transactionId/status', async (req, res) => {
  const { transactionId } = req.params;

  const cached = chargeStatusStore.get(transactionId);
  if (cached) {
    return res.json({ transactionId, ...cached });
  }

  try {
    const token = await getToken();
    const txnRes = await fetch(`${PACKETA_API_URL}/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await txnRes.json();
    if (!txnRes.ok) {
      return res.status(txnRes.status).json(data);
    }
    const result = { status: data.status, amount: data.amount, confirmedVia: 'poll' };
    // Only cache a terminal result — PENDING can still change, so the next
    // call should ask again rather than getting stuck on a stale answer.
    if (data.status !== 'PENDING') {
      chargeStatusStore.set(transactionId, result);
    }
    res.json({ transactionId, ...result });
  } catch (err) {
    res.status(502).json({ message: 'Could not reach Packeta', detail: err.message });
  }
});

module.exports = router;
