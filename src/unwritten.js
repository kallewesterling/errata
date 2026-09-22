/**
 * Detection of content nobody has written yet.
 *
 * These are not defects in the sense the rest of the checks mean it. Nothing
 * here is wrong; something here is missing, and no amount of reading the
 * repository will supply it. They are worth reporting because a half-drafted
 * lesson is invisible once it ships, and worth reporting *apart* because the
 * person who can fix one is an author on a course-development schedule rather
 * than whoever is doing a markup pass this afternoon.
 *
 * Each rule is shaped to what an unfinished draft actually looks like, not to
 * any one project's wording, so the patterns describe the scaffolding rather
 * than listing the words this content happens to use.
 */

/**
 * A body that is a note to the author rather than a lesson.
 *
 * Bounded by length as well as by wording, so a lesson that happens to open
 * with the word "Placeholder" while going on to say something is not caught.
 */
const STUB_TEXT = /^(?:placeholder|tbd|todo|coming soon|lorem ipsum)\b/i;

/** Longest a body can be and still be a stub rather than a short lesson. */
const STUB_LIMIT = 40;

/**
 * An element whose entire content is an HTML comment.
 *
 * This is the shape of a section an author marked out and never filled in.
 * The browser renders nothing, so the gap is invisible to everyone except
 * whoever opens the source.
 *
 * In the content this was written against it finds fourteen: five are an
 * empty `<p><!-- Lead --></p>`, and the other nine are notes about an image,
 * some links, or a joke the author meant to come back to.
 */
const COMMENT_ONLY = /<(p|li|h[1-6]|div)\b[^>]*>\s*(<!--[\s\S]*?-->)\s*<\/\1>/gi;

/**
 * A metadata value that is still its own template.
 *
 * `{Short description}` is a token a scaffolding tool left behind, and the
 * braces are the giveaway rather than the words inside them. Matching the
 * shape means the rule works for whatever template produced the content.
 *
 * What is inside has to look like a human phrase: letters, digits, spaces and
 * light punctuation. Braces alone are not enough, because a metadata field
 * holding serialized JSON is also a string that opens and closes with one,
 * and `{"k": 1}` is a real value rather than an unfilled blank.
 */
const TEMPLATE_VALUE = /^\{[A-Za-z][\w .-]*\}$/;

/**
 * @typedef {object} Unwritten
 * @property {"stub-body"|"comment-only"|"template-value"} rule
 * @property {string} what   Why it reads as unfinished.
 * @property {string} match  The text that showed it, shortened.
 * @property {number} ordinal
 */

/** Shorten a match to something that fits on a report line. */
const shorten = (text) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 70 ? `${flat.slice(0, 70)}...` : flat;
};

/**
 * Unfinished scaffolding in one lesson body.
 *
 * @param {string} html        The file contents.
 * @param {string} visible     The text a reader sees, already extracted.
 * @returns {Unwritten[]}
 */
export function findUnwritten(html, visible) {
  const found = [];
  const text = visible.trim();

  if (text.length < STUB_LIMIT && STUB_TEXT.test(text)) {
    found.push({
      rule: /** @type {const} */ ("stub-body"),
      what: "the whole lesson body is a placeholder",
      match: shorten(text),
      ordinal: found.length,
    });
  }

  for (const match of html.matchAll(COMMENT_ONLY)) {
    found.push({
      rule: /** @type {const} */ ("comment-only"),
      what: "an element holding only a comment, where prose was meant to go",
      match: shorten(match[2]),
      ordinal: found.length,
    });
  }

  return found;
}

/**
 * Every string in a parsed JSON document that is still a template token.
 *
 * Walks the whole document rather than named fields, because which key holds
 * the description is a property of one content repository and this is not.
 *
 * @param {unknown} value
 * @param {string[]} path
 * @returns {{path: string, value: string}[]}
 */
export function findTemplateValues(value, path = []) {
  if (typeof value === "string") {
    return TEMPLATE_VALUE.test(value.trim())
      ? [{ path: path.join("."), value: value.trim() }]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findTemplateValues(item, [...path, String(index)]),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      findTemplateValues(item, [...path, key]),
    );
  }
  return [];
}
