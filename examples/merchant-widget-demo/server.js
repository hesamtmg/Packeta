/**
 * server.js — a minimal "merchant host" site: exactly what a real merchant
 * would run, used here as the manual test rig for wallet-widget.js and as
 * a second, permanent reference implementation alongside server-example.js.
 *
 * Required env vars (same as sdk/js/server-example.js):
 *   PACKETA_API_URL   e.g. http://localhost:3000
 *   PACKETA_EMAIL     a merchant account's login email
 *   PACKETA_PASSWORD  that account's login password
 *
 * Run with:
 *   npm install
 *   PACKETA_API_URL=http://localhost:3000 PACKETA_EMAIL=... PACKETA_PASSWORD=... npm start
 */

const path = require('path');
const express = require('express');
const packeta = require('../../sdk/js/server-example');

const app = express();

// Serves wallet-widget.js straight from the SDK folder so this demo never
// drifts from what merchants actually get — a real merchant would instead
// copy the file onto their own static assets (see sdk/js/README.md).
app.use(express.static(path.join(__dirname, '../../sdk/js')));
app.use(express.static(__dirname));

// The actual "merchant backend" logic: token caching + the
// /api/packeta/widget-session proxy route this page's JS calls.
app.use(packeta);

const port = process.env.PORT || 4100;
app.listen(port, () => {
  console.log(`merchant-widget-demo listening on http://localhost:${port}`);
});
