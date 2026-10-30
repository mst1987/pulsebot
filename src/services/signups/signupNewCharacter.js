// A signup with a character that is not in the profile yet (#907): the web
// dialog asks class -> spec -> name, like the bot's name modal
// (commands/signup/eventButton.js onName), and the character goes into the
// profile of the raid's game version - but only once the signup itself is
// accepted: planSignupCharacter() checks it and hands back the profile as it
// would be with the character (to validate the signup against),
// addSignupCharacter() writes it. A refused signup leaves the profile as it was.
//
// Checked: the spec exists in the raid's version (Forever plays the Classic
// classes), and a name already in the profile with another class is refused -
// the same character keeps its class, a new spec of it is added.
const profiles = require("../../stores/roster/raiderProfileStore");
const { spec: specOf } = require("../../config/gameVersions");
const { versionOfEvent } = require("../versions/mainVersion");
const { validateCharacterName } = require("../../utils/signup/characterNames");
const { splitPlayer } = require("../../utils/loot/lootImport");

/**
 * Check the character `{ name, spec }` for the event's version without saving it.
 * `profile` is the user's profile as it would be with the character in it.
 * @returns {{ character: string, spec: string, profile: object } | { code: string, error: string }}
 */
function planSignupCharacter(event, userId, input = {}) {
    const name = String((input && input.name) || "").trim();
    const specKey = String((input && input.spec) || "").trim();
    const versionId = versionOfEvent(event);
    const info = profiles.specInfo(specKey);
    if (!info || !specOf(specKey, versionId)) return { code: "spec", error: "Bitte eine Spezialisierung wählen." };
    if (!name) return { code: "character", error: "Bitte einen Namen angeben." };
    const uid = String(userId || "").trim();
    const profile = profiles.getProfile(uid) || profiles.normalizeProfile({}, uid);
    const spec = { key: info.key, gear: "usable" };
    const existing = profiles.findCharacter(profile, name, versionId);
    if (existing) {
        if (existing.className !== info.classId) {
            return { code: "character", error: `${existing.name} steht schon mit einer anderen Klasse in deinem Profil – wähle einen anderen Namen.` };
        }
        const characters = profile.characters.map((c) => (c.key !== existing.key || c.specs.some((s) => s.key === info.key)
            ? c : { ...c, specs: [...c.specs, spec] }));
        return { character: existing.name, spec: info.key, profile: profiles.normalizeProfile({ ...profile, characters }, uid) };
    }
    const checked = validateCharacterName(splitPlayer(name).character, { versionId });
    if (checked.error) return { code: "character", error: checked.error };
    if (profiles.charactersOfVersion(profile, versionId).length >= profiles.MAX_CHARACTERS) {
        return { code: "character", error: `Höchstens ${profiles.MAX_CHARACTERS} Charaktere je Spielversion.` };
    }
    const character = { name: checked.name, className: info.classId, versionId, specs: [spec], source: "manual" };
    return {
        character: checked.name,
        spec: info.key,
        profile: profiles.normalizeProfile({ ...profile, characters: [...profile.characters, character] }, uid),
    };
}

/**
 * Add the character `{ name, spec }` to the user's profile for the event's version.
 * @param {object} event
 * @param {string} userId
 * @param {{ name?: string, spec?: string }} input
 * @param {{ accountName?: string }} [opts] the account's display name (a profile created here)
 * @returns {{ character: string, spec: string } | { code: string, error: string }}
 */
function addSignupCharacter(event, userId, input = {}, { accountName = "" } = {}) {
    const plan = planSignupCharacter(event, userId, input);
    if (plan.error) return plan;
    const added = profiles.addCharacter(userId, {
        name: plan.character,
        className: profiles.specInfo(plan.spec).classId,
        specs: [{ key: plan.spec, gear: "usable" }],
        source: "manual",
    }, { name: accountName, versionId: versionOfEvent(event) });
    if (added.error) return { code: "character", error: added.error };
    return { character: added.character.name, spec: plan.spec };
}

module.exports = { planSignupCharacter, addSignupCharacter };
