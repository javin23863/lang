export default {
  async fetch(request) {
    const body = await request.json();
    if (request.method !== "POST"
        || request.headers.get("Authorization") !== "Bearer test-only-turn-token"
        || body.ttl !== 3600) {
      return new Response("Unauthorized", { status: 401 });
    }
    return Response.json({
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478"] },
        {
          urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
          username: "short-lived-user",
          credential: "short-lived-credential"
        }
      ]
    }, { status: 201 });
  }
};
