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

## The ReadyOp `Update` gotcha

ReadyOp's Modify Contact endpoint defaults to `Update=All`, which
**clears any field you don't include in the request** — editing just a
phone number would silently wipe the contact's email addresses, tags, etc.
`readyop-client.js` always sends `Update=Present` instead, which only
touches fields actually included in the request. If you extend the client,
keep that.

(This parameter's real name is `Update`, per ReadyOp's own API docs at
readyop.com/document/modify-a-contact/ — an earlier version of this file
called it `Update_Mode`, a name ReadyOp doesn't recognize, which made
every save fail with a generic 400 regardless of what else was in the
request.)

## What's not built yet

- **Create / delete contact** — the app only lists and edits existing
  contacts, per what was asked for. ReadyOp's docs describe Create/Delete
  endpoints too, so this is a natural next step if you want it.
- **"Share this contact with Public" / "Public Facing Phone Number"** —
  seen in ReadyOp's own New Contact dialog, but not identified in the API
  data yet, so they're not on the edit form. If you need them, open a test
  contact that has one of these set in ReadyOp, load the same contact
  here, and check the browser console's diagnostic dump (see below) for
  which field holds that value.
- **User Account / "Create User"** — ReadyOp's dialog can link a login
  account to a contact; not exposed here.

## The edit form's extra fields

All confirmed: **County** (`Custom 1`), **Address** (`Custom 2`),
**Address 2** (`Custom 3`), **City** (`Custom 4`), **State**
(`Custom 5`), **Zip** (`Custom 6`), **Fax** (`Custom 7`), and **Region**
(`Custom 8`) — matched against the agency's own field mapping. **PIN** is
a genuine top-level API field.

**"Share this contact with Public"** (`Custom 9`, a checkbox — sends
`"Yes"` when checked and blank when not, matching ReadyOp's own "Yes or
leave blank" convention) and **"Public Facing Phone Number"**
(`Custom 10`, a masked phone input, same as the Phone Numbers section)
are both confirmed and enabled now too — found via the agency's Contact
Fields admin screen (Menu → Access → Manage Access → Agencies → agency →
Contact Fields tab), which lists every Custom field's real name
directly. Worth knowing about for next time a field mapping needs
tracking down.

## Tags picker

The Tags field on the edit form is a type-to-add/select chip picker now,
not a raw comma-separated text box — type to search, pick from a
dropdown or press Enter to add, click a chip's × to remove, Backspace in
an empty box removes the last one, and pasting/typing a comma-separated
string (`"Middle NAWAS, Middle PSAP"`) still works and splits into
separate chips like before.

By default (`CONFIG.TAG_OPTIONS: []` in `config.js`) it's *suggestions,
not a hard constraint*: the dropdown offers every tag already seen
somewhere in the loaded roster, but typing something new and pressing
Enter (or picking the "Add "..."" row) still creates it. Fill in
`TAG_OPTIONS` with a fixed list once you've settled on a canonical set of
tags, and it switches to strictly constraining input to only those
values — typing something not on the list won't let it be added. Same
one-line-config-change pattern as `SHARE_PUBLIC_FIELD`/
`PUBLIC_PHONE_FIELD` above.

## Phone number formatting

Every phone number field (the 5 in Phones, plus Public Facing Phone
Number) now formats as you type — typing digits produces
`(615) 555-1234` automatically. This is display formatting only, done in
the browser; whatever's shown is exactly what gets sent to ReadyOp on
save.

The same formatting is also applied when the edit form loads, to
whatever number is already on file — so a number stored in a different
shape (e.g. ReadyOp's own `+16153064619`) shows up matching the mask
too, instead of only newly-typed numbers looking formatted. An 11-digit
number that starts with a `1` (a US country code) has that leading `1`
stripped before formatting, so it still comes out as a normal 10-digit
`(615) 306-4619` instead of shifting every digit over by one. See
`formatPhoneNumber()` in `app.js`.

## Save confirmation

The Save button itself briefly turns green and reads "✓ Saved" for about
two seconds after a successful save (in addition to the status line at
the top), so it's obvious the save went through without having to look
elsewhere. It's disabled and reads "Saving…" while the request is in
flight, so a slow save can't be double-submitted by an extra click.

## How the list loads: fetch the whole roster once, then work in memory

On sign-in, the app fetches the ENTIRE contact roster once (a handful of
requests in batches of `CONFIG.ROSTER_FETCH_PAGE_SIZE`, well under
ReadyOp's documented 10,000-row cap) and keeps it in memory for the rest
of the session. The search box and both filters then run instantly
against that in-memory copy — no network round trip per keystroke or
filter change — and "continuous scroll" just reveals more of the
already-filtered list rather than fetching more from the server. The
list renders progressively as the roster streams in, rather than staying
blank until all of it has arrived.

Why not page through server-side search results like before: the search
box now matches across several fields at once (an OR — see below), and
Region/County live in custom columns ReadyOp's search API isn't
documented to filter by (see the next section) — neither is expressible
as a single server-side query. With ~3,000 contacts, fetching once up
front is simpler and faster in practice than re-querying per keystroke.

**Sort order:** ReadyOp's API returns contacts in its own (not
alphabetical) order. The app re-sorts the filtered list alphabetically by
**Last name** (First name as the tiebreaker when Last matches — e.g. two
"Smith"s), case-insensitive with natural numeric ordering, every time the
search box, a filter, or the underlying roster changes — see
`applyFilters()` in `app.js`. This is purely a client-side convenience;
there's no other sort option, and the name shown on each row is still
"First Last" (`contactDisplayName()`) — only the sort key is Last-first.

## Search

A single search box (matching the sibling PREDS app's own search-bar
style) replaced the earlier First/Last/Organization/Tags four-field grid.
It matches, case-insensitively, against every field listed in
`CONFIG.SEARCH_FIELDS` (First, Last, Organization, Title, Tags by
default) plus County and Region — so typing "Coffee" matches an
Organization like "Coffee County EMA" just as much as a County of
"Coffee". Extend `SEARCH_FIELDS` in `config.js` if another field should
be searchable too.

## Region / County filters

Region and County live directly in the top header bar — no "Filter"
button and no slide-up drawer to open. This app is embedded in an
Experience Builder widget on a desktop screen, never a phone, so the
mobile-style hide-behind-a-button pattern (borrowed from the sibling
PREDS app, which *does* need it for its own phone-sized audience) wasn't
earning its keep here; the two filters just sit in the header at all
times instead. Region is listed first since selecting it narrows what
County offers (see below):

- **Region** (West / Middle / Southeast / East) — pill buttons in the
  header, single-select.
- **County** — a combobox in the header built from whatever distinct
  values actually appear in the roster's County field (not a hardcoded
  list), sorted alphabetically. If the source data has inconsistent
  spellings (e.g. both "Fayette" and "Fayette County" show up in
  ReadyOp), both appear as separate options rather than being silently
  merged — only someone who knows the data should decide which spelling
  is canonical.

The pill buttons and the County combobox render at the same fixed height
(34px) so the two rows line up with each other in the header — each
control's own natural padding/border added up to noticeably different
heights otherwise (the combobox came out a few pixels taller), which
looked uneven side by side.

That height fix alone wasn't enough to make the two groups actually line
up, though — the pill row (`.buf-row`, a class shared with the sibling
PREDS app's drawer styling) carries an 18px `margin-bottom`, meant to be
zeroed out in the header via a `.topbar-buf-row { margin-bottom: 0 }`
override. Both rules have the same specificity (one class each), and
`.buf-row` happens to be declared *later* in `styles.css`, so on equal
specificity it was winning the cascade and the override was silently
never applying. That leftover 18px inflated the whole Region group's
height, which pushed County — sized to its actual content, no phantom
margin — down to stay vertically centered against it, so "REGION" and
"COUNTY" (and their pill row/combobox) ended up on two different
baselines despite both being "centered." Fixed by giving the override
two classes (`.topbar-filters .topbar-buf-row`) so it wins regardless of
declaration order, rather than relying on being lucky about which rule
happens to come last in the file.

**Region narrows County:** once a Region is selected, the County
combobox only offers counties that actually appear under that Region in
the loaded roster (built from the same roster fetch, in
`regionToCounties` in `app.js`) — so you can't pick a Region/County
combination that would silently return zero results. If a County was
already selected and it doesn't belong to the newly-picked Region, it's
cleared automatically rather than left active and invisible-broken.
Clearing Region back to "All regions" restores the full county list.
This only affects the header's County filter — the edit form's own
County field (a free-text input, see below) always suggests from the
*full* county list regardless of the active Region filter, since the
contact you're editing may belong to a different region than whatever's
currently selected as a list filter.

Either filter (or both together) also shows a removable chip — "Region:
West ×", "County: Fayette ×" — above the contact list, alongside the
selected pill/combobox value in the header.

The County field is a type-to-filter combobox rather than a plain
dropdown — with ~90+ counties in the data, scrolling a native `<select>`
to find one was slow. Start typing to narrow the list live (matches
anywhere in the name, not just the start); Arrow keys + Enter also work;
"All counties" is always the first option so clearing the filter doesn't
need the × chip. The edit form's own County field is a free-text input
with the same list of known counties as type-ahead suggestions
(`<datalist>`), since County is editable there too now (see below).

## List width, and single-column view on narrow screens

The list pane's column was widened (its old `minmax(260px, 340px)` cap
was clipping the search box's placeholder text at "…tags"). Below 760px
of viewport width, the layout also switches to a single-column view —
matching how the sibling PREDS app behaves on mobile: the list takes the
full width, and selecting a contact swaps in the edit pane full-width
with a "Back to list" button, instead of both columns fighting for a
too-narrow screen. Above that width, list and edit pane still sit side by
side as before.

## Edit form — matching ReadyOp's own Modify Contact layout

The edit form mirrors ReadyOp's native two-column dialog layout instead
of one long single-column stack, and gained several fields ReadyOp's own
dialog shows that weren't editable here before: **PIN**, **County**,
**Address**, **Address 2**, **City**, **State**, **Zip**, **Fax**, and
**Region** (as a dropdown, matching the same options as the header
pills). See "The edit form's extra fields" below for the confirmed field
mapping behind each of these.

The form reads top to bottom as: **Public Contact** paired with the
**Save changes** button (top-left/top-right, see below), then **General
Info** and **Address** side by side, then **Phones** and **Emails** side
by side — a 2-column grid that auto-flows into that 3-row layout, rather
than one long stack, so the whole form fits on one screen without
scrolling on a typical desktop. Field spacing throughout the form is
intentionally compact to help that fit. Below 900px wide, it drops back
to a single column (all sections stacked, in that same top-to-bottom
order), since there isn't room for two fieldsets side by side without
cramming each Phone/Email row's number+type+checkbox trio.

**"Address" groups every address-related field together, County on
top.** This section used to be called "Other Information" and held a mix
of address fields plus Region; it's renamed to **Address**, and the
**Address** field itself (previously all the way up in General Info) now
lives here too, so nothing address-related is split across two
fieldsets. Within it, the reading order is **County**, **Region**,
**Address**, **Address 2**, **City**, **State**, **Zip** — County first
(the broadest geographic grouping), then Region, then the street-level
fields. **Fax moved the other way**, out of Address and down to the
bottom of **General Info** (after PIN) — both were pure field-reordering
requests, and since every input keeps its original `name`/`id`,
`populateEditForm()` and the submit handler (which read/write by name,
not position) needed no changes.

**"Public Contact" sits first, in its own top-left section, with Save
changes beside it.** The "Share with public" checkbox (originally
labeled "Share this contact with Public" — shortened, see below) and
Public Facing Phone Number used to be the last two fields tucked into
Other Information; they're broken out into their own titled section
(`.public-contact-fieldset`) with a tinted background so it's easy to
spot while scrolling through contacts — and it's the first thing in the
form now, rather than buried below General Info/Address, since it's
checked on a lot of contacts in a row. It briefly spanned the full width
of the form; it's now constrained to just the top-left grid cell instead,
with the **Save changes** button moved up out of its old spot below
every other field and into the top-right cell beside it — so the field
you check most often and the button you click to save it are both
visible together, without scrolling past General Info/Address/Phones/
Emails first. That top-right cell is roughly half the form's width, and
the button was originally right-justified within it
(`.form-actions { justify-content: flex-end }`), which left it stranded
at the far right edge with a wide empty gap between it and the Public
Contact box beside it — it's now left-justified
(`justify-content: flex-start`) so it sits right next to Public Contact
instead. The checkbox itself is also bigger and
styled as its own clickable row (a bordered card with a larger checkbox,
`accent-color: var(--tema-blue)`) rather than a plain inline
checkbox+label, for the same reason.

**Checkbox and phone field line up, and fit on one line.** Once Public
Contact was constrained to a half-width column, the checkbox's original
label ("Share this contact with Public") was long enough that it and
Public Facing Phone Number no longer fit side by side and wrapped onto
two lines — shortened to **"Share with public"** to fit comfortably on
one line again. The two fields were also misaligned vertically: the
phone field has a label above its input, while the checkbox (a
single-line control) had nothing above it, so centering the two against
their very different heights left the checkbox floating up near the
phone field's *label* instead of level with its *input*. Fixed by giving
the checkbox its own matching label — **"Sharing"** — above it
(`.public-contact-field-title`, styled identically to every other
field's label), then top-aligning the row (`align-items: flex-start`)
now that both fields have the same label-then-control shape.

**Checking "Share with public" turns Public Contact and Address green.**
A quick, glanceable "this one's public" signal — since Address is where
the actual mailing info being shared lives, and it isn't right next to
the checkbox on screen, a plain checkmark alone was easy to miss when
scanning down the form. Both fieldsets get an `.is-public` class
(green-tinted background, green border and legend) toggled by
`syncPublicContactHighlight()` in `app.js`, on every change of the
checkbox and once when a contact's data first loads into the form — so a
contact that's already marked public shows green immediately, not just
after you touch the checkbox.

ReadyOp's REST API has no native "Region" or "County" field — in this
agency's roster, they turned out to be two of ReadyOp's ten generic
custom columns, exposed by the API as the JSON fields `"Custom 8"` and
`"Custom 1"` respectively (confirmed from a live API response; see
`CONFIG.REGION_FIELD`/`COUNTY_FIELD` in `config.js`). Matching is
case-insensitive for Region, so a "southeast" value in the data still
matches the "Southeast" pill.

If your agency ever renumbers or relabels its custom fields (Menu →
Access → Manage Access → Agencies → double-click the agency → Modify
Agency), update `REGION_FIELD`/`COUNTY_FIELD` in `config.js` to match.

## If a change you deployed doesn't seem to show up

`index.html` loads `styles.css` and `app.js` with a `?v=...` query string
specifically so browsers don't keep serving an old cached copy after
you've pushed new files. `app.js` also imports its sibling modules
(`config.js`, `arcgis-auth.js`, `credentials.js`, `readyop-client.js`)
with that same `?v=...` on each import — without it, editing just
`config.js` (a common case — that's where the Region/County field names
and options live) wouldn't get cache-busted at all, since only
`index.html`'s own two tags carried a version string before. **Bump the
version string everywhere it appears** any time you redeploy changed
JS/CSS — the easiest way is a find-and-replace across the whole project
for the old value (e.g. `20260902f`) to a new one (e.g. today's date) —
otherwise a browser that already cached the old files may keep using
them, which looks exactly like "my fix isn't showing up" even though the
new files are live on GitHub Pages. If you ever see this happen despite a
version bump, a hard refresh (Ctrl+Shift+R / Cmd+Shift+R) or an
incognito/private window rules out caching entirely.

## Testing without touching production data

Test with a low-traffic or throwaway contact record first, since Update
calls go straight to ReadyOp with no undo. You'll need your real
account_id/token flowing through the whole chain (ArcGIS sign-in → feature
layer read → ReadyOp call) to test end-to-end — I can't fully verify this
myself since I don't have ArcGIS Online credentials for your org or a live
ReadyOp token, but everything above was checked against the documented API
shapes and a live (unauthenticated) CORS test against `tn.readyop.com`.
