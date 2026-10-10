// /anwesenheit — your own attendance over the last raids of each category (#265).
// Other raiders' attendance is /anwesenheit-raider, a command of its own so the
// two can carry different access: everyone may look at themselves, looking at
// others is the raid lead's business.
//
// Attendance counts within one game version (#740): the version of the channel's
// category (a thread: its channel's), else the main version - in a channel of a
// Forever category only Forever raids count. The optional `version` option picks
// another one.
const { SlashCommandBuilder } = require("discord.js");
const { myCharacters } = require("../../services/characters/userCharacters");
const { characterAttendance, overall, attendanceFields } = require("../../services/characters/attendanceLookup");
const { buildAttendanceContext } = require("../../services/characters/rosterAttendance");
const { mainVersionFor, knownVersion } = require("../../services/events/mainVersion");
const { VERSIONS, rulesFor } = require("../../config/gameVersions");
const { eventGuildId } = require("../../services/discord/guildRoles");
const { webUrl, lookupReply } = require("../../utils/discord/botLookup");

/** The game version a lookup counts: the picked `version` option, else the channel's category's, else the main version. */
function versionOfInteraction(interaction) {
    const picked = interaction && interaction.options && typeof interaction.options.getString === "function"
        ? knownVersion(interaction.options.getString("version"))
        : "";
    if (picked) return picked;
    const channel = interaction && interaction.channel;
    const inThread = channel && typeof channel.isThread === "function" && channel.isThread();
    const holder = inThread ? channel.parent : channel;
    const categoryId = (holder && (holder.parentId || (holder.parent && holder.parent.id))) || "";
    return mainVersionFor({ categoryId: String(categoryId) });
}

/** The `version` option both attendance commands carry: every rule set, by its short name. */
function addVersionOption(builder) {
    return builder.addStringOption((o) => o
        .setName("version")
        .setDescription("Spielversion (sonst die der Kategorie dieses Kanals)")
        .setRequired(false)
        .addChoices(...VERSIONS.map((v) => ({ name: v.short || v.label || v.id, value: v.id }))));
}

/** " · TBC": the version a reply counted, for its title. */
function versionSuffix(versionId) {
    const rules = rulesFor(versionId);
    return rules ? ` · ${rules.short || rules.label || versionId}` : "";
}

/** The reply for one or more characters: the overall number large, the categories below. */
function attendanceReply(interaction, title, results, links) {
    const categories = results.flatMap((r) => r.categories.map((c) => (results.length > 1 ? { ...c, name: `${r.character} · ${c.name}` } : c)));
    if (!categories.length) {
        return lookupReply(interaction, {
            title,
            description: "Noch keine Raids gezählt — weder eine Zuordnung zu einer Raid-Kategorie noch Loot gefunden.",
        }, links);
    }
    const all = overall(categories);
    return lookupReply(interaction, {
        title,
        description: all.total ? `**${all.pct} %** · ${all.attended} von ${all.total} Raids` : "Noch keine Raids gezählt.",
        fields: attendanceFields(categories),
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
    addVersionOption,
    versionSuffix,
    async execute(interaction) {
        const chars = myCharacters(interaction.user.id);
        if (!chars.length) {
            return lookupReply(interaction, {
                title: "Deine Anwesenheit",
                description: "Dir ist noch kein Charakter zugeordnet. Trag ihn in deinem Profil ein (`/profil`).",
            }, [{ label: "Im Web öffnen", url: webUrl("/roster") }]);
        }
        const guildId = eventGuildId();
        const versionId = versionOfInteraction(interaction);
        const ctx = buildAttendanceContext(guildId, { versionId });
        const results = chars.map((c) => characterAttendance(guildId, c.character, { ctx, versionId }));
        const links = chars.slice(0, 5).map((c) => ({
            label: chars.length > 1 ? c.character : "Im Web öffnen",
            url: webUrl(`/roster/char?name=${encodeURIComponent(c.character)}`),
        }));
        return attendanceReply(interaction, `Deine Anwesenheit${versionSuffix(versionId)}`, results, links);
    },
};
