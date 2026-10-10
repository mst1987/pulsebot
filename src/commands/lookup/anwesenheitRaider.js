// /anwesenheit-raider <Name> — one raider's attendance, for the raid lead (#265).
const { SlashCommandBuilder } = require("discord.js");
const { characterAttendance, knownCharacterNames } = require("../../services/characters/attendanceLookup");
const { eventGuildId } = require("../../services/discord/guildRoles");
const { webUrl, respondChoices, clip } = require("../../utils/discord/botLookup");
const { addVersionOption } = require("../../services/events/commandVersion");
const { attendanceReply, versionOfInteraction } = require("./anwesenheit");

module.exports = {
    name: "anwesenheit-raider",
    description: "Anwesenheit eines Raiders in den letzten Raids je Raid-Kategorie.",
    group: "raids",
    defaultAccess: "admins",
    data: addVersionOption(new SlashCommandBuilder()
        .setName("anwesenheit-raider")
        .setDescription("Anwesenheit eines Raiders in den letzten Raids")
        .addStringOption((o) => o.setName("raider").setDescription("Charaktername").setRequired(true).setAutocomplete(true))),
    async execute(interaction) {
        const name = String(interaction.options.getString("raider") || "").trim();
        // within one version (#740): the picked one, else the channel's category's
        const versionId = versionOfInteraction(interaction);
        const result = characterAttendance(eventGuildId(), name, { versionId });
        const title = clip(result.character || name || "Raider", 100);
        const links = [{ label: "Im Web öffnen", url: webUrl(`/roster/char?name=${encodeURIComponent(result.character || name)}`) }];
        return attendanceReply(interaction, `Anwesenheit ${title}`, [result], links, versionId);
    },
    async autocomplete(interaction) {
        return respondChoices(interaction, knownCharacterNames().map((name) => ({ name, value: name })));
    },
};
