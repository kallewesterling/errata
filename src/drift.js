import { staleImageDays } from "./config.js";
import { getImageCreated, getManifestDigest, parseImageRef } from "./registry.js";
import { imageRepository } from "./warnings.js";

/**
 * Compares digests pinned in the content against what the registry serves now.
 *
 * Reported as a warning rather than a failure, for two reasons. Pinning an
 * older image is sometimes deliberate — several lessons pin one specifically
 * to demonstrate a diff against a newer one — and these images are rebuilt
 * continuously, so essentially every pin is behind its tag within days. A
 * digest that stops resolving altogether is a different matter and fails in
 * the reference tests.
 *
 * Being behind is therefore not the signal; age is. A pin a few days behind is
 * normal, one several years behind means the surrounding lesson describes an
 * image that no longer resembles what a reader would pull.
 *
 * @typedef {object} DriftResult
 * @property {string} ref
 * @property {"current"|"behind"|"stale"|"unknown"} status
 * @property {string|null} pinned
 * @property {string|null} currentDigest
 * @property {string} comparedTag
 * @property {Date|null} created
 * @property {number|null} ageDays
 * @property {string} detail
 */

/** The tag a pinned reference is implicitly claiming to represent. */
function comparisonTag(ref) {
  const withoutDigest = ref.split("@")[0];
  const tagged = /:([A-Za-z0-9._-]+)$/.exec(withoutDigest);
  return tagged ? tagged[1] : "latest";
}

/**
 * @param {string} ref  An image reference containing `@sha256:`.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<DriftResult>}
 */
export async function checkDrift(ref, { signal } = {}) {
  const pinned = /@(sha256:[a-f0-9]{64})/.exec(ref)?.[1] ?? null;
  const tag = comparisonTag(ref);
  const repository = imageRepository(ref);
  const base = {
    ref,
    pinned,
    comparedTag: tag,
    created: null,
    ageDays: null,
    currentDigest: null,
  };

  const tagRef = parseImageRef(`${repository}:${tag}`);
  if (!tagRef || !pinned) {
    return { ...base, status: "unknown", detail: "not resolvable" };
  }

  const current = await getManifestDigest(tagRef, { signal });
  if (!current.digest) {
    // Private repositories and transport errors cannot be judged either way.
    return { ...base, status: "unknown", detail: current.detail };
  }
  if (current.digest === pinned) {
    return { ...base, status: "current", currentDigest: current.digest, detail: "matches tag" };
  }

  const pinnedRef = parseImageRef(`${repository}@${pinned}`);
  const { created, detail } = pinnedRef
    ? await getImageCreated(pinnedRef, { signal })
    : { created: null, detail: "unparseable" };

  if (!created) {
    return {
      ...base,
      status: "behind",
      currentDigest: current.digest,
      detail: `behind :${tag}, age unknown (${detail})`,
    };
  }

  const ageDays = Math.floor((Date.now() - created.valueOf()) / 86_400_000);
  return {
    ...base,
    status: ageDays >= staleImageDays ? "stale" : "behind",
    currentDigest: current.digest,
    created,
    ageDays,
    detail: `built ${created.toISOString().slice(0, 10)}, ${ageDays} days old, behind :${tag}`,
  };
}

/**
 * @param {string[]} refs
 * @param {{ concurrency?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<DriftResult[]>}
 */
export async function checkDriftAll(refs, { concurrency = 6, signal } = {}) {
  const queue = [...refs];
  const results = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      results.push(await checkDrift(queue.shift(), { signal }));
    }
  });
  await Promise.all(workers);
  return results;
}

/** Digest-pinned references found anywhere in the inventory. */
export function pinnedRefs(blocks) {
  return [
    ...new Set(blocks.flatMap((b) => b.imageRefs).filter((r) => r.includes("@sha256:"))),
  ].sort();
}
