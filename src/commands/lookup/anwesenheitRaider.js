// /anwesenheit-raider <Name> — one raider's attendance, for the raid lead (#265).
const { SlashCommandBuilder } = require("discord.js");
const { characterAttendance, knownCharacterNames } = require("../../services/characters/attendanceLookup");
const { serverIds } = require("../../services/discord/roles/guildRoles");
const { webUrl, respondChoices, clip } = require("../../utils/discord/botLookup");
const { addVersionOption } = require("../../services/versions/commandVersion");
const { attendanceReply, versionOfInteraction } = require("./anwesenheit");

/** The server the command was used on; in a DM the first server (#919). */
const serverOf = (interaction) => interaction.guildId || serverIds()[0] || "";

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
        const result = characterAttendance(serverOf(interaction), name, { versionId });
        const title = clip(result.character || name || "Raider", 100);
        const links = [{ label: "Im Web öffnen", url: webUrl(`/roster/char?name=${encodeURIComponent(result.character || name)}`) }];
        return attendanceReply(interaction, `Anwesenheit ${title}`, [result], links, versionId);
    },
    async autocomplete(interaction) {
        const names = knownCharacterNames({ versionId: versionOfInteraction(interaction), guildId: serverOf(interaction) });
        return respondChoices(interaction, names.map((name) => ({ name, value: name })));
    },
};
