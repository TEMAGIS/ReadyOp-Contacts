# ReadyOp Contacts Editor

A small static web app for browsing and editing ReadyOp contacts, meant to be
hosted on GitHub Pages (`temagis.github.io/ReadyOp-Contacts/`) and embedded
in an ArcGIS Online Experience Builder experience.

## How it works

1. The user signs in with their ArcGIS account (OAuth popup). This is what
   Experience Builder access control gates — only people you've granted
   access to the app item can get this far.
2. Once signed in, the app reads the ReadyOp `account_id`/`token` from the
   protected ArcGIS feature layer (`ReadyOp/FeatureServer/0`), using the
   user's own ArcGIS token to authorize that read.
3. The app calls ReadyOp's Contacts REST API directly from the browser using
   that account_id/token as HTTP Basic Auth — the same pattern as your
   existing Python script.

**Trust model, explicitly**: anyone who can open this app can, with the
browser's dev tools, extract the ReadyOp account_id/token and use it outside
the app with whatever access that token grants. That's a deliberate choice
for this build — it only makes sense if everyone with access to the
Experience Builder app is someone you'd trust with full ReadyOp API access
anyway. If that ever stops being true, the fix is to move the ReadyOp
credential into the relay (see below) and have the relay authorize each
call against the caller's ArcGIS token — happy to build that if needed.

## Why there's a Cloudflare Worker in here

ReadyOp's API doesn't send CORS headers, so browsers refuse to let this
app's JavaScript read the response when calling `tn.readyop.com` directly
from `https://temagis.github.io` (confirmed — the preflight request fails
with "No 'Access-Control-Allow-Origin' header is present"). The worker in
`cloudflare-worker/` is a dumb pass-through: it forwards the request to
ReadyOp unchanged and adds the missing CORS headers on the way back. It
never sees the credentials any differently than ReadyOp itself does — the
Authorization header just passes through it.

**If ReadyOp agrees to whitelist your origin(s)** (see the support request
draft below), you can delete the worker entirely and point
`READYOP_API_BASE_URL` in `config.js` at `READYOP_DIRECT_BASE_URL`
(`https://tn.readyop.com`).

## Setup

### 1. Verify the credentials layer field names

Open the `ReadyOp` feature layer's item page on ArcGIS Online → Data tab,
and confirm the two field names that hold the account ID and token. Update
`ACCOUNT_ID_FIELD` / `TOKEN_FIELD` in `config.js` if they don't match the
placeholders (`account_id`, `token`).

### 2. Register/verify the ArcGIS OAuth application

In the ArcGIS Developers / your org's Content settings for the app item
tied to client ID `x7YT2DckqrgUfSQf`:

- Add `https://temagis.github.io/ReadyOp-Contacts/` as a **Redirect URI**.
- Since sign-in uses a popup (`popup: true` in `arcgis-auth.js`, required so
  the OAuth flow doesn't navigate away from the Experience Builder iframe),
  also confirm the popup callback flow is allowed — by default the app
  relies on Esri's own hosted callback page
  (`https://js.arcgis.com/<version>/oauth-callback.html`), which Esri's SDK
  handles without any extra registration on your part. If you see a redirect
  URI mismatch error during testing, add that exact URL as an additional
  Redirect URI.
- Share the app item (and the credentials feature layer) with whichever
  ArcGIS group represents your trusted contact-editors.

### 3. Deploy the Cloudflare Worker relay

You'll need a (free) Cloudflare account — this wasn't something I could
provision on your behalf.

```bash
cd cloudflare-worker
npm install -g wrangler   # one-time
wrangler login             # opens a browser to authorize
wrangler deploy
```

Wrangler prints the deployed URL, something like
`https://readyop-contacts-relay.<your-subdomain>.workers.dev`. Copy that
into `config.js`'s `READYOP_API_BASE_URL`.

Before deploying, double check `ALLOWED_ORIGINS` in `worker.js` includes:
- `https://temagis.github.io`
- whatever domain the app actually loads from once embedded in Experience
  Builder (Esri experiences are commonly served from
  `experience.arcgis.com` or an org-specific domain — check the real URL
  once you've built the experience and add it here, then re-run
  `wrangler deploy`).

### 4. Publish the site

Standard GitHub Pages — push to the repo, enable Pages on the `main` branch
if not already on. `config.js` has no secrets in it, so it's fine as a
public repo.

### 5. Embed in Experience Builder

Add an **Embed** widget (or equivalent iframe-based widget) pointed at
`https://temagis.github.io/ReadyOp-Contacts/`. Because sign-in happens
inside that iframe via a popup, make sure the browser isn't blocking popups
for the Experience Builder domain.

## The ReadyOp `Update_Mode` gotcha

ReadyOp's Modify Contact endpoint defaults to `Update_Mode=All`, which
**clears any field you don't include in the request** — editing just a
phone number would silently wipe the contact's email addresses, tags, etc.
`readyop-client.js` always sends `Update_Mode=Present` instead, which only
touches fields actually included in the request. If you extend the client,
keep that.

## What's not built yet

- **Create / delete contact** — the app only lists and edits existing
  contacts, per what was asked for. ReadyOp's docs describe Create/Delete
  endpoints too, so this is a natural next step if you want it.
- **Custom_1–10 fields** — the API client and edit form don't surface these
  yet since I don't know what you're using them for. Easy to add once you
  tell me which custom columns matter.

## Testing without touching production data

Test with a low-traffic or throwaway contact record first, since Update
calls go straight to ReadyOp with no undo. You'll need your real
account_id/token flowing through the whole chain (ArcGIS sign-in → feature
layer read → ReadyOp call) to test end-to-end — I can't fully verify this
myself since I don't have ArcGIS Online credentials for your org or a live
ReadyOp token, but everything above was checked against the documented API
shapes and a live (unauthenticated) CORS test against `tn.readyop.com`.
