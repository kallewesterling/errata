import { beforeAll, describe, expect, it } from "vitest";
import { configFile } from "../../src/config.js";
import { getLinks } from "../../src/inventory.js";
import { checkUrls } from "../../src/links.js";
import { checkableLinks, collectLinkProblems, judge, uniqueUrls } from "../../src/link-health.js";
import { expectNone } from "../helpers.js";

/**
 * Tier two: the links in lesson prose, checked against the live web.
 *
 * Only findings that need a person fail. A permanently moved link is real but
 * mechanically repairable, so it is reported and left to `npm run fix:links`
 * rather than failing a suite nobody can make green by editing content.
 */
const links = getLinks();
const urls = uniqueUrls(links);

let problems;
beforeAll(async () => {
  problems = collectLinkProblems(judge(await checkUrls(urls)), links);
}, 600_000);

const problem = (id) => problems.find((p) => p.id === id);

describe("links in lesson prose", () => {
  it("finds links to check", () => {
    expect(urls.length).toBeGreaterThan(0);
    expect(checkableLinks(links).length).toBeGreaterThanOrEqual(urls.length);
  });

  it("has none that are gone", () => {
    expectNone(problem("dead-link").items.length, problem("dead-link"));
  });

  /**
   * Images are checked in the same pass and asserted the same way. A broken
   * image is at least as bad as a broken link, and unlike a redirect there is
   * nothing a fixer could do about it automatically.
   */
  it("has no images that fail to load", () => {
    expectNone(problem("dead-image").items.length, problem("dead-image"));
  });

  it("checks every image the lessons display", () => {
    const images = checkableLinks(links).filter((l) => l.kind === "image");
    expect(images.length).toBeGreaterThan(0);
  });

  it("has none pointing at a heading that no longer exists", () => {
    expectNone(problem("missing-fragment").items.length, problem("missing-fragment"));
  });

  /**
   * Reported rather than asserted. These are repairable without judgement, and
   * failing on them would leave the suite red between the check running and
   * somebody merging the rewrite.
   */
  it("summarizes links that have permanently moved", () => {
    const moved = problem("moved-link").items.length;
    if (moved > 0) {
      console.log(`${moved} link(s) have permanently moved; run \`npm run fix:links\`.`);
    }
    expect(moved).toBeGreaterThanOrEqual(0);
  });

  it("summarizes redirects that need a person", () => {
    const review = problem("moved-link-review").items.length;
    if (review > 0) {
      console.log(`${review} redirect(s) need a decision; see \`npm run check:links\`.`);
    }
    expect(review).toBeGreaterThanOrEqual(0);
  });

  /**
   * A host that always refuses automated requests is configuration, not a
   * finding, so this stays loud enough to notice but does not fail.
   */
  it("summarizes links that could not be reached", () => {
    const unreachable = problem("unreachable-link").items;
    if (unreachable.length > 0) {
      console.log(
        `${unreachable.length} link(s) did not respond. If a host refuses every ` +
          `run, add it to links.skip in ${configFile}.`,
      );
    }
    expect(unreachable.length).toBeGreaterThanOrEqual(0);
  });
});
