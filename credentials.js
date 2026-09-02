// ---------------------------------------------------------------------------
// Fetches the ReadyOp account_id/token from the protected ArcGIS feature
// layer, using the signed-in user's ArcGIS portal token to authorize the
// read. The values are kept only in memory (a module-level variable) for
// the lifetime of the page — never written to localStorage, sessionStorage,
// or any file.
// ---------------------------------------------------------------------------

import { CONFIG } from "./config.js?v=20260902o";

let cached = null;

/**
 * @param {string} arcgisToken - the signed-in user's ArcGIS portal token
 * @returns {Promise<{accountId: string, token: string}>}
 */
export async function getReadyOpCredentials(arcgisToken) {
  if (cached) return cached;

  const url = new URL(`${CONFIG.CREDENTIALS_LAYER_URL}/query`);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", `${CONFIG.ACCOUNT_ID_FIELD},${CONFIG.TOKEN_FIELD}`);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");
  url.searchParams.set("token", arcgisToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Credentials layer query failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(
      `Credentials layer query failed: ${data.error.message || JSON.stringify(data.error)}`
    );
  }
  const feature = data.features && data.features[0];
  if (!feature) {
    throw new Error("Credentials layer returned no records.");
  }

  const accountId = feature.attributes[CONFIG.ACCOUNT_ID_FIELD];
  const token = feature.attributes[CONFIG.TOKEN_FIELD];
  if (!accountId || !token) {
    throw new Error(
      `Credentials layer record is missing "${CONFIG.ACCOUNT_ID_FIELD}" or "${CONFIG.TOKEN_FIELD}". ` +
        `Check the field names in config.js against the layer's actual schema.`
    );
  }

  cached = { accountId: String(accountId), token: String(token) };
  return cached;
}

/** Clears the in-memory cache (e.g. on sign-out). */
export function clearCredentialsCache() {
  cached = null;
}
