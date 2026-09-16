jest.mock("../../../src/web/raidEventGroups", () => ({ loadEventGroups: jest.fn(), eventLookbackSince: jest.fn(() => 0) }));
jest.mock("../../../src/web/guildRoles", () => ({ eventGuildId: jest.fn(() => "event-guild") }));

const raids = require("../../../src/commands/lookup/raids");
const raid = require("../../../src/commands/lookup/raid");
const { loadEventGroups } = require("../../../src/web/raidEventGroups");
const { EMBED_LIMITS, embedSize } = require("../../../src/utils/botLookup");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");

const now = Math.floor(Date.now() / 1000);
const event = (over = {}) => ({
    id: "e1", title: "SSC/TK", startTime: now + 86400, channelId: "ch1", leaderId: "lead", signUps: [], ...over,
});
const groups = (events, error = null) => ({ groups: [{ categoryName: "Montagsraid", events }], error });

const editEmbed = (i) => i.editReply.mock.calls[0][0].embeds[0];
const editButtons = (i) => i.editReply.mock.calls[0][0].components[0].components;

beforeEach(() => jest.clearAllMocks());

describe("/raids", () => {
    it("is open to every member", () => {
        expect(raids.group).toBe("raids");
        expect(memberMayRun(raids)).toBe(true);
    });

    it("lists the next raids with the user's own status", async () => {
        loadEventGroups.mockResolvedValue(groups([
            event({ signUps: [{ userId: "u1", specName: "Fire" }] }),
            event({ id: "e2", title: "Hyjal", startTime: now + 2 * 86400 }),
            event({ id: "old", title: "Vorbei", startTime: now - 5 * 86400 }),
        ]));
        const i = mockInteraction({ userId: "u1" });
        await raids.execute(i);
        expect(i.deferReply).toHaveBeenCalledWith({ ephemeral: true });
        const e = editEmbed(i);
        expect(e.description).toContain("**1 ohne Antwort von dir**");
        expect(e.description).toContain("✅ angemeldet");
        expect(e.description).toContain("⚪ nicht reagiert");
        expect(e.description).not.toContain("Vorbei");
        expect(editButtons(i)[0].url).toMatch(/\/raids$/);
    });

    it("says when nothing is planned, and when Raid-Helper failed", async () => {
        loadEventGroups.mockResolvedValue(groups([]));
        const i = mockInteraction();
        await raids.execute(i);
        expect(editEmbed(i).description).toBe("Keine Raids geplant.");

        loadEventGroups.mockResolvedValue({ groups: [], error: "Raid-Helper nicht erreichbar" });
        const j = mockInteraction();
        await raids.execute(j);
        expect(editEmbed(j).description).toContain("nicht geladen werden");
    });

    it("caps the list and stays within the embed limits", async () => {
        loadEventGroups.mockResolvedValue(groups(Array.from({ length: 40 }, (_, n) => event({ id: `e${n}`, title: "T".repeat(300), startTime: now + n * 3600 }))));
        const i = mockInteraction();
        await raids.execute(i);
        const e = editEmbed(i);
        expect(e.description).toContain(`… und ${40 - raids.MAX_RAIDS} weitere`);
        expect(embedSize(e)).toBeLessThanOrEqual(EMBED_LIMITS.total);
    });
});

describe("/raid", () => {
    it("is open to every member", () => {
        expect(memberMayRun(raid)).toBe(true);
    });

    it("shows one raid: start, counts, the user's status and links", async () => {
        loadEventGroups.mockResolvedValue(groups([event({
            signUps: [
                { userId: "u1", specName: "Fire" }, { userId: "u2", specName: "Holy" },
                { userId: "u3", specName: "Absence" }, { userId: "u4", specName: "Late" },
            ],
        })]));
        const i = mockInteraction({ userId: "u3", options: { event: "e1" } });
        await raid.execute(i);
        const e = editEmbed(i);
        expect(e.title).toBe("SSC/TK");
        expect(e.description).toContain(`<t:${now + 86400}:F>`);
        expect(e.description).toContain("Montagsraid · <#ch1>");
        expect(e.fields.find((f) => f.name === "Anmeldungen").value).toBe("**3**\n1 kommt später · 1 abgemeldet");
        expect(e.fields.find((f) => f.name === "Du").value).toBe("❌ abgemeldet");
        expect(e.fields.find((f) => f.name === "Raidleitung").value).toBe("<@lead>");
        const [web, channel] = editButtons(i);
        expect(web.url).toMatch(/\/raids\/detail\?event=e1$/);
        expect(channel.url).toBe("https://discord.com/channels/event-guild/ch1");
    });

    it("finds a raid by a typed title and reports an unknown one", async () => {
        loadEventGroups.mockResolvedValue(groups([event()]));
        const i = mockInteraction({ options: { event: "ssc" } });
        await raid.execute(i);
        expect(editEmbed(i).title).toBe("SSC/TK");

        const j = mockInteraction({ options: { event: "Sunwell" } });
        await raid.execute(j);
        expect(editEmbed(j).title).toBe("Raid nicht gefunden");
    });

    it("suggests upcoming raids first, then past ones, capped at 25", async () => {
        const events = [
            event({ id: "past", title: "Alt", startTime: now - 10 * 86400 }),
            ...Array.from({ length: 30 }, (_, n) => event({ id: `u${n}`, title: `Raid ${n}`, startTime: now + (n + 1) * 3600 })),
        ];
        loadEventGroups.mockResolvedValue(groups(events));
        const i = mockInteraction({ focused: { name: "event", value: "" } });
        await raid.autocomplete(i);
        const choices = i.respond.mock.calls[0][0];
        expect(choices).toHaveLength(25);
        expect(choices[0].value).toBe("u0");
        expect(choices[0].name).toMatch(/^Raid 0 · /);

        const j = mockInteraction({ focused: { name: "event", value: "alt" } });
        await raid.autocomplete(j);
        expect(j.respond.mock.calls[0][0].map((c) => c.value)).toEqual(["past"]);
    });

    it("formats the autocomplete date in the guild's time zone", () => {
        expect(raid.shortDate(1758736800)).toBe("Mi 24.09. 20:00");
        expect(raid.shortDate(0)).toBe("");
    });
});
