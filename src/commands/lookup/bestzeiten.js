// /bestzeiten [dungeon] — the guild's dungeon best times from the LevelHelper
// addon (services/dungeons/dungeonBoard.js, the same tables as the web page
// "Dungeon-Bestzeiten"): with a dungeon its five fastest group runs, without
// one the top players by medals. An ephemeral card in the reader's language,
// for the game version of the command (commandVersion.js: the `version`
// choice, else the channel's category, else the main version).
const { SlashCommandBuilder } = require("discord.js");
const { dungeonBoard, dungeonNames } = require("../../services/dungeons/dungeonBoard");
const { dungeonCard, overallCard } = require("../../services/dungeons/dungeonCards");
const { addVersionOption, versionOfCommand } = require("../../services/versions/commandVersion");
const { langOfInteraction } = require("../../services/discord/botLanguage");
const { respondChoices } = require("../../utils/discord/botLookup");

const DUNGEON_OPTION = "dungeon";

/** The dungeon table of a typed or picked name (exact, else the first that contains it), or null. */
function findDungeon(tables, typed) {
    const q = String(typed || "").trim().toLowerCase();
    if (!q) return null;
    return tables.find((d) => d.dungeon.toLowerCase() === q) || tables.find((d) => d.dungeon.toLowerCase().includes(q)) || null;
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
        return respondChoices(interaction, dungeonNames(versionId).map((name) => ({ name, value: name })));
    },
};
