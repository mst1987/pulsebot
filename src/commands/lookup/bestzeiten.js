// /bestzeiten [dungeon] — the guild's dungeon best times from the LevelHelper
// addon (services/dungeons/dungeonBoard.js, the same tables as the web page
// "Dungeon-Bestzeiten"): with a dungeon its five fastest group runs, without
// one the top players by medals. An ephemeral card in the reader's language,
// for the game version of the command (commandVersion.js: the `version`
// choice, else the channel's category, else the main version). While the
// feature "dungeonTimes" is off for that version (versionCapabilities.js,
// Einstellungen → Spielversion) only a short ephemeral hint, and the
// autocomplete offers nothing.
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { dungeonBoard, dungeonNames } = require("../../services/dungeons/dungeonBoard");
const { dungeonCard, overallCard } = require("../../services/dungeons/dungeonCards");
const { addVersionOption, versionOfCommand } = require("../../services/versions/commandVersion");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { respondChoices } = require("../../utils/discord/botLookup");
const { featureState } = require("../../services/versions/versionCapabilities");
const { versionLabel } = require("../../services/versions/versionSettings");
const { tr } = require("../../utils/i18n/botText");

const DUNGEON_OPTION = "dungeon";

/** The dungeon table of a typed or picked name (exact, else the first that contains it), or null. */
function findDungeon(tables, typed) {
    const q = String(typed || "").trim().toLowerCase();
    if (!q) return null;
    return tables.find((d) => d.dungeon.toLowerCase() === q) || tables.find((d) => d.dungeon.toLowerCase().includes(q)) || null;
}

/** The ephemeral hint while the dungeon best times are off for the version: switched off, or none for its client. */
function offReply(lang, versionId, state) {
    const version = versionLabel(versionId);
    const content = state.reason === "disabled"
        ? tr(lang, "Dungeon best times are switched off for {version}.", { version })
        : tr(lang, "There are no dungeon best times for {version}.", { version });
    return { content, flags: MessageFlags.Ephemeral };
}

module.exports = {
    name: "bestzeiten",
    description: "Dungeon-Bestzeiten der Gilde: die schnellsten Gruppenläufe je Dungeon oder die Gesamtwertung.",
    group: "raids",
    defaultAccess: "everyone",
    data: addVersionOption(new SlashCommandBuilder()
        .setName("bestzeiten")
        .setDescription("The guild's dungeon best times: fastest group runs or the overall ranking")
        .setDescriptionLocalizations({ de: "Dungeon-Bestzeiten der Gilde: schnellste Gruppenläufe oder die Gesamtwertung" })
        .addStringOption((o) => o.setName(DUNGEON_OPTION)
            .setDescription("Dungeon (empty: the overall ranking)")
            .setDescriptionLocalizations({ de: "Dungeon (leer: die Gesamtwertung)" })
            .setAutocomplete(true))),
    findDungeon,
    async execute(interaction) {
        const lang = langOfInteraction(interaction);
        const { versionId } = versionOfCommand(interaction);
        const state = featureState(versionId, "dungeonTimes");
        if (!state.on) return interaction.reply(offReply(lang, versionId, state));
        const board = dungeonBoard(versionId);
        const typed = interaction.options.getString(DUNGEON_OPTION);
        if (String(typed || "").trim()) {
            const table = findDungeon(board.dungeons, typed);
            return interaction.reply(dungeonCard(lang, { versionId, dungeon: typed, table }));
        }
        return interaction.reply(overallCard(lang, { versionId, players: board.players, dungeons: board.dungeons.length }));
    },
    async autocomplete(interaction) {
        const { versionId } = versionOfCommand(interaction);
        if (!featureState(versionId, "dungeonTimes").on) return respondChoices(interaction, []);
        return respondChoices(interaction, dungeonNames(versionId).map((name) => ({ name, value: name })));
    },
};
