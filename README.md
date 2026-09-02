# ReadyOp Contacts Editor

A small static web app for browsing and editing ReadyOp contacts, meant to be
hosted on GitHub Pages (`temagis.github.io/ReadyOp-Contacts/`) and embedded
in an ArcGIS Online Experience Builder experience.

## How it works

1. The user signs in with their ArcGIS account — OAuth 2.0
   authorization-code flow with PKCE, implemented directly against ArcGIS
   Online's REST endpoints (no ArcGIS Maps SDK needed just for this). This
   is what Experience Builder access control gates — only people you've
   granted access to the app item can get this far. Standalone, it's a
   full-page redirect; embedded in an iframe it opens a popup instead
   (redirecting the iframe itself is blocked by ArcGIS's login page), and
   this app's own `index.html` doubles as its OAuth callback page — no
   separate callback file to host.
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

## Why there's a relay in here

ReadyOp's API doesn't send CORS headers, so browsers refuse to let this
app's JavaScript read the response when calling `tn.readyop.com` directly
from `https://temagis.github.io` (confirmed — the preflight request fails
with "No 'Access-Control-Allow-Origin' header is present"). Something has
to sit between the browser and ReadyOp purely to add those headers back —
it doesn't hold or see the credentials any differently than ReadyOp itself
does, since the Authorization header just passes through it unchanged.

Two interchangeable implementations of that relay are included:

- **`cloudflare-worker/`** — the current pick. This endpoint has to be
  invocable by anyone (no browser can do AWS request-signing, so it can't
  be locked down with IAM auth), and deliberately keeping that open,
  no-real-authorization endpoint on its own dedicated Cloudflare account —
  separate from CUSEC's main AWS account, its IAM roles, and its billing —
  limits the blast radius if it's ever probed or abused. It touches nothing
  else you run.
- **`aws-lambda/`** — kept as a documented alternative/fallback. Same
  functionality, but living on AWS trades that isolation for reuse of
  infrastructure you already operate.

Only deploy one of the two. Either way, once it's live you point
`config.js`'s `READYOP_API_BASE_URL` at it.

**If ReadyOp agrees to whitelist your origin(s)** (see the support request
draft below), you can delete whichever relay you deployed and point
`READYOP_API_BASE_URL` in `config.js` at `READYOP_DIRECT_BASE_URL`
(`https://tn.readyop.com`) instead.

## Setup

### 1. Verify the credentials layer field names

Open the `ReadyOp` feature layer's item page on ArcGIS Online → Data tab,
and confirm the two field names that hold the account ID and token. Update
`ACCOUNT_ID_FIELD` / `TOKEN_FIELD` in `config.js` if they don't match the
placeholders (`account_id`, `token`).

### 2. Register/verify the ArcGIS OAuth application

In the ArcGIS Developers / your org's Content settings for the app item
tied to client ID `x7YT2DckqrgUfSQf`:

- Confirm the app item is registered as a **Native Application** (or
  another public-client type) — this flow uses PKCE and needs no client
  secret, which only that app type supports.
- Add `https://temagis.github.io/ReadyOp-Contacts/` as a **Redirect URI**
  (must exactly match `ARCGIS_REDIRECT_URI` in `config.js`, trailing slash
  included). That's the only URI needed — this app's own root page handles
  the OAuth callback itself, so there's no separate callback file or URL
  to register.
- Share the app item (and the credentials feature layer) with whichever
  ArcGIS group represents your trusted contact-editors.

### 3. Deploy the relay

**Cloudflare Workers (recommended)** — deliberately kept on its own
dedicated Cloudflare account, separate from CUSEC's AWS account, so this
open (no-auth) endpoint doesn't add exposure to infrastructure that runs
anything else:
```bash
cd cloudflare-worker
npx wrangler login    # opens a browser to authorize
npx wrangler deploy
```
Wrangler prints the deployed URL, something like
`https://readyop-contacts-relay.<your-subdomain>.workers.dev`. Copy that
into `config.js`'s `READYOP_API_BASE_URL`. `ALLOWED_ORIGINS` in
`worker.js` already has `https://temagis.github.io`, which stays correct
even once the page is embedded in Experience Builder: a framed page's
fetch calls still report its own origin, not the parent Experience's
domain, so there's nothing to add there for the embed itself.

Use a Cloudflare account created specifically for this (not tied to one
person's personal login) so the org retains access if whoever set it up
moves on — worth a line in whatever credential/access documentation CUSEC
already keeps.

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
- **Other custom fields** — the API client and edit form only surface
  Region (see below). Other `Custom_N` slots (e.g. County, address,
  city/state/zip, fax — visible in your agency's Roster columns) aren't
  in the edit form yet. Easy to add if you want them editable here too.

## List behavior: infinite scroll

The contact list loads 100 at a time (`CONFIG.PAGE_SIZE`) and automatically
loads the next page as you scroll near the bottom of the list; a "Load
more" button is also always available as a fallback for anyone who'd
rather click than scroll. This replaced the earlier Prev/Next pager.

## Region filter

The search form includes a Region dropdown (West / Middle / Southeast /
East). ReadyOp's REST API has no native "Region" field or a documented
way to filter by one server-side — in this agency's roster, Region turned
out to be one of ReadyOp's ten generic custom columns, exposed by the API
as the JSON field `"Custom 8"` (confirmed from a live API response; see
`CONFIG.REGION_FIELD` in `config.js`). Because there's no confirmed
server-side filter parameter for it, selecting a Region scans the whole
roster (or the whole result of any First/Last/Organization/Tags filters
also set) page by page and keeps only the matches — this is a few
requests behind the scenes (in batches of `CONFIG.REGION_SCAN_PAGE_SIZE`,
well under ReadyOp's documented 10,000-row cap) rather than one instant
query. Matching is case-insensitive, so a "southeast" value in the data
still matches the "Southeast" option.

If your agency ever renumbers or relabels its custom fields (Menu →
Access → Manage Access → Agencies → double-click the agency → Modify
Agency), update `REGION_FIELD` in `config.js` to match.

## Testing without touching production data

Test with a low-traffic or throwaway contact record first, since Update
calls go straight to ReadyOp with no undo. You'll need your real
account_id/token flowing through the whole chain (ArcGIS sign-in → feature
layer read → ReadyOp call) to test end-to-end — I can't fully verify this
myself since I don't have ArcGIS Online credentials for your org or a live
ReadyOp token, but everything above was checked against the documented API
shapes and a live (unauthenticated) CORS test against `tn.readyop.com`.
