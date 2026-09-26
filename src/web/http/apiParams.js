// Small readers for query and body values, so a handler says what it expects
// instead of repeating `String(body.x || "").trim()` and its variants.
//
// `source` is what withUser() hands the handler: the `query` (URLSearchParams)
// or the `body` (a plain object). A missing source, a missing key, null and
// undefined all read as "absent".
const { isSnowflake } = require("../../utils/ids");
const { str: text } = require("../../utils/text");

function raw(source, key) {
    if (!source) return undefined;
    if (typeof source.get === "function") {
        const v = source.get(key);
        return v === null ? undefined : v;
    }
    return source[key];
}

const q = {
    /** Trimmed text, "" when absent; `max` cuts it to that many characters. */
    str(source, key, { max } = {}) {
        const v = text(raw(source, key));
        return max ? v.slice(0, max) : v;
    },

    /** An integer, or `fallback` (null) when absent or not a whole number; clamped into [min, max]. */
    int(source, key, { min, max, fallback = null } = {}) {
        const v = raw(source, key);
        if (v === undefined || v === null || v === "") return fallback;
        const n = Number(v);
        if (!Number.isInteger(n)) return fallback;
        if (min !== undefined && n < min) return min;
        if (max !== undefined && n > max) return max;
        return n;
    },

    /** true for true/"1"/"true", false for false/"0"/"false"/"", else `fallback` (false). */
    bool(source, key, fallback = false) {
        const v = raw(source, key);
        if (v === true || v === 1) return true;
        if (v === false || v === 0) return false;
        if (typeof v === "string") {
            const s = v.trim().toLowerCase();
            if (s === "1" || s === "true") return true;
            if (s === "0" || s === "false" || s === "") return false;
        }
        return fallback;
    },

    /** A Discord id (utils/ids.js isSnowflake), else "". */
    snowflake(source, key) {
        const v = text(raw(source, key));
        return isSnowflake(v) ? v : "";
    },
};

module.exports = { q };
