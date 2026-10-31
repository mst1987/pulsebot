// How a ping reaches the raiders (#264, server network #894): on the raid's own
// server only — a mention for whoever is there, a DM for everyone else.
jest.mock("../../../src/services/discord/discord", () => ({
    getGuild: jest.fn(),
    fetchGuildMembersCached: jest.fn(),
    postMissingPing: jest.fn(),
    postAnnouncement: jest.fn(),
    listMembersWithRoles: jest.fn(),
    sendDirectMessage: jest.fn(),
}));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({})) }));
// The raider's own language (a DM); the server language comes from the config (German without one).
jest.mock("../../../src/services/discord/botLanguage", () => {
    const actual = jest.requireActual("../../../src/services/discord/botLanguage");
    return { ...actual, langOf: jest.fn((id, opts) => actual.serverLang(opts && opts.config)) };
});

const { ButtonStyle, ComponentType, MessageFlags } = require("discord.js");
const discord = require("../../../src/services/discord/discord");
const variables = require("../../../src/config/variables");
const { KIND_COLORS } = require("../../../src/utils/discord/card");
const botLanguage = require("../../../src/services/discord/botLanguage");
const ping = require("../../../src/services/discord/pingDelivery");
const { event: baseEvent } = require("../../factories/events");
const { makeGuild } = require("../../helpers/discordClient");
const { knownChannels } = require("../../helpers/linkCheck");

/** A DM card's text (every text display, joined) — the DMs are cards since Oct 2026. */
const cardText = (payload) => {
    const parts = payload.components[0].components;
    return parts.filter((c) => c.type === ComponentType.TextDisplay).map((c) => c.content).join("\n");
};
/** The link buttons of a card. */
const cardLinks = (payload) => payload.components[0].components
    .filter((c) => c.type === ComponentType.ActionRow)
    .flatMap((r) => r.components)
    .filter((b) => b.style === ButtonStyle.Link);
const dmTexts = () => Object.fromEntries(discord.sendDirectMessage.mock.calls.map(([id, payload]) => [id, cardText(payload)]));

const RAID_GUILD = "100000";
const config = (over = {}) => ({
    guildId: RAID_GUILD,
    discordServers: { servers: [{ guildId: RAID_GUILD, label: "" }, { guildId: "200000", label: "" }], links: [] },
    roleSync: [],
    ...over,
});
const event = baseEvent({ id: "e1", title: "Karazhan", startTime: 1900000000, channelId: "110000", guildId: RAID_GUILD });

let baseUrl;
beforeEach(() => {
    jest.resetAllMocks();
    // The Discord channels these tests link exist (#537: only a link to an existing channel is shown).
    knownChannels("110000");
    baseUrl = variables.publicBaseUrl;
    variables.publicBaseUrl = "https://eh.example";
    const raidGuild = makeGuild({ id: RAID_GUILD, name: "Raid" });
    discord.getGuild.mockImplementation((id) => (id === RAID_GUILD ? raidGuild : null));
    // Users 1 and 2 are on the raid server, 3 and 4 are not.
    discord.fetchGuildMembersCached.mockResolvedValue([{ id: "1" }, { id: "2" }]);
    discord.postMissingPing.mockResolvedValue({ channelId: "110000", messageId: "m" });
    discord.postAnnouncement.mockResolvedValue({ channelId: "110000", messageId: "m" });
    discord.sendDirectMessage.mockResolvedValue({ ok: true, messageId: "dm" });
});
afterEach(() => { variables.publicBaseUrl = baseUrl; });

describe("deliverUserPing", () => {
    it("writes the default ping in the event language (German by default)", async () => {
        await ping.deliverUserPing({ event, userIds: ["1"], config: config() });
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["1"], "Bitte melde dich für den Raid an oder ab, damit das Roster vollständig ist.");
        expect(ping.missingPingText("en")).toBe("Please sign up or sign off for the raid, so the roster is complete.");
    });

    it("mentions the raiders on the raid server in the raid channel and DMs the rest", async () => {
        const r = await ping.deliverUserPing({ event, userIds: ["1", "2", "3"], text: "Bitte melden", guildId: RAID_GUILD, config: config() });
        expect(discord.fetchGuildMembersCached).toHaveBeenCalledWith(RAID_GUILD, expect.anything());
        expect(discord.postMissingPing).toHaveBeenCalledTimes(1);
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["1", "2"], "Bitte melden");
        expect(discord.sendDirectMessage).toHaveBeenCalledTimes(1);
        const [userId, payload] = discord.sendDirectMessage.mock.calls[0];
        expect(userId).toBe("3");
        // a warn card: the raid as its heading, the text, the start short — nothing pings
        expect(payload.flags & MessageFlags.IsComponentsV2).toBe(MessageFlags.IsComponentsV2);
        expect(payload.components[0].accent_color).toBe(KIND_COLORS.warn);
        expect(payload.allowedMentions).toEqual({ parse: [] });
        const text = cardText(payload);
        expect(text).toContain("## Karazhan");
        expect(text).toContain("Bitte melden");
        expect(text).toContain("<t:1900000000:d> <t:1900000000:t> · <t:1900000000:R>");
        expect(text).not.toMatch(/:[fF]>/);
        // only a button to the web: a link into the raid server leads someone not on it nowhere
        expect(cardLinks(payload).map((b) => b.url)).toEqual(["https://eh.example/signups?event=e1"]);
        expect(r).toMatchObject({ mentioned: 2, dm: { sent: ["3"], failed: [] }, membersUnreadable: false });
        expect(r).not.toHaveProperty("target");
    });

    it("takes the raid server from the event when the caller names none", async () => {
        await ping.deliverUserPing({ event, userIds: ["1"], config: config() });
        expect(discord.getGuild).toHaveBeenCalledWith(RAID_GUILD);
    });

    it("posts nothing in the channel when nobody is on the raid server", async () => {
        const r = await ping.deliverUserPing({ event, userIds: ["3", "4"], config: config() });
        expect(discord.postMissingPing).not.toHaveBeenCalled();
        expect(r.event).toBeNull();
        expect(r.mentioned).toBe(0);
        expect(r.dm.sent).toEqual(["3", "4"]);
    });

    it("sends no DM when everybody is on the raid server", async () => {
        const r = await ping.deliverUserPing({ event, userIds: ["1", "2", "2"], config: config() });
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["1", "2"], expect.any(String));
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        expect(r.dm).toBeNull();
    });

    it("takes a text per language: the channel gets the event language, each DM the raider's own", async () => {
        botLanguage.langOf.mockImplementation((id) => (id === "3" ? "en" : "de"));
        const text = (lang) => (lang === "en" ? "Reminder in English" : "Erinnerung auf Deutsch");
        await ping.deliverUserPing({ event, userIds: ["1", "3", "4"], text, config: config() });
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["1"], "Erinnerung auf Deutsch");
        const dms = dmTexts();
        expect(dms["3"]).toContain("Reminder in English");
        expect(dms["4"]).toContain("Erinnerung auf Deutsch");
        // the buttons in the reader's language, too
        const labels = Object.fromEntries(discord.sendDirectMessage.mock.calls.map(([id, payload]) => [id, cardLinks(payload).map((b) => b.label)]));
        expect(labels).toEqual({ 3: ["Open on the web"], 4: ["Im Web öffnen"] });
    });

    it("falls back to the default DM text in each raider's language", async () => {
        botLanguage.langOf.mockImplementation((id) => (id === "3" ? "en" : "de"));
        await ping.deliverUserPing({ event, userIds: ["3", "4"], config: config() });
        const dms = dmTexts();
        expect(dms["3"]).toContain("Please sign up or sign off for the raid.");
        expect(dms["4"]).toContain("Bitte melde dich für den Raid an oder ab.");
    });

    it("counts failed DMs instead of failing the ping", async () => {
        discord.sendDirectMessage.mockResolvedValue({ ok: false, error: "DMs geschlossen" });
        const r = await ping.deliverUserPing({ event, userIds: ["3"], config: config() });
        expect(discord.postMissingPing).not.toHaveBeenCalled();
        expect(r.dm).toEqual({ sent: [], failed: ["3"] });
        expect(ping.dmSummary(r)).toBe(" · 1 DM fehlgeschlagen");
    });

    it("refuses when the bot is not on the raid server, before posting anything", async () => {
        await expect(ping.deliverUserPing({ event, userIds: ["1"], guildId: "999999", config: config() }))
            .rejects.toThrow("Der Bot ist nicht auf dem Server des Raids.");
        expect(discord.postMissingPing).not.toHaveBeenCalled();
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
    });

    it("mentions everyone in the channel and DMs nobody when the members cannot be read", async () => {
        discord.fetchGuildMembersCached.mockRejectedValue(new Error("intent"));
        const r = await ping.deliverUserPing({ event, userIds: ["1", "3"], config: config() });
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["1", "3"], expect.any(String));
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        expect(r).toMatchObject({ mentioned: 2, dm: null, membersUnreadable: true });
        expect(ping.dmSummary(r)).toBe(` · ${ping.MEMBERS_UNREADABLE_NOTE}`);
        expect(ping.MEMBERS_UNREADABLE_NOTE).toBe("Mitgliederliste nicht lesbar, alle im Kanal erwähnt");
    });

    it("falls back the same way when the member list does not come in time", async () => {
        discord.fetchGuildMembersCached.mockReturnValue(new Promise(() => {}));
        const r = await ping.deliverUserPing({ event, userIds: ["1", "3"], config: config(), memberTimeoutMs: 5 });
        expect(discord.postMissingPing).toHaveBeenCalledWith("110000", ["1", "3"], expect.any(String));
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        expect(r.membersUnreadable).toBe(true);
        expect(ping.MEMBER_FETCH_MS).toBe(10000);
    });

    it("treats a member list that is no list as unreadable", async () => {
        discord.fetchGuildMembersCached.mockResolvedValue(null);
        const r = await ping.deliverUserPing({ event, userIds: ["3"], config: config() });
        expect(r).toMatchObject({ mentioned: 1, dm: null, membersUnreadable: true });
    });

    it("sums up DMs sent and failed, and nothing without a delivery", () => {
        expect(ping.dmSummary(null)).toBe("");
        expect(ping.dmSummary({ dm: null, membersUnreadable: false })).toBe("");
        expect(ping.dmSummary({ dm: { sent: ["3", "4"], failed: ["5", "6"] } })).toBe(" · 2 per DM · 2 DMs fehlgeschlagen");
    });

    it("refuses an event without a channel", async () => {
        await expect(ping.deliverUserPing({ event: { ...event, channelId: "" }, userIds: ["1"], config: config() }))
            .rejects.toThrow("Das Event hat keinen Kanal.");
    });
});

describe("deliverAnnouncement", () => {
    const template = { title: "Anmeldung", body: "Bitte eintragen" };

    it("posts the call with the role mentions in the raid channel and DMs nobody", async () => {
        const r = await ping.deliverAnnouncement({ channelId: "110000", template, roleIds: ["500000", "500000", ""] });
        expect(discord.postAnnouncement).toHaveBeenCalledWith("110000", template, ["500000"]);
        expect(discord.listMembersWithRoles).not.toHaveBeenCalled();
        expect(discord.sendDirectMessage).not.toHaveBeenCalled();
        expect(r).toEqual({ event: { channelId: "110000", messageId: "m" }, mentioned: 0, dm: null });
    });

    it("refuses without a template or a channel", async () => {
        await expect(ping.deliverAnnouncement({ channelId: "", template, roleIds: [] })).rejects.toThrow("Vorlage oder Channel fehlt.");
        await expect(ping.deliverAnnouncement({ channelId: "110000", template: null, roleIds: [] })).rejects.toThrow("Vorlage oder Channel fehlt.");
        expect(discord.postAnnouncement).not.toHaveBeenCalled();
    });
});

describe("dmCard", () => {
    it("leaves the date and the buttons out when the event has neither start nor channel nor id", () => {
        const payload = ping.dmCard("Hallo", { title: "Gruul" });
        expect(cardText(payload)).toBe("## Gruul\nHallo");
        expect(cardLinks(payload)).toEqual([]);
        expect(ping.shortStart(0)).toBe("");
        expect(ping.shortStart(1900000000)).toBe("<t:1900000000:d> <t:1900000000:t> · <t:1900000000:R>");
    });

    it("never links into the raid server, not even to the signup message", () => {
        knownChannels("110000");
        const withMessage = { ...event, message: { channelId: "110000", messageId: "130000" } };
        const links = cardLinks(ping.dmCard("Hallo", withMessage, "en"));
        expect(links.map((b) => [b.label, b.url])).toEqual([["Open on the web", "https://eh.example/signups?event=e1"]]);
    });
});
