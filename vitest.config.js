import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Content to run the suite against.
 *
 * errata carries no configuration of its own, so its own tests need to be
 * pointed at a content repository like any other caller. ERRATA_CONFIG and
 * ERRATA_ROOT are passed through when set. Otherwise this falls back to a
 * checkout under `_local-mirror/`, which is how the tool is developed.
 */
function contentEnv() {
  const { ERRATA_CONFIG, ERRATA_ROOT } = process.env;
  if (ERRATA_CONFIG || ERRATA_ROOT) {
    return {
      ...(ERRATA_CONFIG ? { ERRATA_CONFIG } : {}),
      ...(ERRATA_ROOT ? { ERRATA_ROOT } : {}),
    };
  }

  const mirror = path.join(here, "_local-mirror", "courses", "errata.yaml");
  if (fs.existsSync(mirror)) return { ERRATA_CONFIG: mirror };

  return {};
}

const env = contentEnv();

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "offline",
          include: ["tests/offline/**/*.test.js"],
          testTimeout: 60_000,
          env,
        },
      },
      {
        test: {
          name: "network",
          include: ["tests/network/**/*.test.js"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          env,
        },
      },
    ],
  },
});
