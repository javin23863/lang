import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: {
          MODAL_TEST: "modal-stub",
          TURN_TEST: "turn-stub",
          REPORTS_TEST: "report-stub"
        },
        workers: [{
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
          MOBILE_REPORT_ADMIN_TOKEN: "test-only-report-admin-token-32-bytes"
        }
      }
    })
  ]
});
