// Several own characters per signup (#293) — the pure part, shared by the store,
// the service, the adapter and the bot without pulling in any I/O.
//
// signup.characters = [{ character, spec, role }] in priority order: the first
// entry is the preferred character, the others "kann auch mit". The top-level
// character/spec/role of a signup always mirror characters[0], so every reader
// that knows only one character keeps working.

// How many own characters one signup may name (preferred + alternates).
const MAX_CHARACTERS = 3;

/**
 * A stored signup in the current shape: without `characters` (stored before
 * #293) the single character becomes characters[0]; the top-level fields
 * always mirror the first entry.
 */
function migrateSignup(signup) {
    if (!signup || typeof signup !== "object") return signup;
    let characters = Array.isArray(signup.characters)
        ? signup.characters
            .filter((c) => c && c.spec)
            .map((c) => ({ character: String(c.character || ""), spec: String(c.spec), role: String(c.role || "") }))
        : null;
    if (!characters || (!characters.length && signup.spec)) {
        characters = signup.spec
            ? [{ character: String(signup.character || ""), spec: String(signup.spec), role: String(signup.role || "") }]
            : [];
    }
    const first = characters[0];
    return first
        ? { ...signup, character: first.character, spec: first.spec, role: first.role, characters }
        : { ...signup, characters };
}

/** The alternates of a signup ("kann auch mit"): every character after the first. */
function alternatesOf(signup) {
    return (migrateSignup(signup) || { characters: [] }).characters.slice(1);
}

module.exports = { MAX_CHARACTERS, migrateSignup, alternatesOf };
