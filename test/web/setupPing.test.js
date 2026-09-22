// "Alle pingen" (setupPing.js + the Discord button in setupPingBot.js): every
// group of the approved setup is pinged in the event channel with a plain
// heads-up, the bench never. Stores and Discord are mocks; the approved
// setup is read by the real setupEditor.
jest.mock("../../src/web/eventStore", () => ({ getEvent: jest.fn(), appendEventLog: jest.fn() }));
jest.mock("../../src/web/discord", () => ({ postMissingPing: jest.fn(async () => ({ url: "https://discord.example/m1" })) }));
// Which server counts as the event server is /event's rule, tested with it (test/commands/event).
jest.mock("../../src/web/eventDraft", () => ({ guildFor: (interaction) => ({ guildId: interaction.guild.id }) }));

const eventStore = require("../../src/web/eventStore");
const discord = require("../../src/web/discord");
const { setupPingPlan, callSetupPing, PING_TEXT } = require("../../src/web/setupPing");
const bot = require("../../src/web/setupPingBot");
const command = require("../../src/commands/event/setupPingButton");

const slot = (userId, character) => ({ userId, character, classId: "priest", spec: "Priest-Holy", role: "healer" });

function raid(over = {}) {
    return {
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
}

beforeEach(() => jest.clearAllMocks());

describe("setupPingPlan", () => {
    it("pings every group, once each, the bench never, never the caller", () => {
        const plan = setupPingPlan(raid(), "u-lead");
        expect(plan.userIds).toEqual(["u2", "u3", "u8"]);
        expect(plan.text).toBe(PING_TEXT);
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
        eventStore.getEvent.mockReturnValue(raid());
        const result = await callSetupPing({ guildId: "g1", eventId: "eh-abc123", userId: "u-lead", byName: "Nerathil" });
        expect(discord.postMissingPing).toHaveBeenCalledWith("c1", ["u2", "u3", "u8"], PING_TEXT);
        expect(eventStore.appendEventLog).toHaveBeenCalledWith("eh-abc123", { action: "setupPing", by: "u-lead", byName: "Nerathil", detail: "3 Raider gepingt" });
        expect(result).toMatchObject({ count: 3, message: "3 Raider aus dem Setup gepingt." });
    });

    it("refuses another server's event and posts nothing", async () => {
        eventStore.getEvent.mockReturnValue(raid());
        expect((await callSetupPing({ guildId: "other", eventId: "eh-abc123", userId: "u-lead" })).error.code).toBe("not_found");
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });

    it("says so when Discord refuses, and logs nothing", async () => {
        eventStore.getEvent.mockReturnValue(raid());
        discord.postMissingPing.mockRejectedValueOnce(new Error("Missing Access"));
        const result = await callSetupPing({ guildId: "g1", eventId: "eh-abc123", userId: "u-lead" });
        expect(result.error).toMatchObject({ code: "post_failed", message: "Konnte nicht posten: Missing Access" });
        expect(eventStore.appendEventLog).not.toHaveBeenCalled();
    });
});

describe("the Discord button (setupPingBot)", () => {
    const click = (customId, userId = "u-lead") => ({
        customId,
        guildId: "g1",
        guild: { id: "g1" },
        user: { id: userId, username: "nerathil" },
        member: { displayName: "Nerathil" },
        reply: jest.fn(async () => {}),
        update: jest.fn(async () => {}),
    });

    it("hangs under /event's access, like Event verwalten", () => {
        expect(command.name).toBe("setup-ping");
        expect(command.accessOf).toBe("event");
    });

    it("answers the public button privately with the preview, posting nothing", async () => {
        eventStore.getEvent.mockReturnValue(raid());
        const interaction = click("setup-ping:p:eh-abc123");
        await command.execute(interaction);
        const payload = interaction.reply.mock.calls[0][0];
        expect(payload.flags).toBeTruthy();
        expect(payload.embeds[0].description).toContain("**3 Raider**");
        expect(payload.embeds[0].description).toContain(`\`${PING_TEXT}\``);
        expect(payload.components[0].components[0]).toMatchObject({ custom_id: "setup-ping:c:eh-abc123", label: "Jetzt pingen" });
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });

    it("posts on 'Jetzt pingen' and turns the preview into the result", async () => {
        eventStore.getEvent.mockReturnValue(raid());
        const interaction = click("setup-ping:c:eh-abc123");
        await command.execute(interaction);
        expect(discord.postMissingPing).toHaveBeenCalledWith("c1", ["u2", "u3", "u8"], PING_TEXT);
        expect(interaction.update.mock.calls[0][0].embeds[0].description).toBe("✅ 3 Raider aus dem Setup gepingt.");
    });

    it("tells nobody-but-the-caller why, privately", async () => {
        eventStore.getEvent.mockReturnValue(raid({ setup: { status: "approved", approved: { groups: [{ index: 1, slots: [slot("u-lead", "Naphfß")] }] } } }));
        const interaction = click("setup-ping:p:eh-abc123");
        await command.execute(interaction);
        expect(interaction.reply.mock.calls[0][0].embeds[0].description).toMatch(/^⚠️ Im Setup steht niemand außer dir/);
    });

    it("ignores ids that are no own event", () => {
        expect(bot.parsePingId("setup-ping:p:../../x")).toEqual({ field: "p", eventId: "" });
        expect(bot.pingButtonRow("eh-abc123").components[0].custom_id).toBe("setup-ping:p:eh-abc123");
    });
});
