// "Confirm"/"Cancel" unter der Setup-Nachricht (Raid-Helper-Stil): eigene
// Platzierung bestaetigen oder absagen, nur markieren (keine automatische
// Nachbesetzung), veraltete Bestaetigungen fallen bei einer neuen Version weg.
const { MessageFlags } = require("discord.js");

const mockEvents = new Map();
jest.mock("../../src/web/eventStore", () => ({
    getEvent: jest.fn((id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null)),
    setEventSetupPost: jest.fn((id, patch) => {
        const e = mockEvents.get(id);
        if (!e) return null;
        e.setupPost = patch ? { ...(e.setupPost || {}), ...JSON.parse(JSON.stringify(patch)) } : null;
        return JSON.parse(JSON.stringify(e));
    }),
}));
jest.mock("../../src/web/settingsStore", () => ({ getConfig: () => ({}) }));
jest.mock("../../src/web/discord", () => ({ getClient: jest.fn(), sendDirectMessage: jest.fn() }));
jest.mock("../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));
jest.mock("../../src/web/setupEditor", () => ({
    approvedSetupOf: (e) => (e && e.setup && e.setup.approved && Array.isArray(e.setup.approved.groups) ? e.setup.approved : null),
}));

const eventStore = require("../../src/web/eventStore");
const confirmBot = require("../../src/web/setupConfirmBot");

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
        expect(confirmBot.confirmButtonRow("eh-1")).toEqual({
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
        expect(stored["1"]).toEqual({ status: "confirmed", version: 2 });

        const cancelled = await confirmBot.setConfirmation("eh-1", "2", "n");
        expect(cancelled.status).toBe("declined");
        expect(eventStore.getEvent("eh-1").setupPost.confirmations["2"]).toEqual({ status: "declined", version: 2 });
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

    it("drops a confirmation from an earlier version once the lineup changed", async () => {
        seed();
        await confirmBot.setConfirmation("eh-1", "1", "y");
        // a re-approval bumps the version and keeps the same raider in group 1
        const event = eventStore.getEvent("eh-1");
        event.setup.approved = approved(3);
        event.setup.version = 3;
        mockEvents.set("eh-1", event);
        expect(confirmBot.confirmationsFor(event, approved(3))).toEqual({});
        await confirmBot.setConfirmation("eh-1", "2", "y");
        // the stale v2 entry for "1" is gone, only the fresh v3 one for "2" remains
        expect(eventStore.getEvent("eh-1").setupPost.confirmations).toEqual({ 2: { status: "confirmed", version: 3 } });
    });

    it("handleConfirmComponent replies ephemeral, success or refusal", async () => {
        seed();
        const reply = jest.fn();
        await confirmBot.handleConfirmComponent({ customId: "setup-confirm:y:eh-1", user: { id: "1" }, reply });
        expect(reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, content: expect.stringContaining("Confirmed") }));

        const refused = jest.fn();
        await confirmBot.handleConfirmComponent({ customId: "setup-confirm:y:eh-1", user: { id: "999" }, reply: refused });
        expect(refused).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("nicht in einer Gruppe") }));

        const garbage = jest.fn();
        await confirmBot.handleConfirmComponent({ customId: "nonsense", user: { id: "1" }, reply: garbage });
        expect(garbage).toHaveBeenCalledWith(expect.objectContaining({ content: "Diese Aktion gibt es nicht." }));
    });
});
