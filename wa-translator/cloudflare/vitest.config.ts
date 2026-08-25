import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Several abuse-control cases deliberately exercise dozens of sequential
  // Durable Object requests. Five seconds is too tight on a loaded CI runner;
  // the assertions still bound behavior, while this avoids timing-only flakes.
  test: { testTimeout: 10_000 },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: {
          MODAL_TEST: "modal-stub",
          TURN_TEST: "turn-stub",
          REPORTS_TEST: "report-stub",
          OAUTH_TEST: "oauth-stub"
        },
        workers: [{
          name: "oauth-stub",
          modules: true,
          scriptPath: "./test/oauth-stub.js"
        }, {
          name: "modal-stub",
          modules: true,
          scriptPath: "./test/modal-stub.js"
        }, {
          name: "turn-stub",
          modules: true,
          scriptPath: "./test/turn-stub.js"
        }, {
          name: "report-stub",
          modules: true,
          scriptPath: "./test/report-stub.js"
        }],
        bindings: {
          PUBLIC_ORIGIN: "https://room.test",
          ROOM_SIGNING_KEY: "test-only-room-signing-key-32-bytes",
          MODAL_SHARED_SECRET: "test-only-modal-secret",
          MODAL_WS_URL: "https://modal.test/stream",
          MODAL_TTS_URL: "https://modal.test/tts",
          TURN_KEY_ID: "test-turn-key",
          TURN_API_TOKEN: "test-only-turn-token",
          MOBILE_ANDROID_CERT_SHA256: "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
          MOBILE_APPLE_TEAM_ID: "TESTTEAM01",
          MOBILE_REPORT_ADMIN_TOKEN: "test-only-report-admin-token-32-bytes",
          GOOGLE_CLIENT_ID: "test-google-client-id.apps.googleusercontent.com",
          GOOGLE_CLIENT_SECRET: "test-only-google-client-secret",
          FACEBOOK_APP_ID: "test-facebook-app-id",
          FACEBOOK_APP_SECRET: "test-only-facebook-app-secret"
          // Apple stays unset on purpose: the suite asserts that an
          // unprovisioned provider 404s instead of offering a dead button.
        }
      }
    })
  ]
});
