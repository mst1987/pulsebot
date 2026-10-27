// A signup with a character that is not in the profile yet (#907): the web
// dialog asks class -> spec -> name, like the bot's name modal
// (commands/signup/eventButton.js onName), and the character goes into the
// profile of the raid's game version before the signup is saved.
//
// Checked: the spec exists in the raid's version (Forever plays the Classic
// classes), and a name already in the profile with another class is refused -
// the same character keeps its class, a new spec of it is added.
const profiles = require("../../stores/raiderProfileStore");
const { spec: specOf } = require("../../config/gameVersions");
const { versionOfEvent } = require("../events/mainVersion");

/**
 * Add the character `{ name, spec }` to the user's profile for the event's version.
 * @param {object} event
 * @param {string} userId
 * @param {{ name?: string, spec?: string }} input
 * @param {{ accountName?: string }} [opts] the account's display name (a profile created here)
 * @returns {{ character: string, spec: string } | { code: string, error: string }}
 */
function addSignupCharacter(event, userId, input = {}, { accountName = "" } = {}) {
    const name = String((input && input.name) || "").trim();
    const specKey = String((input && input.spec) || "").trim();
    const versionId = versionOfEvent(event);
    const info = profiles.specInfo(specKey);
    if (!info || !specOf(specKey, versionId)) return { code: "spec", error: "Bitte eine Spezialisierung wählen." };
    if (!name) return { code: "character", error: "Bitte einen Namen angeben." };
    const profile = profiles.getProfile(userId) || { characters: [] };
    const existing = profiles.findCharacter(profile, name, versionId);
    if (existing && existing.className !== info.classId) {
        return { code: "character", error: `${existing.name} steht schon mit einer anderen Klasse in deinem Profil – wähle einen anderen Namen.` };
    }
    const added = profiles.addCharacter(userId, {
        name,
        className: info.classId,
        specs: [{ key: info.key, gear: "usable" }],
        source: "manual",
    }, { name: accountName, versionId });
    if (added.error) return { code: "character", error: added.error };
    return { character: added.character.name, spec: info.key };
}

module.exports = { addSignupCharacter };
