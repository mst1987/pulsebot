const command = require("../../../src/commands/apply/applySpec.js");
const { pendingApplications } = require("../../../src/utils/applicationState.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

describe("commands/apply/applySpec", () => {
    beforeEach(() => {
        pendingApplications.clear();
    });

    it("exports the handler for the \"apply-spec\" customId", () => {
        expect(command.name).toBe("apply-spec");
        expect(typeof command.description).toBe("string");
        expect(typeof command.execute).toBe("function");
    });

    it("merges the chosen spec into the pending application and shows the modal", async () => {
        const interaction = mockInteraction({ userId: "user-7" });
        interaction.values = ["Fury"];
        pendingApplications.set("user-7", { class: "warrior", className: "Warrior", timestamp: 1 });

        await command.execute(interaction);

        const pending = pendingApplications.get("user-7");
        expect(pending).toMatchObject({ class: "warrior", className: "Warrior", spec: "Fury" });

        expect(interaction.showModal).toHaveBeenCalledTimes(1);
        const modal = interaction.showModal.mock.calls[0][0];
        expect(modal.data.custom_id).toBe("apply-modal");
    });

    it("still shows the modal when there is no prior pending entry", async () => {
        const interaction = mockInteraction({ userId: "user-8" });
        interaction.values = ["Frost"];

        await command.execute(interaction);

        expect(pendingApplications.get("user-8")).toMatchObject({ spec: "Frost" });
        expect(interaction.showModal).toHaveBeenCalledTimes(1);
    });
});
