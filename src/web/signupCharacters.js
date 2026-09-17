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

// How many own characters one signup may name (preferred + alternates).
const MAX_CHARACTERS = 3;

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

/** The alternates of a signup ("kann auch mit"): every character after the first. */
function alternatesOf(signup) {
    return (migrateSignup(signup) || { characters: [] }).characters.slice(1);
}

module.exports = { MAX_CHARACTERS, CHARACTER_STATUSES, characterStatus, migrateSignup, alternatesOf };
