// "Confirm"/"Cancel" unter der Setup-Nachricht (Raid-Helper-Stil): eigene
// Platzierung bestaetigen oder absagen, nur markieren (keine automatische
// Nachbesetzung); eine Bestaetigung bleibt ueber spaetere Aenderungen des Setups erhalten.
const { MessageFlags } = require("discord.js");
const { cardText } = require("../../helpers/cardText");

const mockEvents = new Map();
jest.mock("../../../src/stores/events/eventStore", () => ({
    getEvent: jest.fn((id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null)),
    setEventSetupPost: jest.fn((id, patch) => {
        const e = mockEvents.get(id);
        if (!e) return null;
        e.setupPost = patch ? { ...(e.setupPost || {}), ...JSON.parse(JSON.stringify(patch)) } : null;
        return JSON.parse(JSON.stringify(e));
    }),
}));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => ({}) }));
jest.mock("../../../src/services/discord/discord", () => ({ getClient: jest.fn(), sendDirectMessage: jest.fn() }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));

const eventStore = require("../../../src/stores/events/eventStore");
const confirmBot = require("../../../src/services/setup/setupConfirmBot");
const setupCore = require("../../../src/services/setup/setupCore");

const p = (userId, character, spec, role) => ({ userId, character, classId: spec.split("-")[0], spec, role });

function approved(version = 2) {
    return {
        version,
        groups: [{ index: 1, slots: [p("1", "Brokk", "Warrior-Protection", "tank"), p("2", "Zibbo", "Priest-Holy", "healer")] }],
        bench: [p("5", "Thalia", "Priest-Shadow", "ranged")],
    };
}

function seed(over = {}) {
    const a = approved();
    const event = {
        id: "eh-1", guildId: "g1", channelId: "c1", channelName: "kara-do", title: "Kara Donnerstag",
        startTime: 2000000000, size: 10, status: "active",
        setup: { status: "approved", version: 2, groups: a.groups, bench: a.bench, approved: a },
        setupPost: { channelId: "c1", messageId: "m1" },
        ...over,
    };
    mockEvents.set(event.id, event);
    return event;
}

beforeEach(() => {
    mockEvents.clear();
    jest.clearAllMocks();
});

describe("setupConfirmBot", () => {
    it("parses the customId, refusing anything that is not an own event id", () => {
        expect(confirmBot.parseConfirmId("setup-confirm:y:eh-1")).toEqual({ field: "y", eventId: "eh-1" });
        expect(confirmBot.parseConfirmId("setup-confirm:n:eh-1")).toEqual({ field: "n", eventId: "eh-1" });
        expect(confirmBot.parseConfirmId("setup-confirm:y:not-an-event").eventId).toBe("");
    });

    it("builds the button row — plain labels, no icon (Raid-Helper style)", () => {
        expect(setupCore.confirmButtonRow("eh-1").components.map((b) => b.label)).toEqual(["Bestätigen", "Absagen"]);
        expect(setupCore.confirmButtonRow("eh-1", "en")).toEqual({
            type: 1,
            components: [
                { type: 2, style: 3, custom_id: "setup-confirm:y:eh-1", label: "Confirm" },
                { type: 2, style: 4, custom_id: "setup-confirm:n:eh-1", label: "Cancel" },
            ],
        });
    });

    it("records a group raider's own confirmation and cancel", async () => {
        seed();
        const ok = await confirmBot.setConfirmation("eh-1", "1", "y");
        expect(ok.status).toBe("confirmed");
        const stored = eventStore.getEvent("eh-1").setupPost.confirmations;
        // `by` the raider themselves — the orga's mark in the editor names the orga member
        expect(stored["1"]).toEqual({ status: "confirmed", at: expect.any(Number), by: "1" });

        const cancelled = await confirmBot.setConfirmation("eh-1", "2", "n");
        expect(cancelled.status).toBe("declined");
        expect(eventStore.getEvent("eh-1").setupPost.confirmations["2"]).toMatchObject({ status: "declined", by: "2" });
        // the first raider's confirmation survives a second raider's own click
        expect(eventStore.getEvent("eh-1").setupPost.confirmations["1"].status).toBe("confirmed");
    });

    it("refuses a raider who is not placed in a group (bench included)", async () => {
        seed();
        const bench = await confirmBot.setConfirmation("eh-1", "5", "y");
        expect(bench.code).toBe("not_placed");
        const stranger = await confirmBot.setConfirmation("eh-1", "999", "y");
        expect(stranger.code).toBe("not_placed");
        expect(eventStore.setEventSetupPost).not.toHaveBeenCalled();
    });

    it("refuses without an event or an approved setup", async () => {
        expect((await confirmBot.setConfirmation("eh-missing", "1", "y")).code).toBe("not_found");
        seed({ setup: { status: "draft" } });
        expect((await confirmBot.setConfirmation("eh-1", "1", "y")).code).toBe("no_approved_setup");
    });

    it("keeps a confirmation through later changes of the lineup", async () => {
        seed();
        await confirmBot.setConfirmation("eh-1", "1", "y");
        // a later version moves raider 1 into group 2 — the answer stays
        const event = eventStore.getEvent("eh-1");
        const later = approved(3);
        later.groups = [{ index: 1, slots: [later.groups[0].slots[1]] }, { index: 2, slots: [later.groups[0].slots[0]] }];
        event.setup.approved = later;
        event.setup.version = 3;
        mockEvents.set("eh-1", event);
        expect(setupCore.confirmationsFor(event, later)).toEqual({ 1: "confirmed" });
        await confirmBot.setConfirmation("eh-1", "2", "y");
        expect(setupCore.confirmationsFor(eventStore.getEvent("eh-1"), later)).toEqual({ 1: "confirmed", 2: "confirmed" });
        // somebody no longer in a group has none shown, and gets it back on their return
        const without = { ...later, groups: [later.groups[0]] };
        expect(setupCore.confirmationsFor(eventStore.getEvent("eh-1"), without)).toEqual({ 2: "confirmed" });
    });

    const click = (customId, userId) => ({
        customId, user: { id: userId }, reply: jest.fn(async () => {}), deferReply: jest.fn(async () => {}), editReply: jest.fn(async () => {}),
    });

    it("handleConfirmComponent defers ephemeral before the work, then answers through editReply", async () => {
        seed();
        const interaction = click("setup-confirm:y:eh-1", "1");
        await confirmBot.handleConfirmComponent(interaction);
        expect(interaction.deferReply).toHaveBeenCalledTimes(1);
        expect(interaction.deferReply.mock.calls[0][0].flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        const firstWrite = eventStore.setEventSetupPost.mock.invocationCallOrder[0];
        expect(interaction.deferReply.mock.invocationCallOrder[0]).toBeLessThan(firstWrite);
        expect(firstWrite).toBeLessThan(interaction.editReply.mock.invocationCallOrder[0]);
        expect(interaction.reply).not.toHaveBeenCalled();
        const ok = interaction.editReply.mock.calls[0][0];
        // the defer made it private; an edit cannot and must not set that again
        expect(ok.flags & MessageFlags.Ephemeral).toBeFalsy();
        expect(ok.content).toBe("");
        expect(cardText(ok)).toContain("Bestätigt — wir sehen uns beim Raid!");
        // the raid can be days away: its start, never "bis gleich"
        expect(cardText(ok)).toContain("Start: <t:2000000000:d> <t:2000000000:t> · <t:2000000000:R>");
        expect(cardText(ok)).not.toMatch(/bis gleich/i);

        const cancel = click("setup-confirm:n:eh-1", "2");
        await confirmBot.handleConfirmComponent(cancel);
        expect(cardText(cancel.editReply.mock.calls[0][0])).toContain("abgesagt");
        expect(cancel.reply).not.toHaveBeenCalled();
    });

    it("handleConfirmComponent answers a refusal through editReply too", async () => {
        seed();
        const refused = click("setup-confirm:y:eh-1", "999");
        await confirmBot.handleConfirmComponent(refused);
        expect(refused.deferReply).toHaveBeenCalledTimes(1);
        expect(cardText(refused.editReply.mock.calls[0][0])).toContain("nicht in einer Gruppe");
        expect(refused.reply).not.toHaveBeenCalled();
    });

    it("handleConfirmComponent refuses an unknown action at once, ephemeral, without a defer", async () => {
        const garbage = click("nonsense", "1");
        await confirmBot.handleConfirmComponent(garbage);
        expect(garbage.deferReply).not.toHaveBeenCalled();
        const answer = garbage.reply.mock.calls[0][0];
        expect(answer.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        expect(cardText(answer)).toContain("Unbekannte Aktion");
    });
});
