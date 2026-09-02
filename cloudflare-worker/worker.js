// ---------------------------------------------------------------------------
// Dumb CORS relay for ReadyOp's REST API.
//
// ReadyOp's API sends no Access-Control-Allow-Origin header, so browsers
// refuse to read its responses when called cross-origin. This worker does
// nothing except forward the request to tn.readyop.com unchanged and add
// the CORS headers back on the way out. It never sees, stores, or logs the
// ReadyOp account_id/token — the browser sends the Authorization header
// straight through it to ReadyOp.
//
// If ReadyOp later whitelists your app's origin directly, delete this
// worker and point config.js's READYOP_API_BASE_URL at
// READYOP_DIRECT_BASE_URL instead.
// ---------------------------------------------------------------------------

// Origins allowed to call this relay. When this page is embedded in an
// Experience Builder iframe, the browser still reports the page's own
// origin (this one) on its fetch calls — not the parent Experience's
// domain — so you normally don't need to add anything else here. Only
// touch this if you serve the app from somewhere other than GitHub Pages,
// or add a second entry if you host a second copy elsewhere.
const ALLOWED_ORIGINS = ["https://temagis.github.io"];

const UPSTREAM = "https://tn.readyop.com";

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response("Origin not allowed", { status: 403, headers });
    }

    const url = new URL(request.url);
    const upstreamUrl = UPSTREAM + url.pathname + url.search;

    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: {
        // Forward only what's needed; drop hop-by-hop / CF-specific headers.
        Authorization: request.headers.get("Authorization") || "",
        "Content-Type": request.headers.get("Content-Type") || "application/x-www-form-urlencoded",
      },
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.text(),
    });

    const upstreamResponse = await fetch(upstreamRequest);
    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [key, value] of Object.entries(headers)) {
      responseHeaders.set(key, value);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
