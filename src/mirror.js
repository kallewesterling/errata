/**
 * Source adapter.
 *
 * This is the only module that knows the directory layout of the content: the
 * per-course `details.json`, `published.json` and `lessons-meta.json`, and the
 * `course-urls.json` index at the root. That shape is what Syncjar writes.
 * Reading from a different source should be a change to this file alone.
 */
import fs from "node:fs";
import path from "node:path";
import { contentRoot, primaryDomain } from "./config.js";

/**
 * @typedef {object} ContentItem
 * @property {string} id
 * @property {string} file      Path relative to the course directory.
 * @property {number} order
 */

/**
 * @typedef {object} Lesson
 * @property {string} id
 * @property {string} slug
 * @property {string} title
 * @property {number} order
 * @property {ContentItem[]} content_items
 */

/**
 * @typedef {object} Course
 * @property {string} dir       Directory name, and the key used by course-urls.json.
 * @property {string} absPath
 * @property {string|null} id
 * @property {string} title
 * @property {string|null} url  Public course URL, when one is known.
 * @property {string|null} publishedSlug
 * @property {Lesson[]} lessons
 */

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Could not parse ${file}: ${err.message}`, { cause: err });
  }
}

/** @returns {Record<string, string>} course directory name -> public URL */
export function loadCourseUrls() {
  const data = readJson(path.join(contentRoot, "course-urls.json"));
  return data?.urls ?? {};
}

/**
 * Course directories are every subdirectory of the content root. The root also
 * holds a few bare JSON index files, which are skipped by the isDirectory check.
 * @returns {string[]}
 */
export function listCourseDirs() {
  return fs
    .readdirSync(contentRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

/**
 * @param {string} dir
 * @param {Record<string, string>} urls
 * @returns {Course}
 */
function loadCourse(dir, urls) {
  const absPath = path.join(contentRoot, dir);
  const details = readJson(path.join(absPath, "details.json"));
  const published = readJson(path.join(absPath, "published.json"));
  const lessons = readJson(path.join(absPath, "lessons-meta.json")) ?? [];

  return {
    dir,
    absPath,
    id: details?.id ?? null,
    title: details?.title ?? dir,
    url: urls[dir] ?? null,
    publishedSlug: published?.domains?.[primaryDomain]?.slug ?? null,
    lessons,
  };
}

/** @returns {Course[]} */
export function loadCourses() {
  const urls = loadCourseUrls();
  return listCourseDirs().map((dir) => loadCourse(dir, urls));
}

/**
 * Public URL for a lesson. Lesson directories carry a numeric ordering prefix
 * (`60-Hands-on-...`) that is not part of the published URL.
 * @param {Course} course
 * @param {Lesson} lesson
 * @returns {string|null}
 */
export function lessonUrl(course, lesson) {
  if (!course.url) return null;
  const slug = lesson.slug.replace(/^\d+-/, "").toLowerCase();
  return `${course.url}/${slug}`;
}
