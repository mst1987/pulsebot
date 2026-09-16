// "Mein Profil" (#255): the raider's self-service page, area `signup`.
//
// Every member-facing handler works on `user.id` from the session and nothing
// else — no request parameter can name another account. The orga reads other
// profiles through GET /api/profile/user (area `roster`), and the list of
// characters claimed by more than one account through
// GET /api/roster/character-claims.
const { ok, error: apiError } = require("../apiResponse");
const { requireAdmin, requireCsrf } = require("../apiMiddleware");
const { readJsonBody } = require("../apiBody");
const profiles = require("../raiderProfileStore");
const { logIndex, logSuggestions } = require("../profileLogs");
const { profileView, lookupArmory } = require("../profileView");
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
        limits: { characters: profiles.MAX_CHARACTERS, wishes: profiles.MAX_WISHES, note: profiles.MAX_NOTE },
    };
}

/** The caller's own profile in its member shape. */
function ownView(user) {
    const profile = profiles.getProfile(user.id);
    return profileView({ ...profile, name: profile.name || user.name || "" });
}

/** GET /api/profile — the caller's own profile plus the page context. */
async function getProfile(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    ok(res, { profile: ownView(user), isNew: !profiles.hasProfile(user.id), ...pageContext() });
}

/**
 * PUT /api/profile — save the caller's own edits (switches, availability,
 * raids, wishes, note, specs/gear/main of existing characters). The body never
 * names an account: whatever `userId` it carries is ignored.
 */
async function putProfile(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);
    const patch = {};
    for (const key of ["canOfftank", "canHeal", "availability", "preferredRaids", "wishes", "note", "characters"]) {
        if (body[key] !== undefined) patch[key] = body[key];
    }
    // A wish only for someone who has a profile — an id nobody can resolve is a typo.
    if (Array.isArray(patch.wishes)) {
        const known = new Set(profiles.listProfiles().map((p) => p.userId));
        patch.wishes = patch.wishes.map(String).filter((id) => known.has(id));
    }
    profiles.saveProfile(user.id, patch, { name: user.name });
    ok(res, { profile: ownView(user) });
}

/** GET /api/profile/log-characters?q= — characters from the logs the caller could take over. */
async function getLogCharacters(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const q = String(url.searchParams.get("q") || "").slice(0, 32);
    ok(res, { characters: logSuggestions(user, { query: q }) });
}

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
async function postProfileCharacter(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    if (!requireCsrf(req, res)) return;
    const body = await readJsonBody(req);

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
}

/** GET /api/profile/raiders?q= — raiders with a profile, names only, for the wish picker. */
async function getRaiderSearch(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const q = String(url.searchParams.get("q") || "").slice(0, 32);
    ok(res, { raiders: profiles.searchRaiders(q, user.id) });
}

/** GET /api/profile/user?id= — one raider's profile for the orga, read-only, with wishes. */
async function getUserProfile(req, res, url) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const id = String(url.searchParams.get("id") || "").trim();
    if (!id || !profiles.hasProfile(id)) return apiError(res, 404, "not_found", "Kein Profil für dieses Konto.");
    ok(res, { profile: profileView(profiles.getProfile(id), { forOrga: true }) });
}

/** GET /api/roster/character-claims — characters more than one account has added. */
async function getCharacterClaims(req, res) {
    const user = requireAdmin(req, res);
    if (!user) return;
    ok(res, { claims: profiles.characterClaims() });
}

module.exports = {
    getProfile, putProfile, getLogCharacters, postProfileCharacter, getRaiderSearch, getUserProfile, getCharacterClaims,
    pageContext,
};
