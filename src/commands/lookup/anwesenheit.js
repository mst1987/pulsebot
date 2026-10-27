// /anwesenheit — your own attendance over the last raids of each category (#265).
// Other raiders' attendance is /anwesenheit-raider, a command of its own so the
// two can carry different access: everyone may look at themselves, looking at
// others is the raid lead's business.
//
// Attendance counts within one game version (#740): the version of the channel's
// category (a thread: its channel's), else the main version - in a channel of a
// Forever category only Forever raids count. The optional `version` option picks
// another one (services/events/commandVersion.js, shared with the other lookups).
const { SlashCommandBuilder } = require("discord.js");
const { myCharacters } = require("../../services/characters/userCharacters");
const { charactersOfVersion } = require("../../services/characters/characterVersions");
const { listByCharacter } = require("../../stores/lootStore");
const { characterAttendance, overall, attendanceFields } = require("../../services/characters/attendanceLookup");
const { buildAttendanceContext } = require("../../services/characters/rosterAttendance");
const { addVersionOption, versionOfCommand, versionNote } = require("../../services/events/commandVersion");
const { serverIds } = require("../../services/discord/guildRoles");
const { webUrl, lookupReply } = require("../../utils/discord/botLookup");

/** The game version a lookup counts: the picked `version` option, else the channel's category's, else the main version. */
function versionOfInteraction(interaction) {
    return versionOfCommand(interaction).versionId;
}

/**
 * The reply for one or more characters: the overall number large, the categories below; with
 * `versionId` the footer names the version counted, like the other lookups (#743).
 */
function attendanceReply(interaction, title, results, links, versionId = "") {
    const footer = versionId ? { footer: { text: versionNote(versionId) } } : {};
    const categories = results.flatMap((r) => r.categories.map((c) => (results.length > 1 ? { ...c, name: `${r.character} · ${c.name}` } : c)));
    if (!categories.length) {
        return lookupReply(interaction, {
            title,
            description: "Noch keine Raids gezählt — weder eine Zuordnung zu einer Raid-Kategorie noch Loot gefunden.",
            ...footer,
        }, links);
    }
    const all = overall(categories);
    return lookupReply(interaction, {
        title,
        description: all.total ? `**${all.pct} %** · ${all.attended} von ${all.total} Raids` : "Noch keine Raids gezählt.",
        fields: attendanceFields(categories),
        ...footer,
    }, links);
}

module.exports = {
    name: "anwesenheit",
    description: "Deine Anwesenheit in den letzten Raids je Raid-Kategorie.",
    group: "raids",
    defaultAccess: "everyone",
    data: addVersionOption(new SlashCommandBuilder()
        .setName("anwesenheit")
        .setDescription("Deine Anwesenheit in den letzten Raids")),
    attendanceReply,
    versionOfInteraction,
    async execute(interaction) {
        const versionId = versionOfInteraction(interaction);
        // Strictly one version (#741): only the characters that play it count and get a link.
        const chars = charactersOfVersion(myCharacters(interaction.user.id), versionId, { itemsOf: listByCharacter, assigned: true });
        if (!chars.length) {
            return lookupReply(interaction, {
                title: "Deine Anwesenheit",
                description: "Dir ist noch kein Charakter zugeordnet. Trag ihn in deinem Profil ein (`/profil`).",
                footer: { text: versionNote(versionId) },
            }, [{ label: "Im Web öffnen", url: webUrl("/roster") }]);
        }
        const guildId = serverIds()[0] || "";
        const ctx = buildAttendanceContext(guildId, { versionId });
        const results = chars.map((c) => characterAttendance(guildId, c.character, { ctx, versionId }));
        const links = chars.slice(0, 5).map((c) => ({
            label: chars.length > 1 ? c.character : "Im Web öffnen",
            url: webUrl(`/roster/char?name=${encodeURIComponent(c.character)}`),
        }));
        return attendanceReply(interaction, "Deine Anwesenheit", results, links, versionId);
    },
};
