// Small text helpers every store and message builder needs. One place, so the
// validation and the ellipsis rule cannot drift apart between copies.

/** A value as trimmed text; null and undefined become "". */
const str = (v) => String(v === null || v === undefined ? "" : v).trim();

/** Text cut to at most `max` characters, ending in "…" when it was cut. Not trimmed. */
function clip(value, max) {
    const text = String(value === null || value === undefined ? "" : value);
    return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

/** "1 raid" / "3 raids": the count with the matching word. */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

module.exports = { str, clip, plural };
