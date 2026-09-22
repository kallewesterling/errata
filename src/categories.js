/**
 * What kind of work a finding needs.
 *
 * Separate from severity, which says how loudly to report something. These
 * say who fixes it and with what. The two are orthogonal: a stale link and a
 * malformed block can both be worth failing a run over, and both need
 * entirely different people and evidence to resolve.
 *
 * The distinction earns its place on one question a consumer could not ask
 * before: "everything I can fix from evidence already in the repository".
 * That is a markup pass, and it is a different sitting from chasing a
 * redirect on someone else's website or writing a lesson nobody has drafted.
 * Reported in one list, the three crowd each other out, and a list that
 * cannot be acted on in one sitting stops being acted on at all.
 */

/** @typedef {"defect"|"stale"|"unwritten"} Category */

/**
 * Every category, with what it means for the person reading the report.
 *
 * @type {Readonly<Record<Category, string>>}
 */
export const CATEGORIES = Object.freeze({
  defect:
    "Wrong now, and fixable from evidence already in the repository. A " +
    "markup or content pass, needing nobody's permission and no external " +
    "lookup.",
  stale:
    "Was right when it was written and has aged out. The evidence for the " +
    "repair is outside the repository, so it needs a look rather than an " +
    "edit, and it should not stop a build on its own.",
  unwritten:
    "Never finished. A placeholder, a template value, or a note where prose " +
    "was meant to go. This needs an author on a course-development " +
    "schedule, not an editor, and reporting it beside a broken code block " +
    "is how a list stops being actionable.",
});

/** The category names, for validation and for the command line. */
export const CATEGORY_NAMES = Object.freeze(
  /** @type {Category[]} */ (Object.keys(CATEGORIES)),
);

/**
 * True when a value names a category.
 *
 * @param {string} value
 */
export function isCategory(value) {
  return Object.hasOwn(CATEGORIES, value);
}
