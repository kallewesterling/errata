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

  // Both config names, newest first, so a mirror checked out before the
  // rename keeps working without anybody having to touch it.
  for (const name of ["errata.config.yaml", "errata.yaml"]) {
    const mirror = path.join(here, "_local-mirror", "courses", name);
    if (fs.existsSync(mirror)) return { ERRATA_CONFIG: mirror };
  }

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
        // Tests pinned to a fixture rather than to whatever content the run
        // is pointed at. They are about errata's own behaviour, so they need
        // known content, and they each pin their own ERRATA_CONFIG rather
        // than inheriting one. Without that, running the suite against a real
        // checkout — which CONTRIBUTING tells you to do — fails them for
        // reasons that have nothing to do with the change under review.
        test: {
          name: "pinned-clean",
          include: ["tests/pinned/clean/**/*.test.js"],
          testTimeout: 60_000,
          env: {
            ERRATA_CONFIG: path.join(here, "tests", "fixtures", "content", "errata.config.yaml"),
          },
        },
      },
      {
        test: {
          name: "pinned-dirty",
          include: ["tests/pinned/dirty/**/*.test.js"],
          testTimeout: 60_000,
          env: {
            ERRATA_CONFIG: path.join(here, "tests", "fixtures", "dirty", "errata.config.yaml"),
          },
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
