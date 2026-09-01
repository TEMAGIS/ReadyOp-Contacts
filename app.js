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
const pagerInfo = $("#pager-info");
const prevPageBtn = $("#prev-page");
const nextPageBtn = $("#next-page");
const editPanel = $("#edit-panel");
const editForm = $("#edit-form");
const editEmptyState = $("#edit-empty-state");

let creds = null;
let currentPage = 0;
let totalPages = 1;
let selectedContactId = null;

function setStatus(message, isError = false) {
  statusBar.textContent = message || "";
  statusBar.classList.toggle("error", isError);
  statusBar.hidden = !message;
}

async function boot() {
  const existing = await auth.checkExistingSignIn();
  if (existing) {
    await enterApp();
  } else {
    signInScreen.hidden = false;
  }
}

$("#sign-in-btn").addEventListener("click", async () => {
  try {
    setStatus("Signing in…");
    await auth.signIn();
    await enterApp();
  } catch (err) {
    setStatus(`Sign-in failed: ${err.message}`, true);
  }
});

$("#sign-out-btn").addEventListener("click", () => {
  auth.signOut();
  clearCredentialsCache();
  creds = null;
  appScreen.hidden = true;
  signInScreen.hidden = false;
  $("#sign-out-btn").hidden = true;
  userLabel.textContent = "";
  setStatus("");
});

async function enterApp() {
  signInScreen.hidden = true;
  setStatus("Loading your account…");
  const user = await auth.getUserInfo();
  userLabel.textContent = user ? user.fullName || user.username : "Signed in";
  $("#sign-out-btn").hidden = false;

  try {
    creds = await getReadyOpCredentials(auth.getToken());
  } catch (err) {
    setStatus(`Could not load ReadyOp credentials: ${err.message}`, true);
    return;
  }

  appScreen.hidden = false;
  setStatus("");
  await loadPage(0);
}

function currentFilters() {
  const data = new FormData(searchForm);
  const filters = {};
  for (const [key, value] of data.entries()) {
    if (value) filters[key] = value;
  }
  return filters;
}

async function loadPage(page) {
  setStatus("Loading contacts…");
  try {
    const result = await listContacts(creds, {
      page,
      pageSize: CONFIG.PAGE_SIZE,
      filters: currentFilters(),
    });
    currentPage = result.Page ?? page;
    totalPages = result.Pages ?? 1;
    renderContactList(result.Contacts || []);
    pagerInfo.textContent = `Page ${currentPage + 1} of ${Math.max(totalPages, 1)} (${result.Total_Results ?? 0} contacts)`;
    prevPageBtn.disabled = currentPage <= 0;
    nextPageBtn.disabled = currentPage + 1 >= totalPages;
    setStatus("");
  } catch (err) {
    setStatus(`Failed to load contacts: ${err.message}`, true);
  }
}

function renderContactList(contacts) {
  contactList.innerHTML = "";
  if (contacts.length === 0) {
    contactList.innerHTML = `<li class="empty">No contacts match your search.</li>`;
    return;
  }
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
  loadPage(0);
});

prevPageBtn.addEventListener("click", () => loadPage(currentPage - 1));
nextPageBtn.addEventListener("click", () => loadPage(currentPage + 1));

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
    await loadPage(currentPage);
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
});

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
