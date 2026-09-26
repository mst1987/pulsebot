// "Invite callen" (inviteCall.js + the Discord button in inviteCallBot.js):
// groups 1–5 of the approved setup are pinged in the event channel with
// "/w <Charakter> inv", the character being the caller's own. Stores and
// Discord are mocks; the approved setup is read by the real setupCore.
jest.mock("../../src/stores/eventStore", () => ({ getEvent: jest.fn(), appendEventLog: jest.fn() }));
jest.mock("../../src/stores/signupStore", () => ({ getSignup: jest.fn(() => null) }));
jest.mock("../../src/services/discord/discord", () => ({ postMissingPing: jest.fn(async () => ({ url: "https://discord.example/m1" })) }));
// Which server counts as the event server is /event's rule, tested with it (test/commands/event).
jest.mock("../../src/services/events/eventDraft", () => ({ guildFor: (interaction) => ({ guildId: interaction.guild.id }) }));

const eventStore = require("../../src/stores/eventStore");
const signupStore = require("../../src/stores/signupStore");
const discord = require("../../src/services/discord/discord");
const { invitePlan, callInvite, inviteCharacterOf } = require("../../src/web/inviteCall");
const bot = require("../../src/web/inviteCallBot");
const { inviteButtonRow } = require("../../src/web/setupCore");
const command = require("../../src/commands/event/inviteCallButton");

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
                    { index: 5, slots: [slot("u5", "Thalia")] },
                    { index: 6, slots: [slot("u6", "Sechs")] },
                    { index: 8, slots: [slot("u8", "Acht")] },
                ],
                bench: [slot("u-bench", "Bankdrücker")],
            },
        },
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    signupStore.getSignup.mockReturnValue(null);
});

describe("invitePlan", () => {
    it("pings groups 1–5 once each, never the caller, with the caller's setup character", () => {
        const plan = invitePlan(raid(), "u-lead");
        expect(plan.userIds).toEqual(["u2", "u3", "u5"]);
        expect(plan.text).toBe("/w Naphfß inv");
        expect(plan.groups).toEqual([1, 2, 5]);
    });

    it("finds the caller on the bench, else by their signup", () => {
        const event = raid();
        expect(inviteCharacterOf(event, event.setup.approved, "u-bench")).toBe("Bankdrücker");
        signupStore.getSignup.mockReturnValue({ character: "Orgachar" });
        expect(invitePlan(event, "u-orga").text).toBe("/w Orgachar inv");
        expect(signupStore.getSignup).toHaveBeenCalledWith("eh-abc123", "u-orga");
    });

    it("reads the approved snapshot, never a draft changed since", () => {
        const event = raid();
        event.setup.status = "draft";
        event.setup.groups = [{ index: 1, slots: [slot("u-draft", "Entwurf")] }];
        expect(invitePlan(event, "u-lead").userIds).toEqual(["u2", "u3", "u5"]);
    });

    it.each([
        ["no event", null, "u-lead", "not_found"],
        ["cancelled", raid({ status: "cancelled" }), "u-lead", "cancelled"],
        ["no approved setup", raid({ setup: { status: "draft", groups: [] } }), "u-lead", "no_setup"],
        ["caller has no character", raid(), "u-stranger", "no_character"],
        ["nobody but the caller", raid({ setup: { status: "approved", approved: { groups: [{ index: 1, slots: [slot("u-lead", "Naphfß")] }] } } }), "u-lead", "nobody"],
    ])("refuses: %s", (_, event, userId, code) => {
        expect(invitePlan(event, userId).error.code).toBe(code);
    });
});

describe("callInvite", () => {
    it("posts into the event channel and logs it on the event", async () => {
        eventStore.getEvent.mockReturnValue(raid());
        const result = await callInvite({ guildId: "g1", eventId: "eh-abc123", userId: "u-lead", byName: "Nerathil" });
        expect(discord.postMissingPing).toHaveBeenCalledWith("c1", ["u2", "u3", "u5"], "/w Naphfß inv");
        expect(eventStore.appendEventLog).toHaveBeenCalledWith("eh-abc123", { action: "invite", by: "u-lead", byName: "Nerathil", detail: "3 Raider · /w Naphfß inv" });
        expect(result).toMatchObject({ count: 3, text: "/w Naphfß inv", message: "3 Raider aus Gruppe 1–5 gepingt: /w Naphfß inv" });
    });

    it("refuses another server's event and posts nothing", async () => {
        eventStore.getEvent.mockReturnValue(raid());
        expect((await callInvite({ guildId: "other", eventId: "eh-abc123", userId: "u-lead" })).error.code).toBe("not_found");
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });

    it("says so when Discord refuses, and logs nothing", async () => {
        eventStore.getEvent.mockReturnValue(raid());
        discord.postMissingPing.mockRejectedValueOnce(new Error("Missing Access"));
        const result = await callInvite({ guildId: "g1", eventId: "eh-abc123", userId: "u-lead" });
        expect(result.error).toMatchObject({ code: "post_failed", message: "Konnte nicht posten: Missing Access" });
        expect(eventStore.appendEventLog).not.toHaveBeenCalled();
    });
});

describe("the Discord button (inviteCallBot)", () => {
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
        expect(command.name).toBe("invite-call");
        expect(command.accessOf).toBe("event");
    });

    it("answers the public button privately with the preview, posting nothing", async () => {
        eventStore.getEvent.mockReturnValue(raid());
        const interaction = click("invite-call:p:eh-abc123");
        await command.execute(interaction);
        const payload = interaction.reply.mock.calls[0][0];
        expect(payload.flags).toBeTruthy();
        expect(payload.embeds[0].description).toContain("**3 Raider**");
        expect(payload.embeds[0].description).toContain("`/w Naphfß inv`");
        expect(payload.components[0].components[0]).toMatchObject({ custom_id: "invite-call:c:eh-abc123", label: "Jetzt pingen" });
        expect(discord.postMissingPing).not.toHaveBeenCalled();
    });

    it("posts on 'Jetzt pingen' and turns the preview into the result", async () => {
        eventStore.getEvent.mockReturnValue(raid());
        const interaction = click("invite-call:c:eh-abc123");
        await command.execute(interaction);
        expect(discord.postMissingPing).toHaveBeenCalledWith("c1", ["u2", "u3", "u5"], "/w Naphfß inv");
        expect(interaction.update.mock.calls[0][0].embeds[0].description).toBe("✅ 3 Raider aus Gruppe 1–5 gepingt: /w Naphfß inv");
    });

    it("tells a caller without a character why, privately", async () => {
        eventStore.getEvent.mockReturnValue(raid());
        const interaction = click("invite-call:p:eh-abc123", "u-stranger");
        await command.execute(interaction);
        expect(interaction.reply.mock.calls[0][0].embeds[0].description).toMatch(/^⚠️ Du bist für diesen Raid mit keinem Charakter angemeldet/);
    });

    it("ignores ids that are no own event", () => {
        expect(bot.parseInviteId("invite-call:p:../../x")).toEqual({ field: "p", eventId: "" });
        expect(inviteButtonRow("eh-abc123").components[0].custom_id).toBe("invite-call:p:eh-abc123");
    });
});
