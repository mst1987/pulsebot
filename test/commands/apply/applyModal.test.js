jest.mock("../../../src/classes/warcraftlogs.js", () =>
    jest.fn().mockImplementation(() => ({}))
);
jest.mock("../../../src/utils/logcheck/applicant.js");

const command = require("../../../src/commands/apply/applyModal.js");
const { pendingApplications } = require("../../../src/utils/applicationState.js");
const { analyzeApplicant } = require("../../../src/utils/logcheck/applicant.js");
const { mockInteraction } = require("../../helpers/mockInteraction.js");

function makeClient() {
    const threadSend = jest.fn().mockResolvedValue(undefined);
    const thread = { send: threadSend };
    const threadsCreate = jest.fn().mockResolvedValue(thread);
    const channel = { threads: { create: threadsCreate } };
    const client = { channels: { fetch: jest.fn().mockResolvedValue(channel) } };
    return { client, threadSend, threadsCreate };
}

describe("commands/apply/applyModal", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pendingApplications.clear();
    });

    it("exports the handler for the \"apply-modal\" customId", () => {
        expect(command.name).toBe("apply-modal");
        expect(typeof command.description).toBe("string");
        expect(typeof command.execute).toBe("function");
    });

    it("creates a thread, posts the application, and clears the pending entry", async () => {
        analyzeApplicant.mockResolvedValue(null); // no parses -> best-effort branch
        const { client, threadSend, threadsCreate } = makeClient();
        const interaction = mockInteraction({
            userId: "user-5",
            options: {
                characterName: "Testchar",
                armoryLink: "",
                logsLink: "",
                description: "Hallo",
            },
        });
        pendingApplications.set("user-5", { class: "warrior", className: "Warrior", spec: "Fury" });

        await command.execute(interaction, client);

        expect(interaction.deferReply).toHaveBeenCalledTimes(1);
        // thread name is "<spec> - <char>"
        expect(threadsCreate).toHaveBeenCalledWith(
            expect.objectContaining({ name: "Fury - Testchar" })
        );
        expect(threadSend).toHaveBeenCalled();
        // the "no parses found" fallback message is sent
        const sentContents = threadSend.mock.calls
            .map((c) => c[0] && c[0].content)
            .filter(Boolean);
        expect(sentContents.some((c) => c.includes("Keine Warcraft-Logs-Parses"))).toBe(true);
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("eingereicht") })
        );
        // pending entry is consumed
        expect(pendingApplications.has("user-5")).toBe(false);
    });

    it("reports an error to the user when thread creation fails", async () => {
        const { client } = makeClient();
        client.channels.fetch.mockRejectedValueOnce(new Error("no channel"));
        const interaction = mockInteraction({
            userId: "user-6",
            options: { characterName: "Boom", description: "x" },
        });

        await command.execute(interaction, client);

        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("Fehler beim Einreichen") })
        );
    });
});
