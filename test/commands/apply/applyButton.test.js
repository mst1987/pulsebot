const command = require("../../../src/commands/apply/applyButton.js");
const { CLASSES } = require("../../../src/config/applyClasses.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

describe("commands/apply/applyButton", () => {
    it("exports the handler for the \"apply\" customId", () => {
        expect(command.name).toBe("apply");
        expect(typeof command.description).toBe("string");
        expect(typeof command.execute).toBe("function");
    });

    it("replies with the class-select menu (step 1)", async () => {
        const interaction = mockInteraction();

        await command.execute(interaction);

        expect(interaction.reply).toHaveBeenCalledTimes(1);
        const arg = interaction.reply.mock.calls[0][0];
        expect(arg.content).toContain("Schritt 1");
        expect(arg.ephemeral).toBe(true);
        expect(arg.components).toHaveLength(1);
        // the select carries one option per configured class
        const select = arg.components[0].components[0];
        expect(select.options).toHaveLength(CLASSES.length);
    });

    it("attaches guild emojis to options when a matching emoji exists", async () => {
        const interaction = mockInteraction({
            emojis: [["warrior", { id: "emoji-1", name: "warrior" }]],
        });

        await command.execute(interaction);

        const select = interaction.reply.mock.calls[0][0].components[0].components[0];
        const warriorOption = select.options.find((o) => o.data.value === "warrior");
        expect(warriorOption.data.emoji).toMatchObject({ id: "emoji-1", name: "warrior" });
    });
});
