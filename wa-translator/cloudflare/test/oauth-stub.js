// Stands in for the real provider token and profile endpoints, keyed by host
// and path exactly as the worker addresses them. The id_tokens here are
// unsigned on purpose: the worker verifies issuer, audience and expiry, and
// deliberately does not verify a signature on a token it fetched itself.
const GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "test-only-google-client-secret";
const FACEBOOK_APP_ID = "test-facebook-app-id";
const FACEBOOK_APP_SECRET = "test-only-facebook-app-secret";
const FACEBOOK_ACCESS_TOKEN = "fixture-facebook-access-token";
const APPLE_CLIENT_ID = "test.lingua.relay.service";
const APPLE_TEAM_ID = "TESTTEAM01";
const APPLE_KEY_ID = "TESTKEY123";

function base64url(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  return atob(padded);
}

function idToken(defaults, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url(JSON.stringify({ alg: "RS256", kid: "fixture" })),
    base64url(JSON.stringify({ iat: now, exp: now + 3600, ...defaults, ...claims })),
    "fixture-signature-not-verified"
  ].join(".");
}

function googleIdToken(claims = {}) {
  return idToken({
    iss: "https://accounts.google.com", aud: GOOGLE_CLIENT_ID,
    sub: "google-subject-1", email: "host@example.test", name: "Test Host"
  }, claims);
}

function appleIdToken(claims = {}) {
  return idToken({
    iss: "https://appleid.apple.com", aud: APPLE_CLIENT_ID,
    sub: "apple-subject-1", email: "relay-user@privaterelay.appleid.com"
  }, claims);
}

function appleClientSecretIsValid(value) {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return false;
  try {
    const header = JSON.parse(decodeBase64url(parts[0]));
    const payload = JSON.parse(decodeBase64url(parts[1]));
    const now = Math.floor(Date.now() / 1000);
    return header.alg === "ES256" && header.kid === APPLE_KEY_ID
      && payload.iss === APPLE_TEAM_ID && payload.sub === APPLE_CLIENT_ID
      && payload.aud === "https://appleid.apple.com"
      && Number.isInteger(payload.iat) && Number.isInteger(payload.exp)
      && payload.iat <= now + 5 && payload.exp > now && payload.exp - payload.iat <= 600;
  } catch {
    return false;
  }
}

const GOOGLE_CODES = {
  "fixture-google": () => Response.json({ id_token: googleIdToken() }),
  "fixture-google-second-account": () => Response.json({
    id_token: googleIdToken({ sub: "google-subject-2", email: "other@example.test", name: "Other" })
  }),
  "fixture-google-unsafe-name": () => Response.json({
    id_token: googleIdToken({ name: "Host\u202e\u0007Admin" })
  }),
  "fixture-google-foreign-audience": () => Response.json({
    id_token: googleIdToken({ aud: "some-other-client-id" })
  }),
  "fixture-google-foreign-issuer": () => Response.json({
    id_token: googleIdToken({ iss: "https://accounts.attacker.test" })
  }),
  "fixture-google-expired": () => Response.json({
    id_token: googleIdToken({ exp: Math.floor(Date.now() / 1000) - 60 })
  }),
  "fixture-google-unusable-code": () => new Response("invalid_grant", { status: 400 }),
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/me")) {
      if (request.headers.get("Authorization") !== `Bearer ${FACEBOOK_ACCESS_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      return Response.json({
        id: "facebook-subject-1", name: "Facebook Host", email: "fb@example.test"
      });
    }
    if (request.method !== "POST") return new Response("Not Found", { status: 404 });
    const form = await request.formData();
    if (form.get("grant_type") !== "authorization_code"
        || !/^https:\/\/room\.test\/auth\/[a-z]+\/callback$/.test(form.get("redirect_uri") || "")) {
      return new Response("invalid_request", { status: 400 });
    }
    if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
      if (form.get("client_id") !== GOOGLE_CLIENT_ID
          || form.get("client_secret") !== GOOGLE_CLIENT_SECRET) {
        return new Response("invalid_client", { status: 401 });
      }
      const code = GOOGLE_CODES[form.get("code") || ""];
      return code ? code() : new Response("invalid_grant", { status: 400 });
    }
    if (url.hostname === "graph.facebook.com" && url.pathname.endsWith("/oauth/access_token")) {
      if (form.get("client_id") !== FACEBOOK_APP_ID
          || form.get("client_secret") !== FACEBOOK_APP_SECRET) {
        return new Response("invalid_client", { status: 401 });
      }
      return form.get("code") === "fixture-facebook"
        ? Response.json({ access_token: FACEBOOK_ACCESS_TOKEN, token_type: "bearer" })
        : new Response("invalid_grant", { status: 400 });
    }
    if (url.hostname === "appleid.apple.com" && url.pathname === "/auth/token") {
      if (form.get("client_id") !== APPLE_CLIENT_ID
          || !appleClientSecretIsValid(form.get("client_secret"))) {
        return new Response("invalid_client", { status: 401 });
      }
      return form.get("code") === "fixture-apple"
        ? Response.json({ id_token: appleIdToken() })
        : new Response("invalid_grant", { status: 400 });
    }
    return new Response("Not Found", { status: 404 });
  }
};