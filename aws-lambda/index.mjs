// ---------------------------------------------------------------------------
// Dumb CORS relay for ReadyOp's REST API — AWS Lambda version.
//
// Same job as cloudflare-worker/worker.js: ReadyOp's API sends no
// Access-Control-Allow-Origin header, so browsers refuse to read its
// responses cross-origin. This function forwards the request to
// tn.readyop.com unchanged and returns the response as-is. It never sees,
// stores, or logs the ReadyOp account_id/token — the browser's
// Authorization header just passes through it.
//
// CORS headers themselves are NOT set in this code — they're configured on
// the Lambda Function URL itself (see README: "AWS Lambda option"), which
// also makes AWS handle the OPTIONS preflight automatically without ever
// invoking this function for it.
//
// Requires the Node.js 20.x (or later) Lambda runtime, which has the
// global `fetch` built in.
// ---------------------------------------------------------------------------

const UPSTREAM = "https://tn.readyop.com";

export const handler = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.rawPath || "/";
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";

  const incomingHeaders = event.headers || {};
  const upstreamHeaders = {
    "Content-Type": incomingHeaders["content-type"] || "application/x-www-form-urlencoded",
  };
  if (incomingHeaders.authorization) {
    upstreamHeaders["Authorization"] = incomingHeaders.authorization;
  }

  let body;
  if (!["GET", "HEAD"].includes(method) && event.body) {
    body = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(`${UPSTREAM}${path}${query}`, {
      method,
      headers: upstreamHeaders,
      body,
    });
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Relay could not reach ReadyOp", detail: String(err) }),
    };
  }

  const text = await upstreamResponse.text();
  const responseHeaders = {};
  upstreamResponse.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    // Skip hop-by-hop headers Lambda/API infrastructure manages itself.
    if (!["content-encoding", "transfer-encoding", "connection"].includes(lower)) {
      responseHeaders[key] = value;
    }
  });

  return {
    statusCode: upstreamResponse.status,
    headers: responseHeaders,
    body: text,
  };
};
