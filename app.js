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
const searchForm = $("#search-form");
const filterToggleBtn = $("#filter-toggle-btn");
const regionDrawer = $("#region-drawer");
const regionDrawerClose = $("#region-drawer-close");
const regionPillRow = $("#region-pill-row");
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
let activeRegion = ""; // "" means no Region filter — see setRegion()/the filter drawer below

// Infinite-scroll list state
let nextPageToLoad = 0;
let totalPages = 1;
let totalResults = 0;
let loadedCount = 0;
let isLoadingMore = false;
let hasLoggedSample = false;
let regionScanActive = false; // true while a Region filter's full-roster scan is in progress or holding results
let loadGeneration = 0; // bumped on every resetAndLoadList so a stale in-flight fetch (e.g. the user changed filters again before it finished) can detect it's been superseded and quietly stop instead of corrupting the newer results

const SCROLL_LOAD_THRESHOLD_PX = 200;

// --- Region filter drawer (same filter-button/slide-up-drawer/pill
// pattern as the sibling PREDS app, for visual consistency) ---

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
  resetAndLoadList();
}

function syncRegionPills() {
  regionPillRow.querySelectorAll(".buft[data-region]").forEach((pill) => {
    const on = pill.dataset.region === activeRegion;
    pill.classList.toggle("active", on);
    pill.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function updateActiveFiltersBar() {
  filterToggleBtn.classList.toggle("has-filter", !!activeRegion);
  if (!activeRegion) {
    activeFiltersBar.innerHTML = "";
    return;
  }
  activeFiltersBar.innerHTML = `<button type="button" class="active-chip" aria-label="Remove Region filter">Region: ${escapeHtml(activeRegion)}<span class="active-chip-x" aria-hidden="true">×</span></button>`;
}

activeFiltersBar.addEventListener("click", (e) => {
  if (e.target.closest(".active-chip")) setRegion("");
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
  await resetAndLoadList();
}

/** Text-search fields ReadyOp's API actually supports as query params — excludes Region, which isn't a real API field (see loadRegionFiltered). */
function currentTextFilters() {
  const data = new FormData(searchForm);
  const filters = {};
  for (const [key, value] of data.entries()) {
    if (key === "Region") continue;
    if (value) filters[key] = value;
  }
  return filters;
}

function currentRegionFilter() {
  return activeRegion;
}

/** Clears the list and loads the first page — call on initial load or when the search filters change. */
async function resetAndLoadList() {
  const myGeneration = ++loadGeneration;
  nextPageToLoad = 0;
  totalPages = 1;
  totalResults = 0;
  loadedCount = 0;
  regionScanActive = false;
  contactList.innerHTML = "";
  updateListFooter();

  const region = currentRegionFilter();
  if (region) {
    await loadRegionFiltered(region, myGeneration);
  } else {
    await loadMoreContacts(myGeneration);
  }
}

/**
 * ReadyOp's search API has no "Region" query parameter — Region lives in
 * a generic custom field (CONFIG.REGION_FIELD) that isn't documented as
 * filterable server-side. So a Region filter instead scans the whole
 * (optionally text-filtered) result set page by page and keeps only the
 * contacts whose REGION_FIELD matches, case-insensitively. Unlike the
 * normal infinite-scroll list, this loads everything up front.
 */
async function loadRegionFiltered(region, generation) {
  regionScanActive = true;
  isLoadingMore = true;
  const textFilters = currentTextFilters();
  const wantedRegion = region.toLowerCase();
  let page = 0;
  let pages = 1;
  let scanned = 0;
  let matched = 0;
  try {
    do {
      if (generation !== loadGeneration) return; // superseded by a newer search — stop quietly
      pagerInfo.textContent = `Scanning for "${region}"… ${matched} match${matched === 1 ? "" : "es"} so far (${scanned} contacts checked)`;
      setStatus(`Scanning contacts for Region "${region}"…`);
      const result = await listContacts(creds, {
        page,
        pageSize: CONFIG.REGION_SCAN_PAGE_SIZE,
        filters: textFilters,
      });
      if (generation !== loadGeneration) return; // superseded while this page was in flight
      const contacts = result.Contacts || [];
      pages = result.Pages ?? 1;
      scanned += contacts.length;
      const pageMatches = contacts.filter(
        (c) => (c[CONFIG.REGION_FIELD] || "").trim().toLowerCase() === wantedRegion
      );
      matched += pageMatches.length;
      loadedCount = matched;
      totalResults = matched;
      appendContactRows(pageMatches);
      page++;
    } while (page < pages);
    if (generation === loadGeneration) setStatus("");
  } catch (err) {
    if (generation === loadGeneration) setStatus(`Failed to load contacts: ${err.message}`, true);
  } finally {
    if (generation === loadGeneration) {
      isLoadingMore = false;
      pagerInfo.textContent =
        loadedCount === 0
          ? `No contacts found for Region "${region}".`
          : `${loadedCount} contact${loadedCount === 1 ? "" : "s"} in Region "${region}"`;
      if (loadedCount === 0) contactList.innerHTML = `<li class="empty">No contacts match your search.</li>`;
    }
  }
}

/** Fetches the next page of the current filtered search and appends it to the list. Safe to call repeatedly (e.g. from a scroll handler) — no-ops while a load is already in flight, no pages remain, or a Region scan is active (see loadRegionFiltered). Continuous-scroll only (no "Load more" button): if the newly-loaded content still doesn't fill/overflow the list pane, it keeps loading further pages on its own so there's always something to scroll against. */
async function loadMoreContacts(generation = loadGeneration) {
  if (isLoadingMore || nextPageToLoad >= totalPages || regionScanActive) return;
  if (generation !== loadGeneration) return;
  isLoadingMore = true;
  setStatus("Loading contacts…");
  let fetchedThisCall = 0;
  try {
    const result = await listContacts(creds, {
      page: nextPageToLoad,
      pageSize: CONFIG.PAGE_SIZE,
      filters: currentTextFilters(),
    });
    if (generation !== loadGeneration) return; // superseded while this page was in flight

    const contacts = result.Contacts || [];

    // One-time diagnostic: dump the first contact's full raw record and
    // field names to the console. Open DevTools (F12) → Console to
    // inspect any other custom field ReadyOp returns (e.g. County, which
    // this build doesn't filter on yet — see CONFIG.COUNTY_FIELD).
    if (!hasLoggedSample && contacts.length) {
      hasLoggedSample = true;
      console.info("[ReadyOp Contacts] sample raw contact record:", contacts[0]);
      console.info("[ReadyOp Contacts] field names on that record:", Object.keys(contacts[0]));
    }

    totalPages = result.Pages ?? 1;
    totalResults = result.Total_Results ?? contacts.length;
    nextPageToLoad = (result.Page ?? nextPageToLoad) + 1;
    loadedCount += contacts.length;
    fetchedThisCall = contacts.length;
    appendContactRows(contacts);
    if (contactList.children.length === 0) {
      contactList.innerHTML = `<li class="empty">No contacts match your search.</li>`;
    }
    setStatus("");
  } catch (err) {
    if (generation === loadGeneration) setStatus(`Failed to load contacts: ${err.message}`, true);
  } finally {
    if (generation === loadGeneration) {
      isLoadingMore = false;
      updateListFooter();
      // Nothing to scroll against yet (short first page on a tall pane,
      // for instance) but more is available — keep loading automatically
      // rather than leaving the user stuck with no way to trigger the
      // next page. Stops itself once the list actually overflows, once
      // pages run out, or if a page ever comes back empty.
      if (fetchedThisCall > 0 && nextPageToLoad < totalPages && contactList.scrollHeight <= contactList.clientHeight + SCROLL_LOAD_THRESHOLD_PX) {
        loadMoreContacts(generation);
      }
    }
  }
}

function updateListFooter() {
  if (loadedCount === 0) {
    pagerInfo.textContent = isLoadingMore ? "Loading…" : "";
  } else {
    pagerInfo.textContent = `${loadedCount} of ${totalResults} contacts`;
  }
}

/** Appends rows for the given contacts. Doesn't render an "empty" state itself — callers check contactList.children.length once they know no more results are coming (a mid-scan empty page isn't necessarily the final state; see loadRegionFiltered). */
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

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  resetAndLoadList();
});

// Auto-load the next page once the user scrolls near the bottom of the
// list — pure continuous scroll, no button.
contactList.addEventListener("scroll", () => {
  const distanceFromBottom =
    contactList.scrollHeight - contactList.scrollTop - contactList.clientHeight;
  if (distanceFromBottom < SCROLL_LOAD_THRESHOLD_PX) loadMoreContacts();
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
