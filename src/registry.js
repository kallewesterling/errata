const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(",");

/**
 * Split an image reference into registry, repository and the tag or digest.
 * Returns null for references that are not a resolvable image, such as the
 * `<registry>/token` auth endpoint that appears in curl examples.
 *
 * @param {string} ref
 */
export function parseImageRef(ref) {
  const match = /^([^/]+)\/(.+?)(?::([^:@/]+))?(?:@(sha256:[a-f0-9]{64}))?$/.exec(ref);
  if (!match) return null;

  const [, registry, repository, tag, digest] = match;
  if (!repository.includes("/")) return null; // e.g. <registry>/token

  return { registry, repository, reference: digest ?? tag ?? "latest", ref };
}

const tokenCache = new Map();

/**
 * Anonymous pull token. Public repositories issue one without credentials.
 *
 * The in-flight promise is cached so concurrent lookups against a repository
 * share one request, but a rejected promise is evicted. Leaving it cached
 * would make one failed token fetch permanent for the rest of the run and
 * defeat any retry above it.
 */
async function getToken(registry, repository, signal) {
  const key = `${registry}/${repository}`;
  if (!tokenCache.has(key)) {
    const pending = (async () => {
      const url = `https://${registry}/token?scope=repository:${repository}:pull`;
      const res = await fetch(url, { signal });
      if (!res.ok) return null;
      const body = await res.json();
      return body.token ?? body.access_token ?? null;
    })();
    pending.catch(() => tokenCache.delete(key));
    tokenCache.set(key, pending);
  }
  return tokenCache.get(key);
}

/**
 * Statuses the registry returns about the reference itself, as opposed to
 * about the state of the connection. Retrying these would only produce the
 * same answer more slowly.
 */
const CONCLUSIVE = new Set(["ok", "not-found", "unauthorized", "unparseable"]);

/**
 * Retry a lookup that failed for reasons unrelated to the reference.
 *
 * The registry rate-limits, and both network test files resolve references at
 * once, so a run occasionally reports references as broken when the connection
 * was at fault. A suite that fails at random gets ignored, which costs more
 * than the second spent retrying.
 *
 * @template {{ status: string }} T
 * @param {() => Promise<T>} attempt
 * @param {number} tries
 * @returns {Promise<T>}
 */
async function withRetry(attempt, tries = 3) {
  let result = await attempt();
  for (let i = 1; i < tries && !CONCLUSIVE.has(result.status); i++) {
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (i - 1)));
    result = await attempt();
  }
  return result;
}

/**
 * @typedef {object} ImageResolution
 * @property {string} ref
 * @property {"ok"|"not-found"|"unauthorized"|"error"|"unparseable"} status
 * @property {string} detail
 */

/**
 * Resolve an image reference against its registry.
 *
 * A 401 is reported distinctly from a 404: private images are expected in
 * this content and are not broken references, whereas a 404 means the course
 * points at something that no longer exists.
 *
 * @param {string} ref
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<ImageResolution>}
 */
export function resolveImage(ref, options = {}) {
  return withRetry(() => resolveImageOnce(ref, options));
}

/**
 * @param {string} ref
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<ImageResolution>}
 */
async function resolveImageOnce(ref, { signal } = {}) {
  const parsed = parseImageRef(ref);
  if (!parsed) return { ref, status: "unparseable", detail: "not an image reference" };

  const { registry, repository, reference } = parsed;
  try {
    const token = await getToken(registry, repository, signal);
    const res = await fetch(
      `https://${registry}/v2/${repository}/manifests/${reference}`,
      {
        method: "HEAD",
        headers: {
          Accept: MANIFEST_ACCEPT,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal,
      },
    );

    if (res.ok) return { ref, status: "ok", detail: String(res.status) };
    if (res.status === 401 || res.status === 403) {
      return { ref, status: "unauthorized", detail: `HTTP ${res.status}` };
    }
    if (res.status === 404) return { ref, status: "not-found", detail: "HTTP 404" };
    return { ref, status: "error", detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ref, status: "error", detail: err.message };
  }
}

/**
 * Digest the registry currently serves for a reference.
 *
 * The registry reports it in the `Docker-Content-Digest` response header, so
 * the manifest body never has to be downloaded.
 *
 * @param {{ registry: string, repository: string, reference: string }} parsed
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ digest: string|null, detail: string }>}
 */
export async function getManifestDigest(parsed, { signal } = {}) {
  const { registry, repository, reference } = parsed;
  try {
    const token = await getToken(registry, repository, signal);
    const res = await fetch(
      `https://${registry}/v2/${repository}/manifests/${reference}`,
      {
        method: "HEAD",
        headers: {
          Accept: MANIFEST_ACCEPT,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal,
      },
    );

    if (!res.ok) return { digest: null, detail: `HTTP ${res.status}` };
    const digest = res.headers.get("docker-content-digest");
    return digest
      ? { digest, detail: "ok" }
      : { digest: null, detail: "no digest header" };
  } catch (err) {
    return { digest: null, detail: err.message };
  }
}

async function fetchJson(registry, repository, path, accept, signal) {
  const token = await getToken(registry, repository, signal);
  const res = await fetch(`https://${registry}/v2/${repository}/${path}`, {
    headers: {
      ...(accept ? { Accept: accept } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Build timestamp of an image, read from its config blob.
 *
 * Knowing only that a pinned digest differs from its tag is close to useless
 * here, because these images are rebuilt continuously and every pin falls
 * behind within days. The build date is what makes the difference meaningful:
 * days behind is noise, years behind means the surrounding lesson describes a
 * different era of the image.
 *
 * Costs three requests — index, platform manifest, config blob — so it is only
 * worth doing for the handful of digests the content actually pins.
 *
 * @param {{ registry: string, repository: string, reference: string }} parsed
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ created: Date|null, detail: string }>}
 */
export async function getImageCreated(parsed, { signal } = {}) {
  const { registry, repository, reference } = parsed;
  try {
    let manifest = await fetchJson(
      registry,
      repository,
      `manifests/${reference}`,
      MANIFEST_ACCEPT,
      signal,
    );

    // Multi-platform images point at per-architecture manifests; any platform
    // carries the same build timestamp, so prefer amd64 and fall back.
    if (Array.isArray(manifest.manifests)) {
      const platform =
        manifest.manifests.find(
          (m) => m.platform?.architecture === "amd64" && m.platform?.os === "linux",
        ) ?? manifest.manifests[0];
      if (!platform) return { created: null, detail: "empty image index" };
      manifest = await fetchJson(
        registry,
        repository,
        `manifests/${platform.digest}`,
        MANIFEST_ACCEPT,
        signal,
      );
    }

    const configDigest = manifest.config?.digest;
    if (!configDigest) return { created: null, detail: "no config descriptor" };

    const config = await fetchJson(
      registry,
      repository,
      `blobs/${configDigest}`,
      null,
      signal,
    );
    const created = config.created ? new Date(config.created) : null;
    return created && !Number.isNaN(created.valueOf())
      ? { created, detail: "ok" }
      : { created: null, detail: "no created timestamp" };
  } catch (err) {
    return { created: null, detail: err.message };
  }
}

/**
 * Resolve many references with bounded concurrency, so a course full of image
 * mentions does not open hundreds of sockets at once.
 *
 * @param {string[]} refs
 * @param {{ concurrency?: number, signal?: AbortSignal }} [options]
 */
export async function resolveImages(refs, { concurrency = 8, signal } = {}) {
  const queue = [...refs];
  const results = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const ref = queue.shift();
      results.push(await resolveImage(ref, { signal }));
    }
  });
  await Promise.all(workers);
  return results;
}
