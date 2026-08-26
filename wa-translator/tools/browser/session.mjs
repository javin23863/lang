// Browser acceptance must exercise the same live-account authority as the
// shipping dashboard. A locally forged signing-key token is not sufficient:
// room creation also verifies that the session belongs to an existing account.
//
// Set LINGUA_SESSION to an s2 browser session obtained by signing a dedicated
// test host into the same Worker origin being exercised. The token is read only
// from the environment and is never printed by these tools.
export async function sessionToken() {
  const session = String(process.env.LINGUA_SESSION || "").trim();
  if (!session) {
    throw new Error(
      "Set LINGUA_SESSION to a signed-in test host session from the target Worker origin; "
      + "ROOM_SIGNING_KEY alone no longer establishes a live account."
    );
  }
  if (!/^s2\.[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session)) {
    throw new Error("LINGUA_SESSION must be a current s2 browser session; legacy or malformed tokens are rejected.");
  }
  return session;
}
