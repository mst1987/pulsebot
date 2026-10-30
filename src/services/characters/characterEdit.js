// Editing a character of a raider profile — the raider's own ("Mein Profil" ›
// Bearbeiten) and the orga's (the profile page's "Alle Charaktere"): name,
// realm, class and specs (raiderProfileStore.editCharacter).
//
// A new name is mostly a name that was never a real character ("Gentle" or
// "Brando" for a druid or shaman, a Discord name taken over). So everything
// that hangs on this raider's character follows the new name, also backwards:
//   - the rosters that list it (and with them the per-category assignment,
//     raiderCharactersStore is a facade over them), closed ones too,
//   - the categories still in raider-characters.json,
//   - his signups that name it — of the character's game version, past raids too,
//   - his pending guild bank requests for it,
//   - his attendance entries ("dabei mit …").
// What other people recorded under that name stays as it is: logs, loot,
// saved setups, the orga's notes keyed by name (council, hidden roster lines).
// Those never knew the bogus name in the first place, or are history.
const profiles = require("../../stores/roster/raiderProfileStore");
const rosterStore = require("../../stores/roster/rosterStore");
const raiderCharactersStore = require("../../stores/roster/raiderCharactersStore");
const signupStore = require("../../stores/events/signupStore");
const guildBankStore = require("../../stores/loot/guildBankStore");
const availabilityStore = require("../../stores/events/availabilityStore");
const { nameKeyOf } = require("../../utils/loot/lootImport");
const { versionOfEvent } = require("../versions/mainVersion");
const logger = require("../../logger").child("characterEdit");

/**
 * Move what hangs on a renamed character of `userId` to its new name (see the
 * head comment). `renamed` is editCharacter's: { fromKey, toKey, toName, versionId }.
 * @returns {{ rosters: number, assignments: number, signups: number, guildBank: number, availability: number }}
 */
function followRename(userId, renamed, { realm = "", actor = "" } = {}) {
    const { fromKey, toKey, toName, versionId } = renamed;
    const nameKey = nameKeyOf(fromKey);
    return {
        rosters: rosterStore.renameMemberChar(userId, fromKey, toKey, toName, { actor }),
        assignments: raiderCharactersStore.renameUserCharacter(userId, fromKey, toName),
        signups: signupStore.renameCharacter(userId, nameKey, toName, { keep: (eventId) => versionOfEvent({ id: eventId }) === versionId }).length,
        guildBank: guildBankStore.renameRecipient(userId, nameKey, { characterName: toName, realm }),
        availability: availabilityStore.renameCharacter(userId, nameKey, toName, { versionId }),
    };
}

/**
 * Edit one character of `userId`'s profile and, for a new name, move what
 * hangs on the old one. `actor` is who did it (the raider or the orga), for the
 * rosters' history and the log.
 * @returns {{ profile, character, renamed, moved } | { error: string, code: string }}
 */
function editProfileCharacter(userId, key, data = {}, { actor = "" } = {}) {
    const res = profiles.editCharacter(userId, key, data);
    if (res.error) return res;
    const moved = res.renamed ? followRename(userId, res.renamed, { realm: res.character ? res.character.realm : "", actor }) : null;
    if (res.renamed) {
        logger.info(`${res.renamed.fromName} → ${res.renamed.toName} (Konto ${userId}${actor && actor !== userId ? `, von ${actor}` : ""}): ${JSON.stringify(moved)}`);
    }
    return { ...res, moved };
}

module.exports = { editProfileCharacter, followRename };
