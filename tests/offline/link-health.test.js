import { describe, expect, it } from "vitest";
import { comparable, fragmentOf, hasAnchor } from "../../src/links.js";
import { judge, rewriteTarget, safeRewrites } from "../../src/link-health.js";

/**
 * A checked URL that came back clean.
 * @param {string} url
 * @param {Partial<import("../../src/links.js").LinkResult>} [extra]
 * @returns {import("../../src/links.js").LinkResult}
 */
const ok = (url, extra = {}) => ({
  url,
  status: "ok",
  detail: "200",
  redirect: null,
  fragment: null,
  ...extra,
});

/**
 * A checked URL that was redirected somewhere.
 * @param {string} url
 * @param {string} finalUrl
 * @param {number} [code]
 * @returns {import("../../src/links.js").LinkResult}
 */
const moved = (url, finalUrl, code = 301) =>
  ok(url, {
    redirect: { finalUrl, code, permanent: code === 301 || code === 308 },
  });

describe("comparable", () => {
  /**
   * Fragments are never sent to a server, so a response URL can never carry
   * one. Comparing with the fragment would report every fragment link as
   * relocated, which is the single easiest way to make the report worthless.
   */
  it("ignores the fragment", () => {
    expect(comparable("https://e.com/a#x")).toBe(comparable("https://e.com/a"));
  });

  it("ignores a trailing slash", () => {
    expect(comparable("https://e.com/a/")).toBe(comparable("https://e.com/a"));
  });

  it("keeps a genuine path difference", () => {
    expect(comparable("https://e.com/a")).not.toBe(comparable("https://e.com/b"));
  });

  it("keeps the query string", () => {
    expect(comparable("https://e.com/a?x=1")).not.toBe(comparable("https://e.com/a"));
  });

  it("passes through something that is not a URL", () => {
    expect(comparable("not a url")).toBe("not a url");
  });
});

describe("fragmentOf", () => {
  it("returns the decoded fragment", () => {
    expect(fragmentOf("https://e.com/a#the-part")).toBe("the-part");
    expect(fragmentOf("https://e.com/a#a%20b")).toBe("a b");
  });

  it("returns null when there is none", () => {
    expect(fragmentOf("https://e.com/a")).toBe(null);
    expect(fragmentOf("https://e.com/a#")).toBe(null);
  });

  /** A text directive addresses prose, so there is no element id to look for. */
  it("ignores a text directive", () => {
    expect(fragmentOf("https://e.com/a#:~:text=hello")).toBe(null);
  });
});

describe("hasAnchor", () => {
  it("matches an id in either quote style, or none", () => {
    expect(hasAnchor('<h2 id="intro">', "intro")).toBe(true);
    expect(hasAnchor("<h2 id='intro'>", "intro")).toBe(true);
    expect(hasAnchor("<h2 id=intro>", "intro")).toBe(true);
  });

  it("matches a name attribute", () => {
    expect(hasAnchor('<a name="intro"></a>', "intro")).toBe(true);
  });

  it("does not match a different anchor", () => {
    expect(hasAnchor('<h2 id="introduction">', "intro")).toBe(false);
  });

  it("does not match the fragment appearing as prose", () => {
    expect(hasAnchor("<p>see the intro section</p>", "intro")).toBe(false);
  });

  it("treats regex characters in the fragment literally", () => {
    expect(hasAnchor('<h2 id="a.b">', "a.b")).toBe(true);
    expect(hasAnchor('<h2 id="axb">', "a.b")).toBe(false);
  });
});

describe("judge", () => {
  it("calls a missing page dead", () => {
    const [v] = judge([{ ...ok("https://edu.chainguard.dev/a"), status: "not-found" }]);
    expect(v.verdict).toBe("dead");
  });

  it("calls an unreachable page unreachable rather than dead", () => {
    const [v] = judge([{ ...ok("https://edu.chainguard.dev/a"), status: "error" }]);
    expect(v.verdict).toBe("unreachable");
  });

  it("reports a missing anchor on a page that loads", () => {
    const [v] = judge([ok("https://edu.chainguard.dev/a#x", { fragment: "missing" })]);
    expect(v.verdict).toBe("fragment");
  });

  it("leaves a healthy link alone", () => {
    expect(judge([ok("https://edu.chainguard.dev/a")])[0].verdict).toBe("ok");
  });

  it("does not act on a temporary redirect", () => {
    const [v] = judge([moved("https://edu.chainguard.dev/a", "https://edu.chainguard.dev/b", 302)]);
    expect(v.verdict).toBe("temporary");
  });

  it("accepts a permanent move that keeps the page name", () => {
    const [v] = judge([
      moved(
        "https://edu.chainguard.dev/old/section/compatibility/",
        "https://edu.chainguard.dev/new/section/compatibility/",
      ),
    ]);
    expect(v.verdict).toBe("moved");
  });

  /**
   * A whole section can be renamed around a page without the page changing,
   * which is the commonest shape of all and must not need a human.
   */
  it("accepts a move to a deeper path under a renamed section", () => {
    const [v] = judge([
      moved(
        "https://edu.chainguard.dev/chainguard/chainguard-images/getting-started/pytorch/",
        "https://edu.chainguard.dev/chainguard/containers/getting-started/pytorch/",
      ),
    ]);
    expect(v.verdict).toBe("moved");
  });

  it("holds back a redirect onto the site root", () => {
    const [v] = judge([
      moved("https://edu.chainguard.dev/old/page/", "https://edu.chainguard.dev/"),
    ]);
    expect(v.verdict).toBe("review");
    expect(v.reason).toMatch(/site root/);
  });

  /**
   * A destination that is an ancestor of another known page is a section
   * index. Landing there under a different name means the original was swept
   * away rather than moved, and following it would lose the reference.
   */
  it("holds back a redirect that sweeps a page into its section index", () => {
    const verdicts = judge([
      moved(
        "https://edu.chainguard.dev/chainguard/chainguard-images/vuln-comparison/",
        "https://edu.chainguard.dev/chainguard/containers/",
      ),
      ok("https://edu.chainguard.dev/chainguard/containers/faq/"),
    ]);
    expect(verdicts[0].verdict).toBe("review");
    expect(verdicts[0].reason).toMatch(/section index/);
  });

  it("holds back a redirect leaving a domain we control", () => {
    const [v] = judge([
      moved("https://edu.chainguard.dev/a/thing/", "https://example.com/a/thing/"),
    ]);
    expect(v.verdict).toBe("review");
    expect(v.reason).toMatch(/not a domain we control/);
  });

  /**
   * Several old addresses resolving to one new page is ordinary after a
   * reorganization, and treating it as suspicious would hold back exactly the
   * links most worth repairing.
   */
  it("does not hold back a move merely because another link shares its destination", () => {
    const verdicts = judge([
      moved(
        "https://edu.chainguard.dev/old/reference/python/getting-started-python/",
        "https://edu.chainguard.dev/new/getting-started/python/",
      ),
      moved(
        "https://edu.chainguard.dev/old/getting-started/python/",
        "https://edu.chainguard.dev/new/getting-started/python/",
      ),
    ]);
    expect(verdicts.map((v) => v.verdict)).toEqual(["moved", "moved"]);
  });

  it("holds back a move whose anchor is gone at the destination", () => {
    const [v] = judge([
      {
        ...moved(
          "https://edu.chainguard.dev/a/page/#section",
          "https://edu.chainguard.dev/b/page/",
        ),
        fragment: "missing",
      },
    ]);
    expect(v.verdict).toBe("fragment");
  });

  it("offers only the safe moves for rewriting", () => {
    const verdicts = judge([
      moved("https://edu.chainguard.dev/a/keep/", "https://edu.chainguard.dev/b/keep/"),
      moved("https://edu.chainguard.dev/a/gone/", "https://edu.chainguard.dev/"),
      { ...ok("https://edu.chainguard.dev/x"), status: "not-found" },
    ]);
    expect(safeRewrites(verdicts)).toHaveLength(1);
    expect(safeRewrites(verdicts)[0].result.url).toBe("https://edu.chainguard.dev/a/keep/");
  });
});

/**
 * A redirect response cannot carry a fragment, so the naive rewrite deletes
 * every `#section` it touches. That is silent damage: the link still resolves,
 * so nothing complains, while the sentence around it goes on promising a
 * specific section the reader is no longer taken to.
 */
describe("rewriteTarget", () => {
  it("uses the destination as-is when there was no fragment", () => {
    const result = moved("https://edu.chainguard.dev/a/", "https://edu.chainguard.dev/b/");
    expect(rewriteTarget(result)).toBe("https://edu.chainguard.dev/b/");
  });

  it("carries the fragment across to the new address", () => {
    const result = moved(
      "https://edu.chainguard.dev/a/page/#multi-stage-builds",
      "https://edu.chainguard.dev/b/page/",
    );
    expect(rewriteTarget(result)).toBe(
      "https://edu.chainguard.dev/b/page/#multi-stage-builds",
    );
  });

  it("does not stack a fragment onto one the destination already has", () => {
    const result = moved(
      "https://edu.chainguard.dev/a/page/#one",
      "https://edu.chainguard.dev/b/page/#two",
    );
    expect(rewriteTarget(result)).toBe("https://edu.chainguard.dev/b/page/#two");
  });

  it("preserves fragment characters that need encoding", () => {
    const result = moved(
      "https://edu.chainguard.dev/a/page/#a%20b",
      "https://edu.chainguard.dev/b/page/",
    );
    expect(rewriteTarget(result)).toBe("https://edu.chainguard.dev/b/page/#a%20b");
  });
});
