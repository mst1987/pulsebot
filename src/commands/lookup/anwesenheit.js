// /anwesenheit — your own attendance over the last raids of each category (#265).
// Other raiders' attendance is /anwesenheit-raider, a command of its own so the
// two can carry different access: everyone may look at themselves, looking at
// others is the raid lead's business.
const { myCharacters } = require("../../web/userCharacters");
const { characterAttendance, overall, attendanceFields } = require("../../web/attendanceLookup");
const { buildAttendanceContext } = require("../../web/rosterAttendance");
const { eventGuildId } = require("../../web/guildRoles");
const { webUrl, lookupReply } = require("../../utils/botLookup");

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
    attendanceReply,
    async execute(interaction) {
        const chars = myCharacters(interaction.user.id);
        if (!chars.length) {
            return lookupReply(interaction, {
                title: "Deine Anwesenheit",
                description: "Dir ist noch kein Charakter zugeordnet. Trag ihn in deinem Profil ein (`/profil`).",
            }, [{ label: "Im Web öffnen", url: webUrl("/roster") }]);
        }
        const guildId = eventGuildId();
        const ctx = buildAttendanceContext(guildId);
        const results = chars.map((c) => characterAttendance(guildId, c.character, { ctx }));
        const links = chars.slice(0, 5).map((c) => ({
            label: chars.length > 1 ? c.character : "Im Web öffnen",
            url: webUrl(`/roster/char?name=${encodeURIComponent(c.character)}`),
        }));
        return attendanceReply(interaction, "Deine Anwesenheit", results, links);
    },
};
