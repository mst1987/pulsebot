const command = require("../../../src/commands/apply/applySelect.js");
const { pendingApplications } = require("../../../src/utils/applicationState.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

describe("commands/apply/applySelect", () => {
    beforeEach(() => {
        pendingApplications.clear();
    });

    it("exports the handler for the \"apply-class\" customId", () => {
        expect(command.name).toBe("apply-class");
        expect(typeof command.description).toBe("string");
        expect(typeof command.execute).toBe("function");
    });

    it("stores the chosen class and updates to the spec-select (step 2)", async () => {
        const interaction = mockInteraction({ userId: "user-42" });
        interaction.values = ["warrior"];

        await command.execute(interaction);

        const pending = pendingApplications.get("user-42");
        expect(pending).toMatchObject({ class: "warrior", className: "Warrior" });
        expect(typeof pending.timestamp).toBe("number");

        expect(interaction.update).toHaveBeenCalledTimes(1);
        const arg = interaction.update.mock.calls[0][0];
        expect(arg.content).toContain("Schritt 2");
        expect(arg.content).toContain("Warrior");
        // spec menu carries one option per warrior spec (Arms/Fury/Protection)
        const select = arg.components[0].components[0];
        expect(select.options).toHaveLength(3);
    });

    it("falls back to the raw value for an unknown class", async () => {
        const interaction = mockInteraction({ userId: "user-99" });
        interaction.values = ["notaclass"];

        await command.execute(interaction);

        const pending = pendingApplications.get("user-99");
        expect(pending).toMatchObject({ class: "notaclass", className: "notaclass" });
        // no specs -> empty spec menu
        const select = interaction.update.mock.calls[0][0].components[0].components[0];
        expect(select.options).toHaveLength(0);
    });
});
