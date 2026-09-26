// "Mein Profil" (#255): the raider's self-service page, area `signup`.
//
// Every member-facing handler works on `user.id` from the session and nothing
// else — no request parameter can name another account. The orga reads other
// profiles through GET /api/profile/user (area `roster`), and the list of
// characters claimed by more than one account through
// GET /api/roster/character-claims.
const { ok, error: apiError } = require("../http/apiResponse");
const { withUser } = require("../http/apiHandler");
const profiles = require("../../stores/raiderProfileStore");
const specHistory = require("../../stores/specHistoryStore");
const { logIndex, logSuggestions } = require("../characters/profileLogs");
const { profileView, lookupArmory } = require("../characters/profileView");
const calendarTokens = require("../../stores/calendarTokenStore");
const calendarFeed = require("../pages/calendarFeed");
const { userIcsUrl } = require("../../services/events/icsFeed");
const { rulesFor, DEFAULT_VERSION, VERSIONS } = require("../../config/gameVersions");
const { ROLE_LABELS } = require("../../config/gameVersions/classes");

const WEEKDAY_LABELS = { mo: "Mo", di: "Di", mi: "Mi", do: "Do", fr: "Fr", sa: "Sa", so: "So" };
const GEAR_LABELS = { none: "keins", usable: "brauchbar", ready: "raidbereit" };

/** What the page needs besides the profile: classes, raids, labels. Static. */
function pageContext() {
    const rules = rulesFor(DEFAULT_VERSION);
    return {
        classes: rules.classes,
        roles: ROLE_LABELS,
        // The instances of every version, grouped, so a Classic guild finds its raids too.
        raidGroups: VERSIONS.map((v) => ({
            id: v.id,
            label: v.label,
            instances: v.instances.map((i) => ({ id: i.id, name: i.name, short: i.short, icon: i.icon, status: i.status })),
        })),
        weekdays: profiles.WEEKDAYS.map((id) => ({ id, label: WEEKDAY_LABELS[id] })),
        gearLevels: profiles.GEAR_LEVELS.map((id) => ({ id, label: GEAR_LABELS[id] })),
        limits: { characters: profiles.MAX_CHARACTERS, wishes: profiles.MAX_WISHES, avoid: profiles.MAX_AVOID, note: profiles.MAX_NOTE },
    };
}

/** The caller's own profile in its member shape. */
function ownView(user) {
    const profile = profiles.getProfile(user.id);
    return profileView({ ...profile, name: profile.name || user.name || "" });
}

/** GET /api/profile — the caller's own profile plus the page context. */
const getProfile = withUser({}, async ({ user, res }) => {
    ok(res, {
        profile: ownView(user),
        isNew: !profiles.hasProfile(user.id),
        // #291: the own specs imported from Raid-Helper — "Von Hand" prefills from them.
        specHistory: specHistory.specHistoryOf(user.id).slice(0, 8),
        ...pageContext(),
    });
});

/**
 * PUT /api/profile — save the caller's own edits (availability, raids, wishes,
 * avoid list, note; specs/gear/main/off-tank/heal of existing characters). The
 * profile-wide switches are not taken any more — they live on the characters. The body never
 * names an account: whatever `userId` it carries is ignored.
 */
const putProfile = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    const patch = {};
    for (const key of ["availability", "preferredRaids", "wishes", "avoidEnabled", "avoid", "note", "characters"]) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    // A wish (or an avoid) only for someone who has a profile — an id nobody can resolve is a typo.
    const known = new Set(profiles.listProfiles().map((p) => p.userId));
    for (const key of ["wishes", "avoid"]) {
        if (Array.isArray(patch[key])) patch[key] = patch[key].map(String).filter((id) => known.has(id));
    }
    profiles.saveProfile(user.id, patch, { name: user.name });
    ok(res, { profile: ownView(user) });
});

/** GET /api/profile/log-characters?q= — characters from the logs the caller could take over. */
const getLogCharacters = withUser({}, async ({ user, res, url }) => {
    const q = String(url.searchParams.get("q") || "").slice(0, 32);
    ok(res, { characters: logSuggestions(user, { query: q }) });
});

/**
 * POST /api/profile/characters — add a character to the caller's own profile,
 * or remove one.
 * Body: { remove: key } | { source: "log", name } | { source: "armory", name, realm, className? }
 *     | { source: "manual", name, className, specs: [key] }
 *
 * "Aus den Logs" takes class and spec from the logs, not from the request. A
 * character another account already has is added all the same — the answer
 * carries `claimedBy`, and the orga sees it on the roster.
 */
const postProfileCharacter = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    if (body.remove !== undefined) {
        const removed = profiles.removeCharacter(user.id, String(body.remove || ""));
        return ok(res, { removed, profile: ownView(user) });
    }

    const name = String(body.name || "").trim();
    if (!name) return apiError(res, 400, "bad_request", "Bitte einen Charakternamen angeben.");
    const source = profiles.CHARACTER_SOURCES.includes(body.source) ? body.source : "manual";
    const input = { name, realm: String(body.realm || "").trim(), source, className: body.className, specs: [] };
    let armory = null;

    if (source === "log") {
        const entry = logIndex().get(profiles.characterKey(name));
        if (!entry || !entry.className) return apiError(res, 404, "not_found", "Dieser Charakter taucht in keinem Log auf.");
        input.name = entry.character;
        input.className = entry.className;
        if (entry.specKey) input.specs = [{ key: entry.specKey, gear: "ready" }];
    } else if (source === "armory") {
        armory = await lookupArmory(name, input.realm);
        if (armory.className) input.className = armory.className;
        if (armory.fetched) input.armory = { level: armory.level, guild: armory.guild, fetchedAt: Date.now() };
        if (!profiles.normalizeClass(input.className)) {
            return apiError(res, 422, "class_required", "Die Armory liefert gerade nichts – bitte die Klasse von Hand wählen.");
        }
        input.specs = (Array.isArray(body.specs) ? body.specs : []).map((key) => ({ key, gear: "usable" }));
    } else {
        input.specs = (Array.isArray(body.specs) ? body.specs : []).map((key) => ({ key, gear: "usable" }));
    }

    const result = profiles.addCharacter(user.id, input, { name: user.name });
    if (result.error) return apiError(res, 400, "bad_request", result.error);
    const profile = ownView(user);
    ok(res, {
        character: profile.characters.find((c) => c.key === result.character.key),
        armory: armory && { linked: !!armory.url, fetched: armory.fetched },
        profile,
    });
});

/** GET /api/profile/raiders?q= — raiders with a profile, names only, for the wish picker. */
const getRaiderSearch = withUser({}, async ({ user, res, url }) => {
    const q = String(url.searchParams.get("q") || "").slice(0, 32);
    ok(res, { raiders: profiles.searchRaiders(q, user.id) });
});

/** GET /api/profile/user?id= — one raider's profile for the orga, read-only, with wishes. */
const getUserProfile = withUser({}, async ({ res, url }) => {
    const id = String(url.searchParams.get("id") || "").trim();
    if (!id || !profiles.hasProfile(id)) return apiError(res, 404, "not_found", "Kein Profil für dieses Konto.");
    ok(res, { profile: profileView(profiles.getProfile(id), { forOrga: true }) });
});

/** GET /api/roster/character-claims — characters more than one account has added. */
const getCharacterClaims = withUser({}, async ({ res }) => {
    ok(res, { claims: profiles.characterClaims() });
});

// ---- Kalender-Abo (#312) ----
//
// The subscription link is the raider's own business: minted and revoked here,
// on the session's account, never on another's. The plaintext token exists in
// exactly one response — the POST that created it — and is never stored, so it
// can be read back by nobody, not by the raider and not by an admin.

/** The token rows plus whether a link can be built at all. */
function calendarPayload(userId) {
    const tokens = calendarTokens.listTokensFor(userId).map((t) => ({
        id: t.id, name: t.name, hint: t.hint, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, uses: t.uses,
    }));
    return { tokens, max: calendarTokens.MAX_PER_USER, configured: Boolean(userIcsUrl("x")) };
}

/** GET /api/profile/calendar — the caller's own subscription links, without their secrets. */
const getCalendarTokens = withUser({}, async ({ user, res }) => {
    ok(res, calendarPayload(user.id));
});

/**
 * POST /api/profile/calendar — mint a link, or revoke one with `{ revoke: id }`.
 * The secret comes back exactly once, in `token`/`url`.
 */
const postCalendarToken = withUser({ csrf: true, body: true }, async ({ user, body, res }) => {
    if (body.revoke !== undefined) {
        // The store checks the owner, so a foreign id cannot be revoked even if
        // a caller sends one — it comes back as "not removed", like any other.
        const revoked = calendarTokens.revokeToken(String(body.revoke || ""), user.id);
        calendarFeed.clearCache();
        return ok(res, { revoked, ...calendarPayload(user.id) });
    }

    const made = calendarTokens.createToken(user.id, String(body.name || ""));
    if (made.error) return apiError(res, 400, made.code || "invalid", made.error);
    ok(res, { token: made.token, url: userIcsUrl(made.token), record: made.record, ...calendarPayload(user.id) });
});

/** The routes of this module: the router dispatches on them, apiAccess.js gates on their area (docs/web-admin.md). */
const routes = [
    { method: "GET", path: "/api/roster/character-claims", handler: getCharacterClaims, area: "roster" },
    { method: "GET", path: "/api/profile", handler: getProfile, area: "signup" },
    { method: "PUT", path: "/api/profile", handler: putProfile, area: "signup" },
    { method: "GET", path: "/api/profile/log-characters", handler: getLogCharacters, area: "signup" },
    { method: "POST", path: "/api/profile/characters", handler: postProfileCharacter, area: "signup" },
    { method: "GET", path: "/api/profile/calendar", handler: getCalendarTokens, area: "signup" },
    { method: "POST", path: "/api/profile/calendar", handler: postCalendarToken, area: "signup" },
    { method: "GET", path: "/api/profile/raiders", handler: getRaiderSearch, area: "signup" },
    { method: "GET", path: "/api/profile/user", handler: getUserProfile, area: "roster" },
];

module.exports = {
    getProfile, putProfile, getLogCharacters, postProfileCharacter, getRaiderSearch, getUserProfile, getCharacterClaims,
    getCalendarTokens, postCalendarToken,
    pageContext,
    routes,
};
