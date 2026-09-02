// ---------------------------------------------------------------------------
// App configuration. Nothing in this file is secret — it's safe to commit
// to a public repo. The actual ReadyOp account_id/token are never stored
// here; they're fetched at runtime from the protected feature layer below,
// after the user signs in with ArcGIS.
// ---------------------------------------------------------------------------

export const CONFIG = {
  // --- ArcGIS OAuth (authorization-code + PKCE, no ArcGIS Maps SDK needed) ---
  // Portal to authenticate against. Use "https://www.arcgis.com" for any
  // ArcGIS Online org, or "https://<your-org>.maps.arcgis.com" to skip the
  // "choose your organization" step on the sign-in screen.
  ARCGIS_PORTAL_URL: "https://www.arcgis.com",

  // Your registered ArcGIS OAuth application's client ID. Must be
  // registered as a "Native Application" (or similar public-client type)
  // so PKCE works without a client secret.
  ARCGIS_APP_ID: "x7YT2DckqrgUfSQf",

  // Must exactly match a Redirect URI registered on that OAuth app
  // (including trailing slash). This app's own root doubles as its OAuth
  // callback page — no separate callback file needed.
  ARCGIS_REDIRECT_URI: "https://temagis.github.io/ReadyOp-Contacts/",

  // Refresh-token lifetime in MINUTES (ArcGIS max is 20160 = 14 days).
  // Governs how long a signed-in session lasts before a full re-login.
  ARCGIS_TOKEN_EXPIRATION_MINUTES: 20160,

  // Refresh the access token this many ms before it actually expires.
  ARCGIS_REFRESH_BUFFER_MS: 5 * 60 * 1000,

  // localStorage key the ArcGIS token is cached under.
  ARCGIS_TOKEN_STORAGE_KEY: "readyop_contacts_arcgis_token_v1",

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
  READYOP_API_BASE_URL: "https://readyop-contacts-relay.alan-spraggins.workers.dev",
  READYOP_DIRECT_BASE_URL: "https://tn.readyop.com",

  // --- Roster loading & search ---
  // The single search box and the Region/County filters all need to
  // match on fields ReadyOp's search API can't combine into one query
  // (see REGION_FIELD/COUNTY_FIELD below) — so instead of paging through
  // search results from the server, the app fetches the WHOLE roster
  // once per sign-in (a few requests of this page size each, well under
  // ReadyOp's documented 10,000-row max) and keeps it in memory. Search
  // and every filter then run instantly against that in-memory copy, and
  // "continuous scroll" just reveals more of the already-filtered array
  // rather than fetching more from the network.
  ROSTER_FETCH_PAGE_SIZE: 1000,

  // How many rows to render into the DOM per batch as the user scrolls
  // (rendering all ~3,000+ rows at once would be wasteful — this keeps
  // the list responsive by only building rows as they're needed).
  RENDER_BATCH_SIZE: 100,

  // --- Region / County filters ---
  // ReadyOp's REST API has no native "Region" or "County" field — this
  // agency's roster uses two of its ten generic custom columns for them
  // (Agency Administrator > Access > Agencies > double-click agency >
  // Modify Agency, to see/rename all ten). Confirmed from a live API
  // response: the JSON key is "Custom 8" (contacts use "Custom 0" through
  // "Custom 20" as field names — NOT the "Custom_1".."Custom_10" naming
  // ReadyOp's docs use for search filter params, which is why these are
  // matched client-side rather than as server-side search parameters of
  // uncertain name.
  REGION_FIELD: "Custom 8",
  COUNTY_FIELD: "Custom 1",
  // Fixed options for the Region filter's pill row. Matching against
  // REGION_FIELD is case-insensitive, so "Southeast" also matches a
  // "southeast" value in the data.
  REGION_OPTIONS: ["West", "Middle", "Southeast", "East"],

  // --- Additional custom fields shown on the edit form (to match ReadyOp's
  // own "Modify Contact" layout) ---
  // CONFIRMED (2026-09-02) against the agency's own field mapping
  // (County=Custom 1, Address=Custom 2, Address2=Custom 3, City=Custom 4,
  // State=Custom 5, Zipcode=Custom 6, Fax=Custom 7, Region=Custom 8) —
  // matches what had been inferred here, so no change was needed.
  ADDRESS_FIELD: "Custom 2",
  ADDRESS2_FIELD: "Custom 3",
  CITY_FIELD: "Custom 4",
  STATE_FIELD: "Custom 5",
  ZIP_FIELD: "Custom 6",
  FAX_FIELD: "Custom 7",
  // "Share this contact with Public" and "Public Facing Phone Number"
  // (seen in ReadyOp's New Contact dialog) still don't have an identified
  // field — not in the confirmed mapping above either. They DO show on
  // the edit form now (checkbox + masked phone input), but stay disabled
  // there — greyed out with a tooltip — until these are set to a real
  // "Custom N" field name. Once you know it (check the console
  // diagnostic dump for a contact known to have one of these set, and
  // compare which Custom slot holds it — or ask whoever gave you the
  // other 8), set it here and the field enables itself automatically,
  // no other code changes needed.
  SHARE_PUBLIC_FIELD: null,
  PUBLIC_PHONE_FIELD: null,
  // The County filter's options are NOT hardcoded — they're derived from
  // whatever distinct values actually appear in COUNTY_FIELD across the
  // loaded roster, sorted alphabetically. That also means inconsistent
  // source data shows up as separate options (e.g. "Fayette" and
  // "Fayette County" as two entries, if the roster has both) — this
  // isn't normalized/guessed at, since only someone who knows the data
  // can say which spelling is canonical.

  // --- Free-text search ---
  // The single search box matches (case-insensitive substring) against
  // all of these contact fields at once, OR'd together — e.g. typing
  // "Coffee" matches on Organization ("Coffee County EMA") just as much
  // as on County ("Coffee"). Extend this list if another field should be
  // searchable too.
  SEARCH_FIELDS: ["First", "Last", "Organization", "Title", "Tags"],
};
