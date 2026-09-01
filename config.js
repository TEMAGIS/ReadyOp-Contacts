// ---------------------------------------------------------------------------
// App configuration. Nothing in this file is secret — it's safe to commit
// to a public repo. The actual ReadyOp account_id/token are never stored
// here; they're fetched at runtime from the protected feature layer below,
// after the user signs in with ArcGIS.
// ---------------------------------------------------------------------------

export const CONFIG = {
  // --- ArcGIS OAuth ---
  // Portal to authenticate against. Use "https://www.arcgis.com" for any
  // ArcGIS Online org, or "https://<your-org>.maps.arcgis.com" to skip the
  // "choose your organization" step on the sign-in screen.
  ARCGIS_PORTAL_URL: "https://www.arcgis.com",

  // Your registered ArcGIS OAuth application's client ID.
  ARCGIS_APP_ID: "x7YT2DckqrgUfSQf",

  // --- Credentials source ---
  // The protected feature layer holding the ReadyOp account_id/token as its
  // one record. Read at runtime using the signed-in user's ArcGIS token.
  CREDENTIALS_LAYER_URL:
    "https://services1.arcgis.com/kILp9lqGUeOhnDbI/arcgis/rest/services/ReadyOp/FeatureServer/0",

  // Field names on that layer holding the two values.
  // >>> VERIFY these against your layer's actual schema (Fields list in the
  //     item's Data tab) and correct them if they don't match. <<<
  ACCOUNT_ID_FIELD: "account_id",
  TOKEN_FIELD: "token",

  // --- ReadyOp ---
  // Agency ID, same as the "1" in your Python pattern's /Contacts/1/ URL.
  READYOP_AGENCY_ID: "1",

  // ReadyOp's API sends no CORS headers, so the browser can't call
  // tn.readyop.com directly (see README). Point this at the relay for now.
  // If ReadyOp later whitelists this app's origin(s), switch this to
  // READYOP_DIRECT_BASE_URL and delete the relay entirely.
  READYOP_API_BASE_URL: "https://READYOP-RELAY-PLACEHOLDER.workers.dev",
  READYOP_DIRECT_BASE_URL: "https://tn.readyop.com",

  // Contacts list page size (ReadyOp allows up to 10,000; keep it modest
  // for a responsive UI and paginate instead).
  PAGE_SIZE: 100,
};
