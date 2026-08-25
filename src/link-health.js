/**
 * Turning link-check results into findings.
 *
 * Kept apart from the checking itself so that the test suite, the CLI report
 * and the rewriter all reach the same verdict about the same link. The
 * rewriter in particular must not have its own private idea of which redirects
 * are safe, or it will edit content the report never warned about.
 */
import { isOwnedDomain, skipReason } from "./config.js";
import { comparable, fragmentOf } from "./links.js";
import { style } from "./report.js";

/**
 * @typedef {object} LinkVerdict
 * @property {import("./links.js").LinkResult} result
 * @property {"dead"|"moved"|"review"|"temporary"|"fragment"|"unreachable"|"ok"} verdict
 * @property {string} [reason]  Why a redirect needs a human, when it does.
 */

/** Every checkable prose reference, with the skipped ones removed. */
export function checkableLinks(links) {
  return links.filter((link) => link.scheme === "http" && !skipReason(link.url));
}

/** Unique URLs to request, so one fetch answers for every place it appears. */
export function uniqueUrls(links) {
  return [...new Set(checkableLinks(links).map((link) => link.url))];
}

/** Path segments of a URL, for ancestor comparisons. */
function segments(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * True when `url` is an ancestor of some other page we have seen.
 *
 * This is how a section index is told apart from a page, without hardcoding
 * any knowledge of the site. `/docs/containers/` is an ancestor of
 * `/docs/containers/faq/`, so it is a landing page; `/docs/containers/faq/`
 * is an ancestor of nothing, so it is a real page.
 *
 * @param {string} url
 * @param {string[][]} allPaths
 */
function isSectionIndex(url, allPaths) {
  const own = segments(url);
  if (own.length === 0) return true;
  return allPaths.some(
    (other) =>
      other.length > own.length && own.every((part, i) => other[i] === part),
  );
}

/** The last path segment, which is a page's own name within its section. */
const leafOf = (url) => segments(url).at(-1) ?? "";

/**
 * Decide what should happen to each checked URL.
 *
 * The interesting judgement is which redirects may be applied without a human
 * reading them. A permanent redirect is authoritative about where a page went,
 * but not every 301 is a page move: sites also use them to sweep whole retired
 * sections onto a landing page. Following one of those turns a precise link
 * into a vague one while reporting success, which is worse than leaving it
 * alone, so three shapes are held back for review.
 *
 * Counting how many links share a destination is deliberately not one of them.
 * After a site reorganizes, several old addresses legitimately resolve to one
 * new page, and treating that as suspicious holds back exactly the links most
 * worth fixing.
 *
 * @param {import("./links.js").LinkResult[]} results
 * @returns {LinkVerdict[]}
 */
export function judge(results) {
  // Every page known to exist, whether reached directly or after a redirect,
  // so the ancestor test has the fullest possible picture of the site.
  const allPaths = results
    .filter((r) => r.status === "ok")
    .map((r) => segments(r.redirect?.finalUrl ?? r.url));

  const destinations = new Map();
  for (const result of results) {
    if (!result.redirect) continue;
    const target = comparable(result.redirect.finalUrl);
    if (!destinations.has(target)) destinations.set(target, new Set());
    destinations.get(target).add(comparable(result.url));
  }

  return results.map((result) => {
    if (result.status === "not-found") return { result, verdict: "dead" };
    if (result.status === "error") return { result, verdict: "unreachable" };
    if (result.fragment === "missing") return { result, verdict: "fragment" };
    if (!result.redirect) return { result, verdict: "ok" };

    if (!result.redirect.permanent) return { result, verdict: "temporary" };

    if (!isOwnedDomain(result.url) || !isOwnedDomain(result.redirect.finalUrl)) {
      return {
        result,
        verdict: "review",
        reason: "not a domain we control, so the redirect is not ours to trust",
      };
    }

    let target;
    try {
      target = new URL(result.redirect.finalUrl);
    } catch {
      return { result, verdict: "review", reason: "destination is not a valid URL" };
    }

    if (target.pathname === "/" || target.pathname === "") {
      return {
        result,
        verdict: "review",
        reason: "lands on the site root, so the page is gone rather than moved",
      };
    }

    // A page that keeps its own name has been relocated, however far it moved
    // and however deep the destination sits. Whole sections get renamed around
    // a page without the page itself changing, and those are exactly the moves
    // worth applying in bulk.
    const keptItsName = leafOf(result.url) === leafOf(result.redirect.finalUrl);

    if (!keptItsName && isSectionIndex(result.redirect.finalUrl, allPaths)) {
      return {
        result,
        verdict: "review",
        reason:
          "lands on a section index under a different name, so the original " +
          "was swept into its section rather than relocated",
      };
    }

    return { result, verdict: "moved" };
  });
}

/** Redirects that may be applied to the content without a human reading them. */
export const safeRewrites = (verdicts) => verdicts.filter((v) => v.verdict === "moved");

/**
 * The URL a moved link should be rewritten to.
 *
 * A redirect response can never report a fragment, because fragments are not
 * sent to servers. Taking the response URL verbatim would therefore delete the
 * `#section` from every link that had one, turning a precise reference into a
 * link to the top of a long page while the surrounding sentence still promises
 * a specific section. The fragment is carried across instead.
 *
 * This is only safe because a link whose anchor is missing at the destination
 * never reaches here: it is judged `fragment` and held back for a person.
 *
 * @param {import("./links.js").LinkResult} result
 */
export function rewriteTarget(result) {
  const target = result.redirect.finalUrl;
  const fragment = fragmentOf(result.url);
  if (!fragment) return target;
  if (new URL(target).hash) return target;
  return `${target}#${new URL(result.url).hash.slice(1)}`;
}

/** Every finding this module can emit, for validating known-issues entries. */
export const LINK_PROBLEM_IDS = Object.freeze([
  "dead-link",
  "dead-image",
  "moved-link",
  "moved-link-review",
  "missing-fragment",
  "temporary-redirect",
  "unreachable-link",
]);

/**
 * The alt text of the first occurrence of an image, to name it in a report.
 *
 * A URL alone is a poor way to identify a broken screenshot, since the bucket
 * names assets by hash.
 *
 * @param {Map<string, import("./inventory.js").ProseLink[]>} sites
 * @param {string} url
 */
function altFor(sites, url) {
  return (sites.get(url) ?? []).find((link) => link.kind === "image")?.text ?? "";
}

/**
 * Build the problem list for a set of judged links.
 *
 * @param {LinkVerdict[]} verdicts
 * @param {import("./inventory.js").ProseLink[]} links
 * @returns {import("./problems.js").Problem[]}
 */
export function collectLinkProblems(verdicts, links) {
  const sites = new Map();
  for (const link of checkableLinks(links)) {
    if (!sites.has(link.url)) sites.set(link.url, []);
    sites.get(link.url).push(link);
  }

  /** Where a URL appears, so a finding can be acted on. */
  const locationsFor = (url) =>
    (sites.get(url) ?? []).map((link) => ({
      editorRef: link.editorRef,
      url: link.lessonUrl,
    }));

  /** One finding per URL, keyed by the URL so an edit expires any acceptance. */
  const item = (verdict, summary, details) => ({
    summary,
    key: verdict.result.url,
    details,
    locations: locationsFor(verdict.result.url),
  });

  /** What the page does with a URL. The same URL can be both. */
  const usedAs = (url, kind) =>
    (sites.get(url) ?? []).some((link) => link.kind === kind);

  const of = (name) => verdicts.filter((v) => v.verdict === name);

  return [
    {
      id: "dead-link",
      title: "links in prose that are gone",
      why:
        "The lesson tells a reader to follow this link and the server says " +
        "there is nothing there, so the reader hits a 404 mid-lesson.",
      fix:
        "Find where the page moved to and update the href, or remove the " +
        "sentence if the material no longer exists.",
      items: of("dead")
        .filter((v) => usedAs(v.result.url, "link"))
        .map((v) => item(v, `${style.link(v.result.url)}  ${style.bad(v.result.detail)}`)),
      accepted: [],
    },
    {
      id: "dead-image",
      title: "images that do not load",
      why:
        "An image is not a promise a reader can choose not to follow; it is " +
        "part of the page. When the source is gone the lesson renders with a " +
        "hole in it, and a screenshot of the thing being explained is usually " +
        "carrying the explanation.",
      fix:
        "Check the asset was uploaded to the bucket under the name the lesson " +
        "uses. If the image is genuinely gone, replace it rather than dropping " +
        "the tag, because the surrounding prose refers to it.",
      items: of("dead")
        .filter((v) => usedAs(v.result.url, "image"))
        .map((v) =>
          item(v, `${style.link(v.result.url)}  ${style.bad(v.result.detail)}`, [
            ["alt text", altFor(sites, v.result.url) || "(none)"],
          ]),
        ),
      accepted: [],
    },
    {
      id: "moved-link",
      title: "links to pages that have permanently moved",
      why:
        "Each of these answers with a 301, so nothing looks broken today, but " +
        "the content points at an address its owner has retired. Redirects are " +
        "eventually retired too, and until then every reader takes an extra hop.",
      fix:
        "Run `npm run fix:links` to rewrite these to their current addresses, " +
        "then read the diff: the destination is correct by construction, but " +
        "the sentence around the link may need rewording.",
      items: of("moved").map((v) =>
        item(v, style.link(v.result.url), [["now at", rewriteTarget(v.result)]]),
      ),
      accepted: [],
    },
    {
      id: "moved-link-review",
      severity: "warning",
      title: "redirects that need a person to judge them",
      why:
        "These are permanent redirects that should not be applied blindly. A " +
        "redirect onto a section index or a shared landing page means the " +
        "original page was retired, not relocated, and following it would " +
        "quietly swap a specific reference for a vague one.",
      fix:
        "Open each destination and decide what the lesson actually meant to " +
        "link to. That is usually a specific page elsewhere, not the page the " +
        "redirect lands on.",
      items: of("review").map((v) =>
        item(v, style.link(v.result.url), [
          ["lands on", v.result.redirect.finalUrl],
          ["why held", v.reason],
        ]),
      ),
      accepted: [],
    },
    {
      id: "missing-fragment",
      title: "links to a heading that no longer exists",
      why:
        "The page loads, so every status-code check passes, but the #anchor " +
        "does not match anything on it. The reader lands at the top of a long " +
        "page with no idea which part they were sent to.",
      fix:
        "Open the page, find the heading the lesson meant, and update the " +
        "fragment. If the section is gone, link to the page without a fragment.",
      items: of("fragment").map((v) =>
        item(v, `${style.link(v.result.url)}  ${style.bad("no such anchor")}`),
      ),
      accepted: [],
    },
    {
      id: "temporary-redirect",
      severity: "warning",
      title: "links answered by a temporary redirect",
      why:
        "A 302 or 307 says the detour is not permanent, so the content should " +
        "keep pointing where it points. Worth knowing about, not worth acting on.",
      fix:
        "Usually nothing. If one of these persists for months it is really a " +
        "permanent move, and the destination should be adopted.",
      items: of("temporary").map((v) =>
        item(v, style.link(v.result.url), [
          ["sent to", v.result.redirect.finalUrl],
          ["status", String(v.result.redirect.code ?? "unknown")],
        ]),
      ),
      accepted: [],
    },
    {
      id: "unreachable-link",
      severity: "warning",
      title: "links that could not be checked",
      why:
        "These failed to answer rather than answering badly, so nothing is " +
        "known about them either way. Some hosts refuse automated requests.",
      fix:
        "Re-run first, since most are transient. If a host refuses every time, " +
        "add it to links.skip with the reason.",
      items: of("unreachable").map((v) =>
        item(v, `${style.link(v.result.url)}  ${style.warn(v.result.detail)}`),
      ),
      accepted: [],
    },
  ];
}
