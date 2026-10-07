// "Alle pingen" (setupPing.js + the Discord button/modal in setupPingBot.js):
// every group of the approved setup is pinged in the event channel with the
// orga's own text (else a default), the bench never. Stores and Discord are
// mocks; the approved setup is read by the real setupCore.
const { cardText } = require("../../helpers/cardText");
const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({
    getEvent: jest.fn((id) => mockEvents.get(id) || null),
    appendEventLog: jest.fn(),
    setEventSetupPost: jest.fn((id, patch) => {
        const e = mockEvents.get(id);
        if (!e) return null;
        e.setupPost = { ...(e.setupPost || {}), ...JSON.parse(JSON.stringify(patch)) };
        return e;
    }),
    setEventSetupPingText: jest.fn((id, text) => {
        const e = mockEvents.get(id);
        if (!e) return null;
        e.setupPingText = String(text || "");
        return e;
    }),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    postMissingPing: jest.fn(async () => ({ url: "https://discord.example/m1" })),
    editPingMessages: jest.fn(async (channelId, ids) => ({ messageIds: ids })),
}));
// Which server counts as the event server is /event's rule, tested with it (test/commands/event).
// The language: English here (the old assertions), German where a test says so.
jest.mock("../../../src/services/discord/botLanguage", () => {
    const mocked = {
        ...jest.requireActual("../../../src/services/discord/botLanguage"), serverLang: jest.fn(() => "en"), langOf: jest.fn(() => "en"),
    };
    // no category language in these tests: an event writes in the (mocked) server language
    mocked.eventLang = jest.fn(() => mocked.serverLang());
    return mocked;
});
jest.mock("../../../src/services/events/eventDraft", () => ({ guildFor: (interaction) => ({ guildId: interaction.guild.id }) }));

const eventStore = require("../../../src/stores/eventStore");
const discord = require("../../../src/services/discord/discord");
const { setupPingPlan, callSetupPing, saveSetupPingText, refreshSetupPing } = require("../../../src/services/setup/setupPing");
const { pingTextOf, PING_TEXT, pingButtonRow } = require("../../../src/services/setup/setupCore");
const bot = require("../../../src/services/setup/setupPingBot");
const command = require("../../../src/commands/event/setupPingButton");

const slot = (userId, character) => ({ userId, character, classId: "priest", spec: "Priest-Holy", role: "healer" });

function raid(over = {}) {
    const event = {
        id: "eh-abc123", guildId: "g1", channelId: "c1", title: "Kara Donnerstag", status: "active",
        setup: {
            status: "approved",
            approved: {
                version: 2,
                groups: [
                    { index: 1, slots: [slot("u-lead", "Naphfß"), slot("u2", "Brokk")] },
                    { index: 2, slots: [slot("u3", "Zibbo"), slot("u2", "Brokk")] },
                    { index: 8, slots: [slot("u8", "Acht")] },
                ],
                bench: [slot("u-bench", "Bankdrücker")],
            },
        },
        ...over,
    };
    mockEvents.set(event.id, event);
    return event;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockEvents.clear();
});

describe("pingTextOf / saveSetupPingText", () => {
    it("falls back to the default until the orga sets their own", () => {
        expect(pingTextOf(raid(), "en")).toBe(PING_TEXT);
        expect(pingTextOf(raid())).toBe("📋 Das Setup steht – du bist dabei!");
        saveSetupPingText("eh-abc123", "  Los geht's!  ");
        expect(pingTextOf(mockEvents.get("eh-abc123"))).toBe("Los geht's!");
    });
});

describe("setupPingPlan", () => {
    it("pings every group, once each, the bench never, never the caller", () => {
        const plan = setupPingPlan(raid(), "u-lead");
        expect(plan.userIds).toEqual(["u2", "u3", "u8"]);
        expect(plan.text).toBe(PING_TEXT);
    });

    it("uses the event's own text, an explicit override winning over it", () => {
        const event = raid({ setupPingText: "Eigener Text" });
        expect(setupPingPlan(event, "u-lead").text).toBe("Eigener Text");
        expect(setupPingPlan(event, "u-lead", { text: "Ganz neuer Text" }).text).toBe("Ganz neuer Text");
    });

    it("reads the approved snapshot, never a draft changed since", () => {
        const event = raid();
        event.setup.status = "draft";
        event.setup.groups = [{ index: 1, slots: [slot("u-draft", "Entwurf")] }];
        expect(setupPingPlan(event, "u-lead").userIds).toEqual(["u2", "u3", "u8"]);
    });

    it.each([
        ["no event", null, "u-lead", "not_found"],
        ["cancelled", raid({ status: "cancelled" }), "u-lead", "cancelled"],
        ["no approved setup", raid({ setup: { status: "draft", groups: [] } }), "u-lead", "no_setup"],
        ["nobody but the caller", raid({ setup: { status: "approved", approved: { groups: [{ index: 1, slots: [slot("u-lead", "Naphfß")] }] } } }), "u-lead", "nobody"],
    ])("refuses: %s", (_, event, userId, code) => {
        expect(setupPingPlan(event, userId).error.code).toBe(code);
    });
});

describe("callSetupPing", () => {
    it("posts into the event channel and logs it on the event", async () => {
        raid();
        const result = await callSetupPing({ guildId: "g1", eventId: "eh-abc123", userId: "u-lead", byName: "Nerathil" });
        expect(discord.postMissingPing).toHaveBeenCalledWith("c1", ["u2", "u3", "u8"], PING_TEXT);
        expect(eventStore.appendEventLog).toHaveBeenCalledWith("eh-abc123", { action: "setupPing", by: "u-lead", byName: "Nerathil", detail: "3 Raider gepingt" });
        expect(result).toMatchObject({ count: 3, message: "3 Raider aus dem Setup gepingt." });
    });

    it("posts the given text instead of the stored/default one", async () => {
        raid({ setupPingText: "Gespeicherter Text" });
        await callSetupPing({ guildId: "g1", eventId: "eh-abc123", userId: "u-lead", text: "Frisch getippter Text" });
        expect(discord.postMissingPing).toHaveBeenCalledWith("c1", ["u2", "u3", "u8"], "Frisch getippter Text");
    });

    it("refuses another server's event and posts nothing", async () => {
        raid();
        expect((await callSetupPing({ guildId: "other", eventId: "eh-abc123", userId: "u-lead" })).error.code).toBe("not_found");
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });

    it("says so when Discord refuses, and logs nothing", async () => {
        raid();
        discord.postMissingPing.mockRejectedValueOnce(new Error("Missing Access"));
        const result = await callSetupPing({ guildId: "g1", eventId: "eh-abc123", userId: "u-lead" });
        expect(result.error).toMatchObject({ code: "post_failed", message: "Konnte nicht posten: Missing Access" });
        expect(eventStore.appendEventLog).not.toHaveBeenCalled();
    });
});

describe("the Discord button + modal (setupPingBot)", () => {
    const click = (customId, userId = "u-lead") => ({
        customId,
        isModalSubmit: () => false,
        guildId: "g1",
        guild: { id: "g1" },
        user: { id: userId, username: "nerathil" },
        member: { displayName: "Nerathil" },
        reply: jest.fn(async () => {}),
        showModal: jest.fn(async () => {}),
    });
    const submit = (customId, text, userId = "u-lead") => ({
        customId,
        isModalSubmit: () => true,
        guildId: "g1",
        guild: { id: "g1" },
        user: { id: userId, username: "nerathil" },
        member: { displayName: "Nerathil" },
        fields: { getTextInputValue: () => text },
        reply: jest.fn(async () => {}),
    });

    it("hangs under /event's access, like Event verwalten", () => {
        expect(command.name).toBe("setup-ping");
        expect(command.accessOf).toBe("event");
    });

    it("opens the modal on click, pre-filled with the event's own or default text, posting nothing", async () => {
        raid({ setupPingText: "Mein Text" });
        const interaction = click("setup-ping:eh-abc123");
        await command.execute(interaction);
        expect(interaction.showModal).toHaveBeenCalledTimes(1);
        const modal = interaction.showModal.mock.calls[0][0].toJSON();
        expect(modal.title).toBe("Alle pingen");
        expect(modal.components[0].components[0].value).toBe("Mein Text");
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });

    it("refuses the click with nobody to ping, before ever opening the modal", async () => {
        raid({ setup: { status: "approved", approved: { groups: [{ index: 1, slots: [slot("u-lead", "Naphfß")] }] } } });
        const interaction = click("setup-ping:eh-abc123");
        await command.execute(interaction);
        expect(interaction.showModal).not.toHaveBeenCalled();
        expect(cardText(interaction.reply.mock.calls[0][0])).toMatch(/Im Setup steht niemand außer dir/);
    });

    it("saves the typed text and posts with it on submit", async () => {
        raid();
        const interaction = submit("setup-ping:eh-abc123", "Kommt alle!");
        await command.execute(interaction);
        expect(eventStore.setEventSetupPingText).toHaveBeenCalledWith("eh-abc123", "Kommt alle!");
        expect(discord.postMissingPing).toHaveBeenCalledWith("c1", ["u2", "u3", "u8"], "Kommt alle!");
        expect(cardText(interaction.reply.mock.calls[0][0])).toContain("3 Raider aus dem Setup gepingt.");
        expect(interaction.reply.mock.calls[0][0].flags).toBeTruthy();
    });

    it("ignores ids that are no own event", () => {
        expect(bot.parsePingId("setup-ping:../../x")).toEqual({ eventId: "" });
        expect(pingButtonRow("eh-abc123").components[0].custom_id).toBe("setup-ping:eh-abc123");
    });
});

describe("the ping follows the setup (refreshSetupPing)", () => {
    async function pinged() {
        raid();
        discord.postMissingPing.mockResolvedValueOnce({ channelId: "c1", messageId: "p1", messageIds: ["p1"], url: "u" });
        await callSetupPing({ guildId: "g1", eventId: "eh-abc123", userId: "u-lead" });
    }

    it("remembers the last ping: its messages, who was named, who pinged, the text", async () => {
        await pinged();
        expect(mockEvents.get("eh-abc123").setupPost.ping).toEqual({ channelId: "c1", messageIds: ["p1"], userIds: ["u2", "u3", "u8"], by: "u-lead", text: PING_TEXT });
    });

    it("edits it to the lineup as it stands now — the pinger still left out", async () => {
        await pinged();
        const event = mockEvents.get("eh-abc123");
        event.setup.approved.groups = [{ index: 1, slots: [slot("u-lead", "Naphfß"), slot("u3", "Zibbo"), slot("u9", "Neu")] }];
        expect(await refreshSetupPing("eh-abc123")).toEqual({ edited: true });
        expect(discord.editPingMessages).toHaveBeenCalledWith("c1", ["p1"], ["u3", "u9"], PING_TEXT);
        expect(event.setupPost.ping.userIds).toEqual(["u3", "u9"]);
        // the same list again: nothing to edit
        expect(await refreshSetupPing("eh-abc123")).toEqual({ skipped: "unchanged" });
        expect(discord.editPingMessages).toHaveBeenCalledTimes(1);
    });

    it("does nothing without a remembered ping and swallows a Discord error", async () => {
        raid();
        expect(await refreshSetupPing("eh-abc123")).toEqual({ skipped: "no_ping" });
        await pinged();
        mockEvents.get("eh-abc123").setup.approved.groups[0].slots.push(slot("u10", "Zehn"));
        discord.editPingMessages.mockRejectedValueOnce(new Error("Missing Access"));
        expect(await refreshSetupPing("eh-abc123")).toEqual({ error: "Missing Access" });
    });
});
