// Several own characters per signup (#293) — the pure part, shared by the store,
// the service, the adapter and the bot without pulling in any I/O.
//
// signup.characters = [{ character, spec, role, status? }] in priority order:
// the first entry is the preferred character, the others "kann auch mit". The
// top-level character/spec/role/status of a signup always mirror characters[0],
// so every reader that knows only one character keeps working.
//
// `status` per character (the Discord buttons): "Spät" on an existing signup
// moves only the first character to late, the others keep theirs. A character
// without its own status has the signup's; an absence carries none — signing
// off is for the person, not per character. The person still takes at most one
// seat: counting and the setup read the top-level status (= the first's).

// How many own characters one signup may name (preferred + alternates): at
// most MAX_CHARACTERS anywhere (the store's structural guard and the upper end
// of the setting), per raid category as configured in
// `config.categorySignupCharacters` ({ [categoryId]: 1..8 }, Einstellungen ›
// Kategorien › Anmelde-Nachricht) — a category without an entry allows
// DEFAULT_MAX_CHARACTERS. maxCharactersFor() is the one resolver every path
// asks (service, Discord selects, web dialog).
const MAX_CHARACTERS = 8;
const MIN_CHARACTERS = 1;
const DEFAULT_MAX_CHARACTERS = 8;

// attendance.js' SIGNUP_STATUSES without the absence (kept here, so this stays free of requires).
const CHARACTER_STATUSES = ["signed", "tentative", "late", "bench"];

/** A status a single character can have: every signup status except the absence ("" otherwise). */
const characterStatus = (status) => (CHARACTER_STATUSES.includes(status) ? status : "");

/**
 * A stored signup in the current shape: without `characters` (stored before
 * #293) the single character becomes characters[0]; every character gets a
 * status (its own, else the signup's) unless the signup is an absence; the
 * top-level fields always mirror the first entry.
 */
function migrateSignup(signup) {
    if (!signup || typeof signup !== "object") return signup;
    const absent = signup.status === "absence";
    const fallback = characterStatus(String(signup.status || "signed")) || "signed";
    const shape = (c) => {
        const out = { character: String(c.character || ""), spec: String(c.spec), role: String(c.role || "") };
        if (!absent) out.status = characterStatus(c.status) || fallback;
        return out;
    };
    let characters = Array.isArray(signup.characters) ? signup.characters.filter((c) => c && c.spec).map(shape) : null;
    if (!characters || (!characters.length && signup.spec)) {
        characters = signup.spec ? [shape({ character: signup.character, spec: signup.spec, role: signup.role })] : [];
    }
    const first = characters[0];
    if (!first) return { ...signup, characters };
    const out = { ...signup, character: first.character, spec: first.spec, role: first.role, characters };
    if (!absent) out.status = first.status;
    return out;
}

/** A whole number within MIN_CHARACTERS..MAX_CHARACTERS, or null for anything that is no number. */
function clampMaxCharacters(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return null;
    return Math.min(MAX_CHARACTERS, Math.max(MIN_CHARACTERS, n));
}

/**
 * Normalise config.categorySignupCharacters to `{ [categoryId]: 1..7 }` — the
 * default (8) is not stored, anything that is no number drops out, a number out
 * of range is clamped. `{ keepDefault: true }` (a settings patch) keeps the 8,
 * so the merge in configStore can set a category back to the default.
 */
function normalizeCategorySignupCharacters(raw, { keepDefault = false } = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [catId, value] of Object.entries(raw)) {
        const key = String(catId).trim();
        const n = clampMaxCharacters(value);
        if (!key || n === null || (!keepDefault && n === DEFAULT_MAX_CHARACTERS)) continue;
        out[key] = n;
    }
    return out;
}

/**
 * How many own characters one signup may name in a raid: its category's
 * setting, else DEFAULT_MAX_CHARACTERS. `target` is an event (its `categoryId`)
 * or a category id; `config` is the settings store's (callers hand it in, so
 * this module stays free of I/O — signupService.maxCharactersFor reads it for them).
 */
function maxCharactersFor(target, config) {
    const categoryId = target && typeof target === "object" ? target.categoryId : target;
    const cfg = config && typeof config === "object" ? config : {};
    const map = cfg.categorySignupCharacters && typeof cfg.categorySignupCharacters === "object" ? cfg.categorySignupCharacters : {};
    const n = clampMaxCharacters(map[String(categoryId || "").trim()]);
    return n === null ? DEFAULT_MAX_CHARACTERS : n;
}

const nameKeyOf = (name) => String(name || "").trim().toLowerCase();

/**
 * Whether a requested character list goes over the limit. Up to `max`
 * characters (the same name twice counts once) always pass. More only pass when
 * every one of them is already on the stored signup: a signup made before its
 * category's limit dropped keeps its characters and may lose some, but never
 * gains one beyond the limit — nothing is cut silently.
 * @param {{ character: string }[]} entries  the requested characters
 * @param {object|null} previous             the stored signup (any shape)
 * @param {number} max                       maxCharactersFor() of the raid
 */
function exceedsCharacterLimit(entries, previous, max) {
    const list = (entries || []).filter(Boolean);
    const keys = new Set(list.map((e) => nameKeyOf(e.character)).filter(Boolean));
    const count = keys.size + list.filter((e) => !nameKeyOf(e.character)).length;
    if (count <= max) return false;
    const prev = previous ? migrateSignup(previous) : null;
    if (!prev || count > keys.size) return true;
    const had = new Set((prev.characters || []).map((c) => nameKeyOf(c.character)));
    return [...keys].some((k) => !had.has(k));
}

/**
 * How many characters a picker may offer to choose for a raid: the category's
 * limit — or, for a signup stored before the limit dropped, as many as it
 * already has, so picking the same characters again still works (a new one
 * beyond the limit is refused on save).
 */
function pickLimitFor(target, previous, config) {
    const prev = previous ? migrateSignup(previous) : null;
    const had = prev ? (prev.characters || []).length : 0;
    return Math.min(MAX_CHARACTERS, Math.max(maxCharactersFor(target, config), had));
}

/** The refusal, naming the limit (German; botEnglish translates it for the bot). */
const characterLimitError = (max) => `Höchstens ${max} Charaktere je Anmeldung in dieser Kategorie.`;

module.exports = {
    MAX_CHARACTERS, MIN_CHARACTERS, DEFAULT_MAX_CHARACTERS, CHARACTER_STATUSES, characterStatus, migrateSignup,
    clampMaxCharacters, normalizeCategorySignupCharacters, maxCharactersFor, pickLimitFor, exceedsCharacterLimit, characterLimitError,
};
