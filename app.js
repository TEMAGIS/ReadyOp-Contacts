import { CONFIG } from "./config.js";
import * as auth from "./arcgis-auth.js";
import { getReadyOpCredentials, clearCredentialsCache } from "./credentials.js";
import { listContacts, getContact, updateContact } from "./readyop-client.js";

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
const countySelect = $("#county-select");
const activeFiltersBar = $("#active-filters");
const pagerInfo = $("#pager-info");
const editPanel = $("#edit-panel");
const editForm = $("#edit-form");
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

// --- Search + filters ---
let searchTerm = "";
let activeRegion = ""; // "" = no Region filter
let activeCounty = ""; // "" = no County filter

// --- Rendering (reveals more of the already-filtered array as the user scrolls) ---
let filteredContacts = [];
let renderedCount = 0;
const SCROLL_LOAD_THRESHOLD_PX = 200;

// --- Region/County filter drawer (same filter-button/slide-up-drawer/
// pill pattern as the sibling PREDS app, for visual consistency) ---

buildRegionPills();

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

/** Rebuilds the County <select>'s options from whatever distinct values have been seen so far in COUNTY_FIELD across the loaded roster (called as more of the roster streams in, and once more when it finishes) — not a hardcoded list, since only the live data can say what's actually there (including any inconsistent spellings). */
function refreshCountyOptions() {
  const previousValue = countySelect.value;
  countySelect.innerHTML = `<option value="">All counties</option>`;
  [...knownCounties].sort((a, b) => a.localeCompare(b)).forEach((county) => {
    const opt = document.createElement("option");
    opt.value = county;
    opt.textContent = county;
    countySelect.appendChild(opt);
  });
  // Restore the selection if that county is still in the (possibly
  // regrown) list — it always will be once the roster has fully loaded,
  // this only matters for the brief window while it's still streaming in.
  if (previousValue && [...countySelect.options].some((o) => o.value === previousValue)) {
    countySelect.value = previousValue;
  }
}

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

/** Region is single-select, so — like PREDS's own single-select filters (distance, zone) — picking a pill closes the drawer immediately rather than waiting for an explicit close tap. */
function setRegion(region) {
  activeRegion = region;
  syncRegionPills();
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

countySelect.addEventListener("change", () => {
  activeCounty = countySelect.value;
  updateActiveFiltersBar();
  applyFilters();
  // County (unlike Region) doesn't close the drawer on selection — matches
  // PREDS's own zone-filter pattern, which also stays open after picking,
  // since a <select> doesn't have the same "I'm clearly done" signal a
  // pill tap does.
});

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
  else if (kind === "county") {
    activeCounty = "";
    countySelect.value = "";
    updateActiveFiltersBar();
    applyFilters();
  }
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
  userLabel.textContent = "";
  setStatus("");
});

async function enterApp() {
  signInScreen.hidden = true;
  setStatus("Loading your account…");
  userLabel.textContent = auth.getUsername() || "Signed in";
  $("#sign-out-btn").hidden = false;

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
        if (county) knownCounties.add(county);
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

/** Re-filters allContacts against the current search/Region/County state, resets the visible list, and renders the first batch. Call whenever the search box, a filter, or the underlying roster changes. */
function applyFilters() {
  filteredContacts = allContacts.filter(matchesFilters);
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
    const name = [c.First, c.Last].filter(Boolean).join(" ") || "(no name)";
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

async function selectContact(contactId) {
  selectedContactId = contactId;
  [...contactList.children].forEach((li) =>
    li.classList.toggle("selected", li.dataset.contactId === String(contactId))
  );
  editEmptyState.hidden = true;
  editPanel.hidden = false;
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
  editForm.Tags.value = c.Tags || "";

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
  };
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
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
});

function updateContactRowText(contactId, fields) {
  const row = contactList.querySelector(`.contact-row[data-contact-id="${CSS.escape(String(contactId))}"]`);
  if (!row) return;
  const name = [fields.First, fields.Last].filter(Boolean).join(" ") || "(no name)";
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
