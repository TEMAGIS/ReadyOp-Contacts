// ---------------------------------------------------------------------------
// ArcGIS OAuth sign-in.
//
// Uses the ArcGIS Maps SDK for JavaScript's identity modules directly (no
// map/view needed) so a signed-in user's portal token is available to read
// the protected credentials feature layer.
//
// Works both as a standalone page and embedded via an iframe/Embed widget
// inside ArcGIS Online Experience Builder — the OAuth flow runs in a popup
// window so it doesn't navigate the iframe away from the experience.
//
// NOTE ON VERSION: pinned to a specific ArcGIS Maps SDK release below. Check
// https://developers.arcgis.com/javascript/latest/ for the current version
// and bump the URL (both places) if it's gone stale.
// ---------------------------------------------------------------------------

import { CONFIG } from "./config.js";

const SDK_VERSION = "4.31";
const base = `https://js.arcgis.com/${SDK_VERSION}/@arcgis/core`;

const [{ default: OAuthInfo }, { default: IdentityManager }] = await Promise.all([
  import(`${base}/identity/OAuthInfo.js`),
  import(`${base}/identity/IdentityManager.js`),
]);

// popup:true keeps the sign-in flow in a popup window instead of navigating
// this page away — required when embedded in an Experience Builder iframe.
// popupCallbackUrl is left unset, so the SDK defaults to
// "<this app's folder>/oauth-callback.html" — that file is included at the
// project root; see README for the Redirect URI to register.
const info = new OAuthInfo({
  appId: CONFIG.ARCGIS_APP_ID,
  portalUrl: CONFIG.ARCGIS_PORTAL_URL,
  popup: true,
});
IdentityManager.registerOAuthInfos([info]);

const sharingUrl = `${CONFIG.ARCGIS_PORTAL_URL}/sharing`;

/** Resolves with an esri Credential if a session already exists, else null. */
export async function checkExistingSignIn() {
  try {
    return await IdentityManager.checkSignInStatus(sharingUrl);
  } catch {
    return null;
  }
}

/** Opens the ArcGIS sign-in popup. Resolves with the Credential on success. */
export async function signIn() {
  return IdentityManager.getCredential(sharingUrl, {
    oAuthPopupConfirmation: false,
  });
}

export function signOut() {
  IdentityManager.destroyCredentials();
}

/** Current portal token for the signed-in user, or null if not signed in. */
export function getToken() {
  const cred = IdentityManager.findCredential(sharingUrl);
  return cred ? cred.token : null;
}

/** Fetches the signed-in user's username/full name for display, best-effort. */
export async function getUserInfo() {
  const token = getToken();
  if (!token) return null;
  const res = await fetch(
    `${CONFIG.ARCGIS_PORTAL_URL}/sharing/rest/community/self?f=json&token=${encodeURIComponent(token)}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return { username: data.username, fullName: data.fullName };
}
