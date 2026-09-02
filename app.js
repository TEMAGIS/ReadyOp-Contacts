import { CONFIG } from "./config.js?v=20260902l";
import * as auth from "./arcgis-auth.js?v=20260902l";
import { getReadyOpCredentials, clearCredentialsCache } from "./credentials.js?v=20260902l";
import { listContacts, getContact, updateContact } from "./readyop-client.js?v=20260902l";

const $ = (sel) => document.querySelector(sel);

const signInScreen = $("#sign-in-screen");
const appScreen = $("#app-screen");
const userLabel = $("#user-label");
const statusBar = $("#status-bar");
const contactList = $("#contact-list");
const searchInput = $("#search-input");
const filterToggleBtn = $("#filter-toggle-btn");
const regionDrawer = $("#region-drawer");
const regionDrawerClose = $("#region-drawer-close");
const regionPillRow = $("#region-pill-row");
const countyCombo = $("#county-combo");
const countyInput = $("#county-input");
const countyClear = $("#county-clear");
const countyListbox = $("#county-listbox");
const countyDatalist = $("#county-datalist");
const editRegionSelect = $("#edit-region-select");
const sharePublicCheckbox = $("#share-public-checkbox");
const sharePublicLabel = $("#share-public-label");
const publicPhoneInput = $("#public-phone-input");
const tagsField = $("#tags-field");
const tagsChips = $("#tags-chips");
const tagsInput = $("#tags-input");
const tagsListbox = $("#tags-listbox");
const tagsHidden = $("#tags-hidden");
const saveBtn = $('#edit-form button[type="submit"]');
const activeFiltersBar = $("#active-filters");
const pagerInfo = $("#pager-info");
const appLayoutEl = $("#app-screen");
const editPanel = $("#edit-panel");
const editForm = $("#edit-form");
const editBackBtn = $("#edit-back-btn");
const editEmptyState = $("#edit-empty-state");
const loginError = $("#login-error");
const oauthFallback = $("#oauth-fallback");
const oauthSignInBtn = $("#sign-in-btn");

let creds = null;
let selectedContactId = null;

// --- Roster: fetched in full once per sign-in, then everything (search,
// Region, County, continuous scroll) operates on this in-memory copy —
// see loadRoster() below for why. ---
let allContacts = [];
let rosterLoading = false;
let hasLoggedSample = false;
const knownCounties = new Set();
const knownTags = new Set(); // every distinct tag seen across the roster — used as Tags-picker suggestions when CONFIG.TAG_OPTIONS isn't set
const regionToCounties = new Map(); // region name (lowercased) -> Set of counties seen under that region in the loaded roster; used to narrow the County filter's options once a Region filter is active

// --- Search + filters ---
let searchTerm = "";
let activeRegion = ""; // "" = no Region filter
let activeCounty = ""; // "" = no County filter
let countyHighlightIndex = -1; // keyboard nav position in the open county combobox listbox
let currentTags = []; // the open contact's tags, as an ordered array (mirrors the tagsHidden input's comma-joined value)
let tagHighlightIndex = -1; // keyboard nav position in the open tags listbox

// --- Rendering (reveals more of the already-filtered array as the user scrolls) ---
let filteredContacts = [];
let renderedCount = 0;
const SCROLL_LOAD_THRESHOLD_PX = 200;

// --- Region/County filter drawer (same filter-button/slide-up-drawer/
// pill pattern as the sibling PREDS app, for visual consistency) ---

buildRegionPills();
buildEditRegionOptions();
applyUnmappedFieldGuards();
attachPhoneMasks();

/**
 * "Share this contact with Public" and "Public Facing Phone Number" don't
 * have a confirmed Custom-field mapping yet (see config.js) — rather than
 * risk writing to the wrong slot, these two inputs start disabled with an
 * explanatory tooltip and stay that way until CONFIG.SHARE_PUBLIC_FIELD /
 * CONFIG.PUBLIC_PHONE_FIELD are set to a real field name.
 */
function applyUnmappedFieldGuards() {
  if (!CONFIG.SHARE_PUBLIC_FIELD) {
    sharePublicCheckbox.disabled = true;
    const note = "Field mapping not yet identified — see SHARE_PUBLIC_FIELD in config.js";
    sharePublicCheckbox.title = note;
    sharePublicLabel.title = note;
    sharePublicLabel.classList.add("field-pending");
  }
  if (!CONFIG.PUBLIC_PHONE_FIELD) {
    publicPhoneInput.disabled = true;
    publicPhoneInput.placeholder = "Not available yet";
    publicPhoneInput.title = "Field mapping not yet identified — see PUBLIC_PHONE_FIELD in config.js";
  }
}

/** Formats a phone number as the user types: "(615) 555-1234". Applied to every input with the .phone-mask class (the 5 Phone Number fields plus Public Facing Phone Number) so they all behave the same way. */
function formatPhoneNumber(value) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function attachPhoneMasks() {
  document.querySelectorAll("input.phone-mask").forEach((input) => {
    input.addEventListener("input", () => {
      input.value = formatPhoneNumber(input.value);
      // Simple mask — always snaps the cursor to the end after
      // reformatting, so editing in the middle of an existing number
      // isn't pixel-perfect, but typing a fresh number (the normal
      // case) formats live as expected.
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });
}

function buildRegionPills() {
  const allPill = document.createElement("button");
  allPill.type = "button";
  allPill.className = "buft active";
  allPill.dataset.region = "";
  allPill.setAttribute("aria-pressed", "true");
  allPill.textContent = "All regions";
  allPill.addEventListener("click", () => setRegion(""));
  regionPillRow.appendChild(allPill);

  for (const region of CONFIG.REGION_OPTIONS) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "buft";
    pill.dataset.region = region;
    pill.setAttribute("aria-pressed", "false");
    pill.textContent = region;
    pill.addEventListener("click", () => setRegion(region));
    regionPillRow.appendChild(pill);
  }
}

/** Populates the edit form's Region <select> from the same CONFIG.REGION_OPTIONS list the filter pills use, so the two stay in sync automatically. */
function buildEditRegionOptions() {
  for (const region of CONFIG.REGION_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = region;
    opt.textContent = region;
    editRegionSelect.appendChild(opt);
  }
}

function sortedCounties() {
  return [...knownCounties].sort((a, b) => a.localeCompare(b));
}

/** Counties to offer in the drawer's County FILTER dropdown: every county seen in the loaded roster, normally — but narrowed to just the counties that actually appear under the active Region (if one is set), so picking a Region first doesn't leave County offering choices that would combine to zero results. The edit form's own County field (a free-text input with its own datalist, populated below) always suggests from the *full* list regardless of the active Region filter, since the contact being edited may belong to a different region than whatever's currently selected as a list filter. */
function countiesForFilter() {
  if (!activeRegion) return sortedCounties();
  const set = regionToCounties.get(activeRegion.toLowerCase());
  return set ? [...set].sort((a, b) => a.localeCompare(b)) : [];
}

/** Rebuilds the County combobox's known-values list (used to filter the drawer's type-ahead dropdown) and the edit form's County <datalist>, from whatever distinct values have been seen so far in COUNTY_FIELD across the loaded roster (called as more of the roster streams in, and once more when it finishes) — not a hardcoded list, since only the live data can say what's actually there (including any inconsistent spellings). */
function refreshCountyOptions() {
  const counties = sortedCounties();

  countyDatalist.innerHTML = counties.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");

  // If the drawer's listbox is currently open, re-render it against the
  // (possibly grown) list and whatever the user has typed so far.
  if (!countyListbox.hidden) renderCountyListbox(countyInput.value);
}

/** Renders the county combobox's dropdown list, filtered by `filterText` (case-insensitive substring match against county names) — "All counties" always appears first so clearing the filter is always one click away. */
function renderCountyListbox(filterText) {
  const term = (filterText || "").trim().toLowerCase();
  const matches = countiesForFilter().filter((c) => !term || c.toLowerCase().includes(term));

  const rows = [`<li class="combo-option${activeCounty === "" ? " selected" : ""}" role="option" data-value="" aria-selected="${activeCounty === ""}">All counties</li>`];
  if (matches.length === 0 && term) {
    rows.push(`<li class="combo-option-empty">No counties match "${escapeHtml(filterText)}"</li>`);
  } else {
    for (const c of matches) {
      rows.push(
        `<li class="combo-option${activeCounty === c ? " selected" : ""}" role="option" data-value="${escapeHtml(c)}" aria-selected="${activeCounty === c}">${escapeHtml(c)}</li>`
      );
    }
  }
  countyListbox.innerHTML = rows.join("");
  countyListbox.hidden = false;
  countyInput.setAttribute("aria-expanded", "true");
  countyHighlightIndex = -1;
}

function closeCountyListbox() {
  countyListbox.hidden = true;
  countyInput.setAttribute("aria-expanded", "false");
  countyHighlightIndex = -1;
}

function highlightCountyOption(index) {
  const options = [...countyListbox.querySelectorAll(".combo-option")];
  options.forEach((el) => el.classList.remove("highlighted"));
  if (index >= 0 && index < options.length) {
    options[index].classList.add("highlighted");
    options[index].scrollIntoView({ block: "nearest" });
  }
  countyHighlightIndex = index;
}

/** Applies a County filter selection — value "" clears it — from either a click/keyboard pick in the drawer's combobox or the chip's × button. */
function selectCounty(value) {
  activeCounty = value;
  countyInput.value = value;
  countyClear.hidden = !value;
  closeCountyListbox();
  updateActiveFiltersBar();
  applyFilters();
}

countyInput.addEventListener("focus", () => renderCountyListbox(countyInput.value));
countyInput.addEventListener("input", () => {
  // Typing implicitly clears a previously-selected county until a new one
  // is picked from the list — the input reflects free-typed search text,
  // not necessarily the active filter, while the dropdown is open.
  countyClear.hidden = !countyInput.value;
  renderCountyListbox(countyInput.value);
});
countyInput.addEventListener("keydown", (e) => {
  const options = [...countyListbox.querySelectorAll(".combo-option")];
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (countyListbox.hidden) renderCountyListbox(countyInput.value);
    else highlightCountyOption(Math.min(countyHighlightIndex + 1, options.length - 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightCountyOption(Math.max(countyHighlightIndex - 1, 0));
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (!countyListbox.hidden && countyHighlightIndex >= 0 && options[countyHighlightIndex]) {
      selectCounty(options[countyHighlightIndex].dataset.value);
    } else if (!countyListbox.hidden && options.length === 1) {
      selectCounty(options[0].dataset.value);
    }
  } else if (e.key === "Escape") {
    closeCountyListbox();
  }
});
countyListbox.addEventListener("click", (e) => {
  const opt = e.target.closest(".combo-option[data-value], .combo-option[data-value=\"\"]");
  if (!opt) return;
  selectCounty(opt.dataset.value || "");
});
countyClear.addEventListener("click", () => selectCounty(""));
document.addEventListener("click", (e) => {
  if (!countyCombo.contains(e.target)) closeCountyListbox();
});

// ── Tags picker (edit form) ──────────────────────────────────────────
// Type-to-add/select chip picker — a multi-select sibling of the County
// combobox above. See CONFIG.TAG_OPTIONS in config.js: unset (default)
// means "suggest from whatever tags already exist in the roster, but
// allow typing a brand new one"; set to a fixed list means "constrain
// strictly to these values only."

function sortedKnownTags() {
  return [...knownTags].sort((a, b) => a.localeCompare(b));
}

function isTagsConstrained() {
  return CONFIG.TAG_OPTIONS.length > 0;
}

/** Redraws the selected-tags chip row from `currentTags` and keeps the hidden `Tags` form field (a plain comma-joined string, same shape ReadyOp's API already expects) in sync — no submit-handler changes needed elsewhere. */
function renderTagChips() {
  tagsChips.innerHTML = currentTags
    .map(
      (t) =>
        `<span class="tag-chip">${escapeHtml(t)}<button type="button" class="tag-chip-remove" data-tag="${escapeHtml(t)}" aria-label="Remove tag ${escapeHtml(t)}">×</button></span>`
    )
    .join("");
  tagsHidden.value = currentTags.join(", ");
}

/** Renders the tags listbox filtered by `filterText`, excluding tags already selected. Unconstrained mode also offers an "Add "<text>"" row for a typed value that doesn't match an existing option, so a genuinely new tag can still be created. */
function renderTagsListbox(filterText) {
  const constrained = isTagsConstrained();
  const pool = constrained ? CONFIG.TAG_OPTIONS : sortedKnownTags();
  const typed = (filterText || "").trim();
  const term = typed.toLowerCase();
  const selectedLower = new Set(currentTags.map((t) => t.toLowerCase()));
  const matches = pool.filter((t) => !selectedLower.has(t.toLowerCase()) && (!term || t.toLowerCase().includes(term)));

  const rows = matches.map(
    (t) => `<li class="combo-option" role="option" data-value="${escapeHtml(t)}">${escapeHtml(t)}</li>`
  );

  const exactExists = pool.some((t) => t.toLowerCase() === term);
  if (!constrained && typed && !exactExists) {
    rows.push(
      `<li class="combo-option combo-option-add" role="option" data-value="${escapeHtml(typed)}">Add "${escapeHtml(typed)}"</li>`
    );
  }

  if (rows.length === 0) {
    const emptyMessage = constrained
      ? typed
        ? `No tags match "${escapeHtml(typed)}"`
        : "All available tags are already added"
      : "Type to add a new tag";
    rows.push(`<li class="combo-option-empty">${emptyMessage}</li>`);
  }

  tagsListbox.innerHTML = rows.join("");
  tagsListbox.hidden = false;
  tagsInput.setAttribute("aria-expanded", "true");
  tagHighlightIndex = -1;
}

function closeTagsListbox() {
  tagsListbox.hidden = true;
  tagsInput.setAttribute("aria-expanded", "false");
  tagHighlightIndex = -1;
}

function highlightTagOption(index) {
  const options = [...tagsListbox.querySelectorAll(".combo-option[data-value]")];
  options.forEach((el) => el.classList.remove("highlighted"));
  if (index >= 0 && index < options.length) {
    options[index].classList.add("highlighted");
    options[index].scrollIntoView({ block: "nearest" });
  }
  tagHighlightIndex = index;
}

/** Adds `raw` as a tag if it's non-empty, not already selected, and (when constrained) actually on CONFIG.TAG_OPTIONS. Returns whether it was added, so callers know whether to clear the input. */
function tryAddTag(raw) {
  const typed = (raw || "").trim();
  if (!typed) return false;
  let value = typed;
  if (isTagsConstrained()) {
    const match = CONFIG.TAG_OPTIONS.find((t) => t.toLowerCase() === typed.toLowerCase());
    if (!match) return false; // not on the allowed list — refuse rather than silently letting anything through
    value = match;
  }
  if (currentTags.some((t) => t.toLowerCase() === value.toLowerCase())) return false; // already added
  currentTags.push(value);
  knownTags.add(value);
  renderTagChips();
  return true;
}

function removeTag(tag) {
  currentTags = currentTags.filter((t) => t !== tag);
  renderTagChips();
}

tagsChips.addEventListener("click", (e) => {
  const btn = e.target.closest(".tag-chip-remove");
  if (!btn) return;
  removeTag(btn.dataset.tag);
});

tagsInput.addEventListener("focus", () => renderTagsListbox(tagsInput.value));
tagsInput.addEventListener("input", () => {
  // A comma commits everything typed before it as a tag — supports both
  // fast comma-separated typing (matching the old plain-text field's
  // habit) and pasting a whole "Tag A, Tag B, Tag C" string at once.
  if (tagsInput.value.includes(",")) {
    const parts = tagsInput.value.split(",");
    const remainder = parts.pop();
    parts.forEach((p) => tryAddTag(p));
    tagsInput.value = remainder;
  }
  renderTagsListbox(tagsInput.value);
});
tagsInput.addEventListener("keydown", (e) => {
  const options = [...tagsListbox.querySelectorAll(".combo-option[data-value]")];
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (tagsListbox.hidden) renderTagsListbox(tagsInput.value);
    else highlightTagOption(Math.min(tagHighlightIndex + 1, options.length - 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightTagOption(Math.max(tagHighlightIndex - 1, 0));
  } else if (e.key === "Enter") {
    e.preventDefault();
    const picked =
      !tagsListbox.hidden && tagHighlightIndex >= 0 && options[tagHighlightIndex]
        ? tryAddTag(options[tagHighlightIndex].dataset.value)
        : tryAddTag(tagsInput.value);
    if (picked) {
      tagsInput.value = "";
      renderTagsListbox("");
    }
  } else if (e.key === "Backspace" && tagsInput.value === "" && currentTags.length) {
    // Empty box + Backspace removes the most recently added chip — the
    // usual multi-select tag-input convention.
    removeTag(currentTags[currentTags.length - 1]);
  } else if (e.key === "Escape") {
    closeTagsListbox();
  }
});
tagsListbox.addEventListener("mousedown", (e) => {
  // Keep focus on the text input through the click (instead of losing it
  // to the <li>) so the blur handler below doesn't race the click and
  // hide the listbox before the click can register.
  e.preventDefault();
});
tagsListbox.addEventListener("click", (e) => {
  const opt = e.target.closest(".combo-option[data-value]");
  if (!opt) return;
  if (tryAddTag(opt.dataset.value)) {
    tagsInput.value = "";
    renderTagsListbox("");
  }
});
tagsInput.addEventListener("blur", () => {
  // Commit whatever's still typed (but not yet confirmed with
  // Enter/comma) rather than silently discarding it if the user clicks
  // straight to Save.
  if (tagsInput.value.trim()) {
    tryAddTag(tagsInput.value);
    tagsInput.value = "";
  }
  closeTagsListbox();
});

function toggleRegionDrawer(forceClose = false) {
  const isOpen = regionDrawer.classList.contains("open");
  if (forceClose || isOpen) {
    regionDrawer.classList.remove("open");
    regionDrawer.setAttribute("aria-hidden", "true");
    regionDrawer.setAttribute("inert", "");
    filterToggleBtn.setAttribute("aria-expanded", "false");
  } else {
    regionDrawer.classList.add("open");
    regionDrawer.setAttribute("aria-hidden", "false");
    regionDrawer.removeAttribute("inert");
    filterToggleBtn.setAttribute("aria-expanded", "true");
  }
}

filterToggleBtn.addEventListener("click", () => toggleRegionDrawer());
regionDrawerClose.addEventListener("click", () => toggleRegionDrawer(true));

/** Region is single-select, so — like PREDS's own single-select filters (distance, zone) — picking a pill closes the drawer immediately rather than waiting for an explicit close tap. Also narrows the County combobox to that region's counties (see countiesForFilter()) and, if the previously active County isn't one of them, clears it too — otherwise the two filters could silently combine to zero results with no visual explanation. */
function setRegion(region) {
  activeRegion = region;
  syncRegionPills();
  if (activeCounty && region) {
    const pool = regionToCounties.get(region.toLowerCase());
    if (!pool || !pool.has(activeCounty)) {
      activeCounty = "";
      countyInput.value = "";
      countyClear.hidden = true;
    }
  }
  if (!countyListbox.hidden) renderCountyListbox(countyInput.value);
  updateActiveFiltersBar();
  toggleRegionDrawer(true);
  applyFilters();
}

function syncRegionPills() {
  regionPillRow.querySelectorAll(".buft[data-region]").forEach((pill) => {
    const on = pill.dataset.region === activeRegion;
    pill.classList.toggle("active", on);
    pill.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function updateActiveFiltersBar() {
  filterToggleBtn.classList.toggle("has-filter", !!activeRegion || !!activeCounty);
  const chips = [];
  if (activeRegion) chips.push({ kind: "region", label: `Region: ${activeRegion}` });
  if (activeCounty) chips.push({ kind: "county", label: `County: ${activeCounty}` });
  activeFiltersBar.innerHTML = chips
    .map(
      (c) =>
        `<button type="button" class="active-chip" data-clear="${c.kind}" aria-label="Remove filter: ${escapeHtml(c.label)}">${escapeHtml(c.label)}<span class="active-chip-x" aria-hidden="true">×</span></button>`
    )
    .join("");
}

activeFiltersBar.addEventListener("click", (e) => {
  const chip = e.target.closest(".active-chip[data-clear]");
  if (!chip) return;
  const kind = chip.getAttribute("data-clear");
  if (kind === "region") setRegion("");
  else if (kind === "county") selectCounty("");
});

function setStatus(message, isError = false) {
  statusBar.textContent = message || "";
  statusBar.classList.toggle("error", isError);
  statusBar.hidden = !message;
}

function setLoginError(message) {
  if (!loginError) return;
  loginError.textContent = message || "";
  loginError.classList.toggle("visible", !!message);
}

async function boot() {
  let result;
  try {
    result = await auth.boot();
  } catch (err) {
    // A redirect (standalone flow) came back with an error, or failed to
    // exchange — show it on the sign-in screen rather than silently
    // proceeding signed-out.
    signInScreen.hidden = false;
    showSignInScreen();
    setLoginError(err.message);
    return;
  }
  if (result === "popup") return; // this page instance is the popup; it's closing itself

  if (auth.isSignedIn()) {
    await enterApp();
  } else {
    showSignInScreen();
  }
}

function showSignInScreen() {
  signInScreen.hidden = false;
  // Pre-build the authorize URL so the "didn't open?" fallback link is a
  // real <a href> the moment it's needed — anchor clicks with
  // target="_blank" are exempt from popup blockers, unlike a window.open()
  // called after an async step.
  auth
    .prepareAuthUrl()
    .then((url) => {
      if (oauthFallback) {
        oauthFallback.href = url;
        oauthFallback.hidden = false;
      }
    })
    .catch((err) => console.warn("Could not pre-build ArcGIS auth URL:", err));
}

oauthSignInBtn.addEventListener("click", async () => {
  try {
    setLoginError("");
    oauthSignInBtn.disabled = true;
    await auth.startSignIn();
    // Standalone flow navigates away and never reaches here. Popup flow
    // resolves once sign-in completes.
    await enterApp();
  } catch (err) {
    setLoginError(err.message);
  } finally {
    oauthSignInBtn.disabled = false;
  }
});

$("#sign-out-btn").addEventListener("click", () => {
  auth.signOut();
  clearCredentialsCache();
  creds = null;
  appScreen.hidden = true;
  showSignInScreen();
  $("#sign-out-btn").hidden = true;
  filterToggleBtn.hidden = true;
  userLabel.textContent = "";
  setStatus("");
});

async function enterApp() {
  signInScreen.hidden = true;
  setStatus("Loading your account…");
  // Show the username immediately (no network round trip needed), then
  // swap in the person's actual full name once it's fetched — nicer for
  // the topbar than an ArcGIS login handle like "aspraggins_CHAMPS".
  userLabel.textContent = auth.getUsername() || "Signed in";
  auth
    .fetchDisplayName()
    .then((name) => {
      if (name) userLabel.textContent = name;
    })
    .catch(() => {});
  $("#sign-out-btn").hidden = false;
  filterToggleBtn.hidden = false;

  try {
    await auth.ensureFreshToken();
    creds = await getReadyOpCredentials(auth.getToken());
  } catch (err) {
    setStatus(`Could not load ReadyOp credentials: ${err.message}`, true);
    return;
  }

  appScreen.hidden = false;
  setStatus("");
  await loadRoster();
}

/**
 * Fetches the ENTIRE contact roster once, in batches of
 * CONFIG.ROSTER_FETCH_PAGE_SIZE, into allContacts. Everything downstream
 * — the search box, the Region/County filters, and the "continuous
 * scroll" list — then runs against that in-memory copy instead of
 * hitting the network again. Why: the search box matches across several
 * fields at once (an OR), and Region/County live in custom columns
 * ReadyOp's search API isn't documented to filter by — neither is
 * expressible as a single server-side query, so there's no way to page
 * through "just the matches" from the server. With ~3,000 contacts, one
 * short burst of requests up front is simpler and faster in practice
 * than re-querying the server on every keystroke or filter change.
 * Renders progressively as pages arrive (via applyFilters()) rather than
 * leaving the list blank until the whole roster is in.
 */
async function loadRoster() {
  rosterLoading = true;
  allContacts = [];
  knownCounties.clear();
  knownTags.clear();
  regionToCounties.clear();
  hasLoggedSample = false;
  let page = 0;
  let pages = 1;
  let total = 0;
  try {
    do {
      setStatus(
        total ? `Loading contacts… ${allContacts.length} of ${total}` : "Loading contacts…"
      );
      const result = await listContacts(creds, {
        page,
        pageSize: CONFIG.ROSTER_FETCH_PAGE_SIZE,
        filters: {},
      });
      const contacts = result.Contacts || [];
      pages = result.Pages ?? 1;
      total = result.Total_Results ?? contacts.length;

      if (!hasLoggedSample && contacts.length) {
        hasLoggedSample = true;
        // Diagnostic: dump the first contact's full raw record and field
        // names to the console. Open DevTools (F12) → Console to inspect
        // any custom field ReadyOp returns beyond Region/County.
        console.info("[ReadyOp Contacts] sample raw contact record:", contacts[0]);
        console.info("[ReadyOp Contacts] field names on that record:", Object.keys(contacts[0]));
      }

      for (const c of contacts) {
        const county = (c[CONFIG.COUNTY_FIELD] || "").trim();
        const region = (c[CONFIG.REGION_FIELD] || "").trim();
        if (county) {
          knownCounties.add(county);
          if (region) {
            const key = region.toLowerCase();
            if (!regionToCounties.has(key)) regionToCounties.set(key, new Set());
            regionToCounties.get(key).add(county);
          }
        }
        (c.Tags || "").split(",").forEach((t) => {
          const tag = t.trim();
          if (tag) knownTags.add(tag);
        });
      }
      allContacts.push(...contacts);
      refreshCountyOptions();
      applyFilters(); // progressively reveals results as more of the roster streams in
      page++;
    } while (page < pages);
    setStatus("");
  } catch (err) {
    setStatus(`Failed to load contacts: ${err.message}`, true);
  } finally {
    rosterLoading = false;
    applyFilters();
  }
}

function normalizedSearchHaystack(c) {
  const parts = CONFIG.SEARCH_FIELDS.map((f) => c[f]);
  parts.push(c[CONFIG.COUNTY_FIELD], c[CONFIG.REGION_FIELD]);
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function matchesFilters(c) {
  if (searchTerm && !normalizedSearchHaystack(c).includes(searchTerm)) return false;
  if (activeRegion && (c[CONFIG.REGION_FIELD] || "").trim().toLowerCase() !== activeRegion.toLowerCase()) {
    return false;
  }
  if (activeCounty && (c[CONFIG.COUNTY_FIELD] || "").trim() !== activeCounty) return false;
  return true;
}

function contactDisplayName(c) {
  return [c.First, c.Last].filter(Boolean).join(" ").trim();
}

/** Re-filters allContacts against the current search/Region/County state, sorts alphabetically by displayed name (First + Last — the app doesn't apply any other sort; this is purely a client-side convenience since ReadyOp's API returns contacts in its own, not-alphabetical order), resets the visible list, and renders the first batch. Call whenever the search box, a filter, or the underlying roster changes. */
function applyFilters() {
  filteredContacts = allContacts.filter(matchesFilters);
  filteredContacts.sort((a, b) =>
    contactDisplayName(a).localeCompare(contactDisplayName(b), undefined, { sensitivity: "base", numeric: true })
  );
  renderedCount = 0;
  contactList.innerHTML = "";
  revealMore();
}

/** Renders the next CONFIG.RENDER_BATCH_SIZE not-yet-rendered rows from filteredContacts. Safe to call repeatedly (scroll handler, or to auto-fill a pane that doesn't yet overflow) — no-ops once everything filtered is already rendered. */
function revealMore() {
  const nextBatch = filteredContacts.slice(renderedCount, renderedCount + CONFIG.RENDER_BATCH_SIZE);
  if (nextBatch.length === 0) {
    updateListFooter();
    if (contactList.children.length === 0) {
      contactList.innerHTML = `<li class="empty">No contacts match your search.</li>`;
    }
    return;
  }
  appendContactRows(nextBatch);
  renderedCount += nextBatch.length;
  updateListFooter();
  // Keep revealing more if the pane still doesn't even overflow — same
  // reasoning as the old network version had: otherwise there'd be
  // nothing to scroll against on a short first batch / tall window.
  if (renderedCount < filteredContacts.length && contactList.scrollHeight <= contactList.clientHeight + SCROLL_LOAD_THRESHOLD_PX) {
    revealMore();
  }
}

function updateListFooter() {
  if (rosterLoading) {
    pagerInfo.textContent = `Loading full roster… ${filteredContacts.length} match so far`;
  } else if (filteredContacts.length === 0) {
    pagerInfo.textContent = "";
  } else {
    pagerInfo.textContent = `${renderedCount} of ${filteredContacts.length} contacts`;
  }
}

function appendContactRows(contacts) {
  for (const c of contacts) {
    const li = document.createElement("li");
    li.className = "contact-row";
    li.dataset.contactId = c["Contact ID"];
    const name = contactDisplayName(c) || "(no name)";
    const sub = [c.Organization, c.Title].filter(Boolean).join(" — ");
    li.innerHTML = `<div class="name">${escapeHtml(name)}</div><div class="sub">${escapeHtml(sub)}</div>`;
    li.addEventListener("click", () => selectContact(c["Contact ID"]));
    if (String(c["Contact ID"]) === String(selectedContactId)) li.classList.add("selected");
    contactList.appendChild(li);
  }
}

// Live search — filters instantly against the in-memory roster, no
// submit button needed. Debounced slightly so a fast typist doesn't
// trigger a re-render on every keystroke.
let searchDebounceTimer = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchTerm = searchInput.value.trim().toLowerCase();
    applyFilters();
  }, 150);
});

// Auto-load the next batch once the user scrolls near the bottom of the
// list — pure continuous scroll, no button.
contactList.addEventListener("scroll", () => {
  const distanceFromBottom =
    contactList.scrollHeight - contactList.scrollTop - contactList.clientHeight;
  if (distanceFromBottom < SCROLL_LOAD_THRESHOLD_PX) revealMore();
});

editBackBtn.addEventListener("click", () => {
  appLayoutEl.classList.remove("showing-edit");
});

async function selectContact(contactId) {
  selectedContactId = contactId;
  [...contactList.children].forEach((li) =>
    li.classList.toggle("selected", li.dataset.contactId === String(contactId))
  );
  editEmptyState.hidden = true;
  editPanel.hidden = false;
  // Below the narrow-viewport breakpoint (see styles.css), this swaps the
  // list pane out for the edit pane — same "pick from a list, then see
  // one thing full-screen" pattern PREDS uses on mobile. No-op above the
  // breakpoint, since CSS only reacts to this class in that media query.
  appLayoutEl.classList.add("showing-edit");
  setStatus("Loading contact…");
  try {
    const contact = await getContact(creds, contactId);
    populateEditForm(contact);
    setStatus("");
  } catch (err) {
    setStatus(`Failed to load contact: ${err.message}`, true);
  }
}

function populateEditForm(c) {
  editForm.dataset.contactId = c["Contact ID"];
  editForm.First.value = c.First || "";
  editForm.Last.value = c.Last || "";
  editForm.Organization.value = c.Organization || "";
  editForm.Title.value = c.Title || "";
  currentTags = (c.Tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  tagsInput.value = "";
  closeTagsListbox();
  renderTagChips();
  editForm.PIN.value = c.PIN || "";
  editForm.County.value = c[CONFIG.COUNTY_FIELD] || "";
  editForm.Address.value = c[CONFIG.ADDRESS_FIELD] || "";
  editForm.Address2.value = c[CONFIG.ADDRESS2_FIELD] || "";
  editForm.City.value = c[CONFIG.CITY_FIELD] || "";
  editForm.State.value = c[CONFIG.STATE_FIELD] || "";
  editForm.Zip.value = c[CONFIG.ZIP_FIELD] || "";
  editForm.Fax.value = c[CONFIG.FAX_FIELD] || "";
  // Match case-insensitively against the fixed option list (the source
  // data has inconsistent casing, e.g. "southeast" vs "Southeast") so the
  // dropdown still reflects the right selection either way.
  const rawRegion = (c[CONFIG.REGION_FIELD] || "").trim();
  const knownRegion = CONFIG.REGION_OPTIONS.find((r) => r.toLowerCase() === rawRegion.toLowerCase());
  editForm.Region.value = knownRegion || "";

  // Only populated once the field mapping is known (see
  // applyUnmappedFieldGuards()) — the inputs stay disabled otherwise.
  if (CONFIG.SHARE_PUBLIC_FIELD) {
    const raw = (c[CONFIG.SHARE_PUBLIC_FIELD] || "").trim().toLowerCase();
    editForm.SharePublic.checked = raw === "yes" || raw === "y" || raw === "true";
  }
  if (CONFIG.PUBLIC_PHONE_FIELD) {
    editForm.PublicPhone.value = formatPhoneNumber(c[CONFIG.PUBLIC_PHONE_FIELD] || "");
  }

  const phones = c.Phones || [];
  for (let i = 0; i < 5; i++) {
    const p = phones[i] || {};
    editForm[`Phone_${i}_Number`].value = p.Number || "";
    editForm[`Phone_${i}_Type`].value = p.Type || "";
    editForm[`Phone_${i}_Textable`].checked = !!p.Textable;
  }

  const emails = c.Emails || [];
  for (let i = 0; i < 5; i++) {
    const e = emails[i] || {};
    editForm[`Email_${i}_Address`].value = e.Address || "";
    editForm[`Email_${i}_Type`].value = e.Type || "";
  }
}

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const contactId = editForm.dataset.contactId;
  const data = new FormData(editForm);
  const fields = {
    First: data.get("First") || "",
    Last: data.get("Last") || "",
    Organization: data.get("Organization") || "",
    Title: data.get("Title") || "",
    Tags: data.get("Tags") || "",
    PIN: data.get("PIN") || "",
    [CONFIG.COUNTY_FIELD]: data.get("County") || "",
    [CONFIG.ADDRESS_FIELD]: data.get("Address") || "",
    [CONFIG.ADDRESS2_FIELD]: data.get("Address2") || "",
    [CONFIG.CITY_FIELD]: data.get("City") || "",
    [CONFIG.STATE_FIELD]: data.get("State") || "",
    [CONFIG.ZIP_FIELD]: data.get("Zip") || "",
    [CONFIG.FAX_FIELD]: data.get("Fax") || "",
    [CONFIG.REGION_FIELD]: data.get("Region") || "",
  };
  // Only sent once the field mapping is known — see applyUnmappedFieldGuards().
  if (CONFIG.SHARE_PUBLIC_FIELD) {
    fields[CONFIG.SHARE_PUBLIC_FIELD] = data.get("SharePublic") ? "Yes" : "";
  }
  if (CONFIG.PUBLIC_PHONE_FIELD) {
    fields[CONFIG.PUBLIC_PHONE_FIELD] = data.get("PublicPhone") || "";
  }
  for (let i = 0; i < 5; i++) {
    const number = data.get(`Phone_${i}_Number`);
    if (number) {
      fields[`Phone_${i}_Number`] = number;
      fields[`Phone_${i}_Type`] = data.get(`Phone_${i}_Type`) || "Cell";
      fields[`Phone_${i}_Textable`] = data.get(`Phone_${i}_Textable`) ? "Y" : "N";
    }
    const address = data.get(`Email_${i}_Address`);
    if (address) {
      fields[`Email_${i}_Address`] = address;
      fields[`Email_${i}_Type`] = data.get(`Email_${i}_Type`) || "Work";
    }
  }

  setStatus("Saving…");
  saveBtn.disabled = true;
  saveBtn.classList.remove("save-success");
  const originalLabel = saveBtn.textContent;
  saveBtn.textContent = "Saving…";
  try {
    await updateContact(creds, contactId, fields);
    setStatus("Saved.");
    // Refresh just this row's name/sub-line in place rather than
    // reloading the whole (possibly long, scrolled) list.
    updateContactRowText(contactId, fields);
    // Also patch the in-memory roster so a later re-search/re-filter
    // shows the edit instead of the stale pre-save name/org/title/tags.
    const cached = allContacts.find((c) => String(c["Contact ID"]) === String(contactId));
    if (cached) Object.assign(cached, fields);
    // Pick up a newly-typed county that wasn't already in the roster's
    // known list, so it immediately shows up as a filter/datalist option.
    const newCounty = fields[CONFIG.COUNTY_FIELD];
    if (newCounty && !knownCounties.has(newCounty)) {
      knownCounties.add(newCounty);
      refreshCountyOptions();
    }
    // Unmistakable save confirmation right on the button itself — a
    // status-bar line alone was easy to miss. Flashes green with a
    // checkmark for a couple seconds, then settles back to normal.
    saveBtn.textContent = "✓ Saved";
    saveBtn.classList.add("save-success");
    saveBtn.disabled = false;
    setTimeout(() => {
      saveBtn.classList.remove("save-success");
      saveBtn.textContent = originalLabel;
    }, 2200);
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
    saveBtn.textContent = originalLabel;
    saveBtn.disabled = false;
  }
});

function updateContactRowText(contactId, fields) {
  const row = contactList.querySelector(`.contact-row[data-contact-id="${CSS.escape(String(contactId))}"]`);
  if (!row) return;
  const name = contactDisplayName(fields) || "(no name)";
  const sub = [fields.Organization, fields.Title].filter(Boolean).join(" — ");
  row.querySelector(".name").textContent = name;
  row.querySelector(".sub").textContent = sub;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

boot();
