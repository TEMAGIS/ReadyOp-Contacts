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

import { CONFIG } from "./config.js?v=20260902u";

function authHeader(creds) {
  return "Basic " + btoa(`${creds.accountId}:${creds.token}`);
}

function contactsUrl(pathSuffix = "") {
  return `${CONFIG.READYOP_API_BASE_URL}/api/2013-12-01/Contacts/${CONFIG.READYOP_AGENCY_ID}${pathSuffix}`;
}

// ReadyOp exposes its ten generic custom columns as "Custom 0".."Custom 20"
// (a space) in GET/search responses -- that's what CONFIG.COUNTY_FIELD,
// REGION_FIELD, ADDRESS_FIELD, SHARE_PUBLIC_FIELD, etc. in config.js are set
// to, since that's what the rest of the app reads and filters against. But
// the Modify (write) endpoint doesn't recognize that space-separated name --
// it silently rejects the whole request with a generic "One or more request
// parameters are missing or invalid." (no field-level detail) if any
// "Custom N" key is present. It wants an underscore instead: "Custom_N".
// Rather than keep two different names for the same field throughout the
// app, convert at this one boundary, right before a write goes out.
function toWriteFieldName(name) {
  const m = /^Custom (\d+)$/.exec(name);
  return m ? `Custom_${m[1]}` : name;
}

async function parseResponse(res, requestContext) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    // ReadyOp's own top-level message (e.g. "One or more request parameters
    // are missing or invalid.") rarely names which field it means. Some of
    // its endpoints include a more specific breakdown under other keys
    // (seen in the wild: Message, Errors, ModelState, error_description) --
    // surface whichever of those exist too, and always dump the full raw
    // body + the request we sent to the console so a 400 can actually be
    // debugged from DevTools instead of just the one-line status message.
    const specifics = [body.Detail, body.Message, body.error_description]
      .filter(Boolean)
      .join(" ");
    const nested = body.Errors || body.ModelState || body.errors;
    const detail = specifics || body.raw || res.statusText || "(no detail returned)";
    console.error("ReadyOp API error", {
      status: res.status,
      url: res.url,
      requestBody: requestContext,
      responseBody: body,
      nestedErrors: nested,
    });
    const nestedSuffix = nested ? ` -- see console for field-level detail` : "";
    throw new Error(`ReadyOp API error (HTTP ${res.status}): ${detail}${nestedSuffix}`);
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
  const fullFields = { Update_Mode: "Present" };
  for (const [key, value] of Object.entries(fields)) {
    fullFields[toWriteFieldName(key)] = value;
  }
  const body = new URLSearchParams(fullFields);
  // Log what we're about to send *before* the request fires, not just on
  // failure -- if the tab crashes/reloads mid-save this still lands in the
  // console history, and it lets you diff a working save against a failing
  // one side by side.
  console.log("ReadyOp updateContact request", { contactId, fields: fullFields });
  const res = await fetch(contactsUrl(`/${contactId}`), {
    method: "POST",
    headers: {
      Authorization: authHeader(creds),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return parseResponse(res, fullFields);
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
