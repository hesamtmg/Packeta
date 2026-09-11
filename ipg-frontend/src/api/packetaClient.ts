import { createApiClient } from './client';

// Packeta's own backend — used directly by the customer's browser for the
// phone+OTP identification step and wallet selection on a merchant-initiated
// charge. These are unauthenticated endpoints (no Packeta session exists on
// this device); see backend/src/purchase-gateway.
export const PACKETA_API_URL = import.meta.env.VITE_PACKETA_API_URL ?? 'http://localhost:3000';
export const packetaRequest = createApiClient(PACKETA_API_URL);
