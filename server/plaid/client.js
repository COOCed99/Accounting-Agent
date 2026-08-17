import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import 'dotenv/config';

/**
 * The spec asks for `PLAID_ENV=development`. Plaid retired the Development
 * tier and the SDK (v31) no longer defines that host — only `sandbox` and
 * `production` exist. The free allowance the spec was relying on ("free up to
 * 100 Items") now lives on Production, so `development` is accepted and mapped
 * there with a warning rather than failing on a value that came straight out
 * of the build spec.
 */
function resolveEnv() {
  const requested = (process.env.PLAID_ENV || 'production').toLowerCase();

  if (requested === 'development') {
    console.warn(
      "[plaid] PLAID_ENV=development: Plaid retired the Development tier and the SDK no longer\n" +
      "        defines that host. Using Production, which now carries the free 100-Item\n" +
      "        allowance. Set PLAID_ENV=production in .env to silence this."
    );
    return 'production';
  }

  if (!PlaidEnvironments[requested]) {
    throw new Error(
      `PLAID_ENV='${requested}' is not a Plaid environment. Valid values: ${Object.keys(PlaidEnvironments).join(', ')}`
    );
  }
  return requested;
}

let cached = null;

/**
 * Lazily built so that importing this module — which the engine tests do
 * transitively — never demands credentials.
 */
export function plaid() {
  if (cached) return cached;

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      'PLAID_CLIENT_ID and PLAID_SECRET must be set. Copy .env.example to .env and fill them in.'
    );
  }

  cached = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[resolveEnv()],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret
        }
      }
    })
  );
  return cached;
}

export function isConfigured() {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

/** Plaid errors arrive nested; surface the part that says what to do. */
export function plaidErrorMessage(error) {
  const data = error?.response?.data;
  if (!data) return error?.message ?? String(error);
  return [data.error_code, data.error_message].filter(Boolean).join(': ') || JSON.stringify(data);
}
