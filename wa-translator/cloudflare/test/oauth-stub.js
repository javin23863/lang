// Stands in for the real provider token and profile endpoints, keyed by host
// and path exactly as the worker addresses them. The id_tokens here are
// unsigned on purpose: the worker verifies issuer, audience and expiry, and
// deliberately does not verify a signature on a token it fetched itself.
const GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "test-only-google-client-secret";
const FACEBOOK_APP_ID = "test-facebook-app-id";
const FACEBOOK_APP_SECRET = "test-only-facebook-app-secret";
const FACEBOOK_ACCESS_TOKEN = "fixture-facebook-access-token";

function base64url(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function idToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url(JSON.stringify({ alg: "RS256", kid: "fixture" })),
    base64url(JSON.stringify({
      iss: "https://accounts.google.com", aud: GOOGLE_CLIENT_ID,
      sub: "google-subject-1", email: "host@example.test", name: "Test Host",
      iat: now, exp: now + 3600, ...claims
    })),
    "fixture-signature-not-verified"
  ].join(".");
}

const GOOGLE_CODES = {
  "fixture-google": () => Response.json({ id_token: idToken({}) }),
  "fixture-google-second-account": () => Response.json({
    id_token: idToken({ sub: "google-subject-2", email: "other@example.test", name: "Other" })
  }),
  "fixture-google-foreign-audience": () => Response.json({
    id_token: idToken({ aud: "some-other-client-id" })
  }),
  "fixture-google-foreign-issuer": () => Response.json({
    id_token: idToken({ iss: "https://accounts.attacker.test" })
  }),
  "fixture-google-expired": () => Response.json({
    id_token: idToken({ exp: Math.floor(Date.now() / 1000) - 60 })
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
    return new Response("Not Found", { status: 404 });
  }
};
