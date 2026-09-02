// ---------------------------------------------------------------------------
// ReadyOp Contacts REST API client.
//
// Talks to CONFIG.READYOP_API_BASE_URL (the CORS relay, by default — see
// README) using the same request shapes as ReadyOp's documented API:
//   GET  /api/2013-12-01/Contacts/{AgencyID}/            (search/list)
//   GET  /api/2013-12-01/Contacts/{AgencyID}/{ContactID} (get one)
//   POST /api/2013-12-01/Contacts/{AgencyID}/{ContactID} (modify)
//
// IMPORTANT — ReadyOp's Modify endpoint has an "Update_Mode" parameter:
//   "All"     (default) replaces the whole record and CLEARS any field you
//             don't include in the request.
//   "Present" only touches the fields you actually send.
// This client always sends Update_Mode=Present so a small edit (say, one
// phone number) can never wipe out the rest of the contact's data.
// ---------------------------------------------------------------------------

import { CONFIG } from "./config.js?v=20260902j";

function authHeader(creds) {
  return "Basic " + btoa(`${creds.accountId}:${creds.token}`);
}

function contactsUrl(pathSuffix = "") {
  return `${CONFIG.READYOP_API_BASE_URL}/api/2013-12-01/Contacts/${CONFIG.READYOP_AGENCY_ID}${pathSuffix}`;
}

async function parseResponse(res) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const detail = body.Detail || body.raw || res.statusText;
    throw new Error(`ReadyOp API error (HTTP ${res.status}): ${detail}`);
  }
  return body;
}

/**
 * @param {{accountId:string, token:string}} creds
 * @param {{page?:number, pageSize?:number, filters?:Object}} opts
 */
export async function listContacts(creds, { page = 0, pageSize = CONFIG.PAGE_SIZE, filters = {} } = {}) {
  const url = new URL(contactsUrl("/"));
  url.searchParams.set("Page", page);
  url.searchParams.set("Page_Size", pageSize);
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: authHeader(creds) },
  });
  return parseResponse(res);
}

export async function getContact(creds, contactId) {
  const res = await fetch(contactsUrl(`/${contactId}`), {
    headers: { Authorization: authHeader(creds) },
  });
  return parseResponse(res);
}

/**
 * @param {{accountId:string, token:string}} creds
 * @param {string|number} contactId
 * @param {Object} fields - flat ReadyOp field names, e.g. { First, Last,
 *   Organization, Title, Tags, "Phone_0_Number", "Phone_0_Type",
 *   "Phone_0_Textable", "Email_0_Address", "Email_0_Type", Custom_1, ... }
 */
export async function updateContact(creds, contactId, fields) {
  const body = new URLSearchParams({ ...fields, Update_Mode: "Present" });
  const res = await fetch(contactsUrl(`/${contactId}`), {
    method: "POST",
    headers: {
      Authorization: authHeader(creds),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return parseResponse(res);
}

// --- Helpers to convert between ReadyOp's array-shaped API responses and
//     the flat Phone_N_*/Email_N_* fields the Modify endpoint expects ---

/** Contact.Phones (array) -> flat Phone_0_Number/Type/Textable fields. */
export function phonesToFields(phones = []) {
  const fields = {};
  phones.slice(0, 5).forEach((p, i) => {
    if (p.Number) fields[`Phone_${i}_Number`] = p.Number;
    if (p.Type) fields[`Phone_${i}_Type`] = p.Type;
    fields[`Phone_${i}_Textable`] = p.Textable ? "Y" : "N";
  });
  return fields;
}

/** Contact.Emails (array) -> flat Email_0_Address/Type fields. */
export function emailsToFields(emails = []) {
  const fields = {};
  emails.slice(0, 5).forEach((e, i) => {
    if (e.Address) fields[`Email_${i}_Address`] = e.Address;
    if (e.Type) fields[`Email_${i}_Type`] = e.Type;
  });
  return fields;
}
