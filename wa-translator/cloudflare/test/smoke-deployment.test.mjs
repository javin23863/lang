import { describe, expect, it } from "vitest";
import { smokeDeployment } from "../scripts/smoke-deployment.mjs";

const ORIGIN = "https://staging.example";

function fakeFetch(overrides = {}) {
  return async input => {
    const url = input instanceof URL ? input : new URL(input.url || input);
    const pathname = url.pathname;
    if (overrides[pathname]) return overrides[pathname];
    if (pathname === "/health") {
      return Response.json({status: "ok"});
    }
    if (pathname === "/api/v1/mobile/bootstrap") {
      return Response.json({
        protocol: 2,
        public_origin: ORIGIN,
        account_mode: "session",
        call_lifecycle: "foreground",
        max_room_participants: 2,
      });
    }
    if (pathname === "/") {
      return new Response("<title>Lingua Relay</title>", {
        status: 200,
        headers: {
          "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
          "Permissions-Policy": "camera=(), microphone=()",
        },
      });
    }
    if (pathname === "/delete-account.html") {
      return new Response(
        "Lingua Relay — Delete your Lingua Relay account. You do not need the mobile app to continue.",
        {status: 200}
      );
    }
    return new Response(`Lingua Relay ${pathname}`, {status: 200});
  };
}

describe("credential-free deployment smoke contract", () => {
  it("accepts the two-person protocol and public launch surfaces", async () => {
    await expect(smokeDeployment(ORIGIN, fakeFetch())).resolves.toEqual({
      origin: ORIGIN,
      status: "ok",
    });
  });

  it("fails closed on participant-contract drift", async () => {
    const badBootstrap = Response.json({
      protocol: 2,
      public_origin: ORIGIN,
      account_mode: "session",
      call_lifecycle: "foreground",
      max_room_participants: 4,
    });
    await expect(smokeDeployment(ORIGIN, fakeFetch({
      "/api/v1/mobile/bootstrap": badBootstrap,
    }))).rejects.toThrow("bootstrap participant limit is not 2");
  });

  it("fails closed when public legal surfaces contain placeholders", async () => {
    await expect(smokeDeployment(ORIGIN, fakeFetch({
      "/support": new Response("Lingua Relay TODO", {status: 200}),
    }))).rejects.toThrow("/support contains a launch placeholder");
  });

  it("refuses non-HTTPS and path-bearing deployment origins", async () => {
    await expect(smokeDeployment("http://staging.example", fakeFetch()))
      .rejects.toThrow("smoke origin must use https");
    await expect(smokeDeployment("https://staging.example/room/test", fakeFetch()))
      .rejects.toThrow("smoke origin must not contain a path");
  });
});
