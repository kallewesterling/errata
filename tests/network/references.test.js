import { beforeAll, describe, expect, it } from "vitest";
import { configFile, privateImageAllowlist } from "../../src/config.js";
import { getInventory } from "../../src/inventory.js";
import { style } from "../../src/report.js";
import { checkUrls } from "../../src/links.js";
import { parseImageRef, resolveImages } from "../../src/registry.js";
import { expectNone } from "../helpers.js";

/**
 * Tier two: checks that reach the network. Split from the offline project so
 * a contributor can run the fast suite without depending on registry or site
 * availability. Run with `npm run test:network`.
 */
const blocks = getInventory();

/** Every place a reference is mentioned, so a failure points somewhere. */
function locationsFor(key, field) {
  return blocks
    .filter((b) => b[field].includes(key))
    .map((b) => ({ editorRef: b.editorRef, url: b.url }));
}

describe("container image references resolve", () => {
  const refs = [
    ...new Set(blocks.flatMap((b) => b.imageRefs)),
  ].filter((ref) => parseImageRef(ref) !== null);

  let results;
  beforeAll(async () => {
    results = await resolveImages(refs);
  }, 180_000);

  it("finds image references to check", () => {
    expect(refs.length).toBeGreaterThan(0);
  });

  it("has no references the registry reports as missing", () => {
    const missing = results.filter((r) => r.status === "not-found");
    expectNone(missing.length, {
      title: "image references the registry no longer has",
      why:
        "A reader running this command gets a manifest-unknown error, so the " +
        "lesson cannot be completed as written.",
      items: missing.map((r) => ({
        summary: `${style.heading(r.ref)}  ${style.muted(r.detail)}`,
        locations: locationsFor(r.ref, "imageRefs"),
      })),
      fix:
        "Point the lesson at an image that still exists, usually the current " +
        "tag rather than a pinned digest.",
    });
  });

  it("reports transport errors rather than hiding them", () => {
    const errored = results.filter((r) => r.status === "error");
    expectNone(errored.length, {
      title: "registry lookups that failed",
      why: "The reference could not be judged either way.",
      items: errored.map((r) => ({
        summary: `${style.heading(r.ref)}  ${style.bad(r.detail)}`,
        locations: locationsFor(r.ref, "imageRefs"),
      })),
      fix:
        "Usually a transient network problem; re-run. If it persists, check " +
        "whether the registry host in registryPrefixes is still correct.",
    });
  });

  /**
   * Private images are legitimate in a handful of courses that teach against
   * them, but a private image anywhere else usually means a sample was pasted
   * from internal material and a reader cannot pull it.
   */
  it("keeps images needing auth inside allowlisted courses", () => {
    const needsAuth = new Set(
      results.filter((r) => r.status === "unauthorized").map((r) => r.ref),
    );

    const offenders = new Map();
    for (const block of blocks) {
      if (privateImageAllowlist.has(block.course.dir)) continue;
      for (const ref of block.imageRefs) {
        if (!needsAuth.has(ref)) continue;
        if (!offenders.has(block.course.dir)) offenders.set(block.course.dir, []);
        offenders.get(block.course.dir).push({ ref, block });
      }
    }

    expectNone(offenders.size, {
      title: "courses referencing images that require authentication",
      why:
        "A reader without access gets a 401 and cannot complete the lesson. " +
        "This usually means a sample was pasted from internal material.",
      items: [...offenders].map(([course, found]) => ({
        summary: style.heading(course),
        details: found.map(({ ref }) => ["image", ref]),
        locations: found.map(({ block }) => ({
          editorRef: block.editorRef,
          url: block.url,
        })),
      })),
      fix:
        "Switch the lesson to a publicly pullable image. If the course " +
        "legitimately teaches against private images, add its directory name " +
        `to privateImages.allowedCourses in ${configFile}.`,
    });
  });

  it("summarizes references needing authentication", () => {
    const priv = results.filter((r) => r.status === "unauthorized");
    if (priv.length > 0) {
      console.log(
        `Image references requiring auth (${priv.length}):\n${priv
          .map((r) => `  ${r.ref}`)
          .join("\n")}`,
      );
    }
    expect(results.length).toBe(refs.length);
  });

  /** An allowlist entry that no longer needs to be there is worth removing. */
  it("does not allowlist courses that have no private images", () => {
    const needsAuth = new Set(
      results.filter((r) => r.status === "unauthorized").map((r) => r.ref),
    );
    const coursesUsingPrivate = new Set(
      blocks
        .filter((b) => b.imageRefs.some((ref) => needsAuth.has(ref)))
        .map((b) => b.course.dir),
    );

    const stale = [...privateImageAllowlist].filter(
      (course) => !coursesUsingPrivate.has(course),
    );
    expectNone(stale.length, {
      title: "allowlisted courses that no longer use private images",
      why:
        "An allowlist entry that has outlived its reason quietly widens what " +
        "the suite accepts.",
      items: stale.map((course) => ({ summary: style.heading(course) })),
      fix: `Remove these from privateImages.allowedCourses in ${configFile}.`,
    });
  });
});

/**
 * Only URLs a command would actually retrieve are checked. A URL sitting in a
 * code block is usually data rather than a link, and fetching those yields
 * false positives that make the suite untrustworthy.
 */
describe("URLs that commands fetch resolve", () => {
  const urls = [...new Set(blocks.flatMap((b) => b.fetchUrls))];

  let results;
  beforeAll(async () => {
    results = await checkUrls(urls);
  }, 180_000);

  it("has no dead links", () => {
    const dead = results.filter((r) => r.status === "not-found");
    expectNone(dead.length, {
      title: "dead URLs fetched by commands",
      why:
        "The command downloads this URL, so a reader following the lesson gets " +
        "a 404 instead of the file.",
      items: dead.map((r) => ({
        summary: `${style.link(r.url)}  ${style.muted(r.detail)}`,
        locations: locationsFor(r.url, "fetchUrls"),
      })),
      fix: "Update the URL in the lesson, or remove the step if it is obsolete.",
    });
  });

  it("summarizes URLs that could not be reached", () => {
    const errored = results.filter((r) => r.status === "error");
    if (errored.length > 0) {
      console.log(
        `URLs that did not respond cleanly (${errored.length}):\n${errored
          .map((r) => `  ${r.url}: ${r.detail}`)
          .join("\n")}`,
      );
    }
    expect(results.length).toBe(urls.length);
  });
});
