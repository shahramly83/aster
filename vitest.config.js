import { defineConfig } from "vitest/config";

// Tests live next to what they cover: src/lib for client logic, supabase/functions
// for edge-function logic. Both are plain ESM and run in Node.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{js,ts}", "supabase/functions/**/*.test.ts"],
    environment: "node",
  },
});
