// /anwesenheit-raider <Name> — one raider's attendance, for the raid lead (#265).
const { characterAttendance, knownCharacterNames } = require("../../web/attendanceLookup");
const { eventGuildId } = require("../../web/guildRoles");
const { webUrl, respondChoices, clip } = require("../../utils/botLookup");
const { attendanceReply } = require("./anwesenheit");

module.exports = {
    name: "anwesenheit-raider",
    description: "Anwesenheit eines Raiders in den letzten Raids je Raid-Kategorie.",
    group: "raids",
    defaultAccess: "admins",
    async execute(interaction) {
        const name = String(interaction.options.getString("raider") || "").trim();
        const result = characterAttendance(eventGuildId(), name);
        const title = clip(result.character || name || "Raider", 100);
        const links = [{ label: "Im Web öffnen", url: webUrl(`/roster/char?name=${encodeURIComponent(result.character || name)}`) }];
        return attendanceReply(interaction, `Anwesenheit ${title}`, [result], links);
    },
    async autocomplete(interaction) {
        return respondChoices(interaction, knownCharacterNames().map((name) => ({ name, value: name })));
    },
};
