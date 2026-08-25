/**
 * Liveness checks for URLs referenced by course content.
 *
 * Three separate things can be wrong with a link, and they need different
 * treatment, so they are reported on different fields rather than collapsed
 * into one status:
 *
 *   reachability  the page is missing (404) or could not be judged (timeout)
 *   relocation    the page answers, but only after moving somewhere else
 *   fragment      the page answers, but the #anchor it points at is gone
 *
 * The last two are invisible to a checker that only looks at status codes,
 * which is why a link can rot for years while every automated check passes.
 */

const USER_AGENT = "errata/0.1 (link check)";

/**
 * Compare two URLs the way a reader would, ignoring differences that carry no
 * meaning.
 *
 * The fragment is dropped because it is never sent to the server: `response.url`
 * can never carry one, so comparing with it would report every fragment link as
 * relocated. The trailing slash is dropped because sites normalize it freely.
 *
 * @param {string} url
 */
export function comparable(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** The `#fragment` of a URL, decoded, or null when there is none. */
export function fragmentOf(url) {
  try {
    const hash = new URL(url).hash.slice(1);
    if (!hash) return null;
    // A text directive addresses prose, not an element, so there is no id to
    // look for and its absence is not a defect.
    if (hash.startsWith(":~:")) return null;
    return decodeURIComponent(hash);
  } catch {
    return null;
  }
}

/**
 * True when `body` contains an element the fragment would scroll to.
 *
 * Matched with a regex rather than a parse because the question is narrow and
 * the alternative is parsing several hundred full documents to answer it.
 *
 * @param {string} body
 * @param {string} fragment
 */
export function hasAnchor(body, fragment) {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:id|name)\\s*=\\s*(?:"${escaped}"|'${escaped}'|${escaped}(?=[\\s/>]))`,
    "i",
  ).test(body);
}

/**
 * Ask the server whether a redirect is permanent.
 *
 * Only a 301 or 308 is a statement that the old address is finished and the
 * new one should be adopted. A 302 or 307 may be temporary, seasonal, or a
 * login bounce, so rewriting content to follow one would be presumptuous.
 *
 * @param {string} url
 * @param {AbortSignal} [signal]
 */
async function firstHop(url, signal) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal,
      headers: { "User-Agent": USER_AGENT },
    });
    return { code: res.status, permanent: res.status === 301 || res.status === 308 };
  } catch {
    return { code: null, permanent: false };
  }
}

/**
 * @typedef {object} LinkResult
 * @property {string} url
 * @property {"ok"|"not-found"|"error"} status  Whether the page could be reached.
 * @property {string} detail
 * @property {{finalUrl: string, code: number|null, permanent: boolean}|null} redirect
 * @property {"ok"|"missing"|"unchecked"|null} fragment
 *   null when the URL has no fragment to check.
 */

/**
 * Check one URL.
 *
 * HEAD is tried first because it is cheap, but many sites reject it, so a
 * non-2xx HEAD falls back to GET before the URL is called broken.
 *
 * @param {string} url
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<LinkResult>}
 */
export async function checkUrl(url, { signal, timeoutMs = 20_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });

  const fragment = fragmentOf(url);
  /** @type {LinkResult} */
  const result = { url, status: "error", detail: "", redirect: null, fragment: null };

  const attempt = (method) =>
    fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });

  try {
    // A fragment can only be judged against the document, so skip straight to
    // GET when there is one rather than paying for a HEAD that cannot answer.
    let res = fragment ? await attempt("GET") : await attempt("HEAD");
    if (!res.ok && !fragment) res = await attempt("GET");

    if (res.ok) {
      result.status = "ok";
      result.detail = String(res.status);
    } else if (res.status === 404 || res.status === 410) {
      result.status = "not-found";
      result.detail = `HTTP ${res.status}`;
    } else {
      result.status = "error";
      result.detail = `HTTP ${res.status}`;
    }

    if (res.ok && comparable(res.url) !== comparable(url)) {
      const hop = await firstHop(url, controller.signal);
      result.redirect = { finalUrl: res.url, ...hop };
    }

    if (fragment) {
      if (!res.ok) {
        result.fragment = "unchecked";
      } else {
        const body = await res.text();
        result.fragment = hasAnchor(body, fragment) ? "ok" : "missing";
      }
    }

    return result;
  } catch (err) {
    result.status = "error";
    result.detail = err.name === "AbortError" ? "timeout" : err.message;
    if (fragment) result.fragment = "unchecked";
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string[]} urls
 * @param {{ concurrency?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<LinkResult[]>}
 */
export async function checkUrls(urls, { concurrency = 10, signal } = {}) {
  const queue = [...urls];
  const results = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      results.push(await checkUrl(queue.shift(), { signal }));
    }
  });
  await Promise.all(workers);
  return results;
}
