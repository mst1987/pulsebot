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
    const threadDelete = jest.fn().mockResolvedValue(undefined);
    const thread = { send: threadSend, delete: threadDelete };
    const threadsCreate = jest.fn().mockResolvedValue(thread);
    const channel = { threads: { create: threadsCreate } };
    const client = { channels: { fetch: jest.fn().mockResolvedValue(channel) } };
    return { client, threadSend, threadsCreate, threadDelete };
}

// Discord's limits: 1024 per embed field value, 2000 per message content
function embedFieldValues(calls) {
    return calls.flatMap((c) => (c[0].embeds || []).flatMap((e) => (e.fields || []).map((f) => f.value)));
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

    it("moves an over-long description into its own message instead of the embed", async () => {
        analyzeApplicant.mockResolvedValue(null);
        const { client, threadSend } = makeClient();
        const longText = "a".repeat(1400); // modal allows 1500, embed fields only 1024
        const interaction = mockInteraction({
            userId: "user-7",
            options: { characterName: "Longtext", description: longText },
        });

        await command.execute(interaction, client);

        // the embed itself stays valid
        for (const value of embedFieldValues(threadSend.mock.calls)) {
            expect(value.length).toBeLessThanOrEqual(1024);
        }
        // and the full text is posted separately
        const contents = threadSend.mock.calls.map((c) => c[0].content || "");
        const descriptionMessage = contents.find((c) => c.includes("Über den Bewerber"));
        expect(descriptionMessage).toContain(longText);
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("eingereicht") })
        );
    });

    it("falls back to a plain message when the embed is rejected", async () => {
        analyzeApplicant.mockResolvedValue(null);
        const { client, threadSend, threadDelete } = makeClient();
        threadSend.mockRejectedValueOnce(Object.assign(new Error("Invalid Form Body"), { code: 50035 }));
        const interaction = mockInteraction({
            userId: "user-8",
            options: { characterName: "Fallbackchar", description: "kurz" },
        });
        pendingApplications.set("user-8", { class: "mage", className: "Mage", spec: "Fire" });

        await command.execute(interaction, client);

        const contents = threadSend.mock.calls.map((c) => c[0].content || "");
        expect(contents.some((c) => c.includes("Fallbackchar"))).toBe(true);
        expect(contents.some((c) => c.includes("kurz"))).toBe(true);
        // the thread is usable, so it must not be removed
        expect(threadDelete).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("eingereicht") })
        );
    });

    it("removes the thread when nothing could be posted into it", async () => {
        const { client, threadSend, threadDelete } = makeClient();
        threadSend.mockRejectedValue(Object.assign(new Error("Missing Permissions"), { code: 50013 }));
        const interaction = mockInteraction({
            userId: "user-9",
            options: { characterName: "Ghost", description: "x" },
        });

        await command.execute(interaction, client);

        expect(threadDelete).toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining("Fehler beim Einreichen") })
        );
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
