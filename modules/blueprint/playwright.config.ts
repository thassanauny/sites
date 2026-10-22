import { availableParallelism } from "node:os";
import { defineConfig } from "@playwright/test";

// Half the CPUs, between two and four: more workers did not make the suite faster. BROWSER_WORKERS overrides.
const workers = Number(process.env.BROWSER_WORKERS) || Math.min(4, Math.max(2, Math.floor(availableParallelism() / 2)));

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers,
  use: {
    baseURL: process.env.BLUEPRINT_TEST_BASE_URL || "http://127.0.0.1:5193",
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "local", testMatch: "**/workspace.spec.ts" },
    ...(process.env.BLUEPRINT_TEST_BASE_URL
      ? []
      : [
          {
            name: "cloud",
            testMatch: ["**/cloud.spec.ts", "**/collaborative.spec.ts"],
            use: { baseURL: "http://127.0.0.1:5194" },
          },
        ]),
  ],
  webServer: process.env.BLUEPRINT_TEST_BASE_URL
    ? undefined
    : [
        {
          command: "npm run dev -- --port 5193 --strictPort",
          url: "http://127.0.0.1:5193",
          reuseExistingServer: false,
          env: {
            VITE_SUPABASE_URL: "https://blueprint-test.supabase.co",
            VITE_SUPABASE_ANON_KEY: "sb_publishable_test",
            BLUEPRINT_VITE_CACHE_DIR: "node_modules/.vite-blueprint-local",
          },
        },
        {
          command: "npm run dev -- --port 5194 --strictPort",
          url: "http://127.0.0.1:5194",
          reuseExistingServer: false,
          env: {
            BLUEPRINT_VITE_CACHE_DIR: "node_modules/.vite-blueprint-cloud",
            VITE_SUPABASE_URL: "https://blueprint-test.supabase.co",
            VITE_SUPABASE_ANON_KEY: "sb_publishable_test",
          },
        },
      ],
});
