import fs from "node:fs";
import path from "node:path";
import { contentRoot, repoRoot } from "./config.js";
import { loadCourses } from "./mirror.js";

/**
 * Resolve a metadata-declared path one segment at a time against the real
 * directory entries.
 *
 * `fs.existsSync` cannot answer this: on macOS's case-insensitive filesystem
 * it returns true for a path whose case does not match disk, so the mismatch
 * stays invisible until the same content is read on a case-sensitive
 * filesystem, where the lesson silently disappears instead.
 *
 * @param {string} baseDir  Directory the relative path is resolved against.
 * @param {string} relPath  Path as declared in metadata.
 * @returns {{ kind: "exact"|"case-mismatch"|"missing", actual: string|null }}
 */
function resolveSegments(baseDir, relPath) {
  let current = baseDir;
  let mismatched = false;

  for (const segment of relPath.split("/").filter(Boolean)) {
    let entries;
    try {
      entries = fs.readdirSync(current);
    } catch {
      return { kind: "missing", actual: null };
    }

    if (entries.includes(segment)) {
      current = path.join(current, segment);
      continue;
    }
    const insensitive = entries.find(
      (e) => e.toLowerCase() === segment.toLowerCase(),
    );
    if (!insensitive) return { kind: "missing", actual: null };
    mismatched = true;
    current = path.join(current, insensitive);
  }

  return { kind: mismatched ? "case-mismatch" : "exact", actual: current };
}

/**
 * Real on-disk path for a metadata-declared content file, tolerating the case
 * mismatches that `checkContentPaths` reports. Extraction should still see
 * every lesson on a case-sensitive filesystem, so the test suite reports the
 * mismatch rather than losing the content.
 *
 * @param {string} courseAbsPath
 * @param {string} relFile
 * @returns {string|null}
 */
export function resolveContentFile(courseAbsPath, relFile) {
  return resolveSegments(courseAbsPath, relFile).actual;
}

/**
 * Check every content path declared in `lessons-meta.json` against the real
 * tree. Case mismatches are portability bugs: they work on macOS and fail on
 * a case-sensitive filesystem, where the lesson would be skipped silently.
 *
 * @returns {{ caseMismatches: object[], missing: object[], total: number }}
 */
export function checkContentPaths() {
  const caseMismatches = [];
  const missing = [];
  let total = 0;

  for (const course of loadCourses()) {
    for (const lesson of course.lessons) {
      for (const item of lesson.content_items ?? []) {
        total += 1;
        const { kind, actual } = resolveSegments(course.absPath, item.file);
        if (kind === "exact") continue;
        const record = {
          course: course.dir,
          lesson: lesson.slug,
          declared: item.file,
          actual: actual ? path.relative(course.absPath, actual) : null,
        };
        if (kind === "case-mismatch") caseMismatches.push(record);
        else missing.push(record);
      }
    }
  }

  return { caseMismatches, missing, total };
}

/**
 * HTML files on disk that no `lessons-meta.json` refers to, compared
 * case-insensitively so that case mismatches are reported by
 * `checkContentPaths` rather than showing up twice.
 * @returns {string[]}
 */
export function findUnreferencedContentFiles() {
  const referenced = new Set();
  for (const course of loadCourses()) {
    for (const lesson of course.lessons) {
      for (const item of lesson.content_items ?? []) {
        referenced.add(path.join(course.absPath, item.file).toLowerCase());
      }
    }
  }

  const orphans = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.name.endsWith(".html") &&
        !referenced.has(full.toLowerCase())
      ) {
        orphans.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(contentRoot);
  return orphans.sort();
}
