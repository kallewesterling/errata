import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "offline",
          include: ["tests/offline/**/*.test.js"],
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "network",
          include: ["tests/network/**/*.test.js"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
