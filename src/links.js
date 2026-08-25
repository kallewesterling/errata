/**
 * Liveness checks for URLs referenced by course content.
 *
 * HEAD is tried first because it is cheap, but many sites reject it, so a
 * non-2xx HEAD falls back to a ranged GET before the URL is called broken.
 *
 * @param {string} url
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<{ url: string, status: "ok"|"not-found"|"error", detail: string }>}
 */
export async function checkUrl(url, { signal, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });

  const attempt = async (method) =>
    fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "errata/0.1 (link check)",
        ...(method === "GET" ? { Range: "bytes=0-2047" } : {}),
      },
    });

  try {
    let res = await attempt("HEAD");
    if (!res.ok) res = await attempt("GET");

    if (res.ok) return { url, status: "ok", detail: String(res.status) };
    if (res.status === 404 || res.status === 410) {
      return { url, status: "not-found", detail: `HTTP ${res.status}` };
    }
    return { url, status: "error", detail: `HTTP ${res.status}` };
  } catch (err) {
    return { url, status: "error", detail: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string[]} urls
 * @param {{ concurrency?: number, signal?: AbortSignal }} [options]
 */
export async function checkUrls(urls, { concurrency = 8, signal } = {}) {
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
