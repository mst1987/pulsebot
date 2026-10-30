// Hinweis „<Server> beitreten“ (#904): nach dem Speichern von einem Partner-
// server prüft der Bot einmal, ob das Mitglied auf dem Server des Raids ist.
// Mitglied → nichts; kein Mitglied (10007/10013) → Zeile mit dem Servernamen,
// mit Einladung auch Link-Knopf; nicht lesbar (andere Fehler, zu langsam, keine
// Guild) → nichts. Dazu die Rollen für die Raider-Rolle: kein Mitglied → keine.
jest.mock("../../../src/services/discord/discord", () => ({ getGuild: jest.fn(), memberRoleIds: jest.fn() }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: jest.fn(() => ({ guildId: "100000000000000001" })) }));

const discord = require("../../../src/services/discord/discord");
const hint = require("../../../src/services/signups/partnerJoinHint");
const inviteStore = require("../../../src/stores/discord/discordInviteStore");
const { tempStoreFile } = require("../../helpers/tempStore");

const MAIN = "100000000000000001";
const PUG = "100000000000000002";
const PARTNER = "100000000000000003";
const ANNA = "200000000000000001";
const INVITE = "https://discord.gg/abcdef";

let guilds;
function guild(id, { cached = [], fetch, name = "Pulse PuGs" } = {}) {
    const g = { id, name, members: { cache: new Set(cached), fetch: jest.fn(fetch || (async () => ({ id: ANNA }))) } };
    guilds[id] = g;
    return g;
}
const unknownMember = (code = 10007) => async () => { throw Object.assign(new Error("Unknown Member"), { code }); };
const click = (guildId, userId = ANNA) => ({ guildId, user: { id: userId } });

beforeEach(() => {
    inviteStore.useFile(tempStoreFile("discord-invites.json"));
    guilds = {};
    discord.getGuild.mockReset();
    discord.getGuild.mockImplementation((id) => guilds[id] || null);
    discord.memberRoleIds.mockReset();
});

afterAll(() => inviteStore.useFile(null));

describe("raidGuildId", () => {
    it("is the event's server, else the configured main server", () => {
        expect(hint.raidGuildId({ guildId: PUG }, { guildId: MAIN })).toBe(PUG);
        expect(hint.raidGuildId({}, { guildId: MAIN })).toBe(MAIN);
        expect(hint.raidGuildId(null, {})).toBe("");
    });
});

describe("isServerMember", () => {
    it("answers true from the cache without asking Discord", async () => {
        const g = guild(PUG, { cached: [ANNA] });
        await expect(hint.isServerMember(PUG, ANNA)).resolves.toBe(true);
        expect(g.members.fetch).not.toHaveBeenCalled();
    });

    it("answers true after a single-member fetch", async () => {
        const g = guild(PUG);
        await expect(hint.isServerMember(PUG, ANNA)).resolves.toBe(true);
        expect(g.members.fetch).toHaveBeenCalledWith(ANNA);
    });

    it("answers false on Unknown Member / Unknown User - also inside rawError", async () => {
        guild(PUG, { fetch: unknownMember(10007) });
        await expect(hint.isServerMember(PUG, ANNA)).resolves.toBe(false);
        guild(PUG, { fetch: unknownMember(10013) });
        await expect(hint.isServerMember(PUG, ANNA)).resolves.toBe(false);
        guild(PUG, { fetch: async () => { throw Object.assign(new Error("x"), { rawError: { code: 10007 } }); } });
        await expect(hint.isServerMember(PUG, ANNA)).resolves.toBe(false);
    });

    it("answers null when it cannot tell: other error, no guild, too slow", async () => {
        guild(PUG, { fetch: unknownMember(50001) });
        await expect(hint.isServerMember(PUG, ANNA)).resolves.toBeNull();
        await expect(hint.isServerMember("999", ANNA)).resolves.toBeNull();
        guild(PUG, { fetch: () => new Promise(() => {}) });
        await expect(hint.isServerMember(PUG, ANNA, { waitMs: 5 })).resolves.toBeNull();
    });
});

describe("signupRoleIds", () => {
    it("passes readable roles through", async () => {
        discord.memberRoleIds.mockResolvedValue(["r1"]);
        await expect(hint.signupRoleIds(PUG, ANNA)).resolves.toEqual(["r1"]);
        expect(discord.getGuild).not.toHaveBeenCalled();
    });

    it("asks Discord once: surely not on the server (10007/10013) means no roles", async () => {
        discord.memberRoleIds.mockImplementation(async (g, u, opts) => opts && opts.absentAs);
        await expect(hint.signupRoleIds(PUG, ANNA)).resolves.toEqual([]);
        expect(discord.memberRoleIds).toHaveBeenCalledTimes(1);
        expect(discord.memberRoleIds).toHaveBeenCalledWith(PUG, ANNA, { absentAs: [] });
        expect(discord.getGuild).not.toHaveBeenCalled();
    });

    it("stays null (lenient) when the roles cannot be read for another reason", async () => {
        discord.memberRoleIds.mockResolvedValue(null);
        await expect(hint.signupRoleIds(PUG, ANNA)).resolves.toBeNull();
        discord.memberRoleIds.mockResolvedValue(undefined);
        await expect(hint.signupRoleIds(PUG, ANNA)).resolves.toBeNull();
        expect(discord.getGuild).not.toHaveBeenCalled();
    });
});

describe("serverNameOf", () => {
    it("takes the label, else the Discord server's name, else PuG - capped for the button", () => {
        const config = { discordServers: { servers: [{ guildId: PUG, label: "PuG-Börse" }] } };
        expect(hint.serverNameOf(PUG, config)).toBe("PuG-Börse");
        guild(MAIN, { name: "Pulse Fresh" });
        expect(hint.serverNameOf(MAIN, {})).toBe("Pulse Fresh");
        expect(hint.serverNameOf("999", {})).toBe("PuG");
        guild(PARTNER, { name: "x".repeat(100) });
        expect(hint.serverNameOf(PARTNER, {})).toHaveLength(60);
    });
});

describe("buildJoinHint", () => {
    it("is the line in the member's language naming the server, with a link button only for an https invite", () => {
        expect(hint.buildJoinHint({ lang: "de", serverName: "Pulse PuGs" }))
            .toEqual({ line: "ℹ️ Tritt dem Server **Pulse PuGs** bei, sonst bekommst du keine Pings und Infos.", button: null });
        const en = hint.buildJoinHint({ lang: "en", inviteUrl: INVITE, serverName: "Pulse PuGs" });
        expect(en.line).toBe("ℹ️ Join the server **Pulse PuGs**, otherwise you will not get pings and info.");
        expect(en.button).toEqual({ type: 2, style: 5, label: "Join Pulse PuGs", url: INVITE });
        expect(hint.buildJoinHint({ lang: "de", inviteUrl: INVITE, serverName: "Pulse PuGs" }).button.label).toBe("Pulse PuGs beitreten");
        expect(hint.buildJoinHint({ inviteUrl: "javascript:alert(1)" }).button).toBeNull();
    });

    it("reads the invite of a link from the store (#905): none, live, deleted", () => {
        const key = `${PUG}:${PARTNER}`;
        expect(hint.inviteUrlForLink(key)).toBe("");
        inviteStore.setLinkInvite(key, { code: "abcdef" });
        expect(hint.inviteUrlForLink(key)).toBe(INVITE);
        inviteStore.setLinkInvite(key, { deleted: true });
        expect(hint.inviteUrlForLink(key)).toBe("");
    });
});

describe("joinHintFor", () => {
    const event = { id: "eh-1", guildId: PUG };

    it("tells a non-member on a partner server - with the invite of that link", async () => {
        guild(PUG, { fetch: unknownMember() });
        const inviteUrlOf = jest.fn(() => INVITE);
        const res = await hint.joinHintFor(click(PARTNER), event, { lang: "de", inviteUrlOf });
        expect(inviteUrlOf).toHaveBeenCalledWith(`${PUG}:${PARTNER}`);
        expect(res).toEqual({ line: expect.stringContaining("Tritt dem Server **Pulse PuGs** bei"), button: expect.objectContaining({ url: INVITE, label: "Pulse PuGs beitreten" }), linkKey: `${PUG}:${PARTNER}` });
    });

    it("puts the stored invite of the link on the button by default (#905)", async () => {
        guild(PUG, { fetch: unknownMember() });
        inviteStore.setLinkInvite(`${PUG}:${PARTNER}`, { code: "abcdef" });
        // another link's invite is not this one's
        inviteStore.setLinkInvite(`${MAIN}:${PARTNER}`, { code: "zzz" });
        const res = await hint.joinHintFor(click(PARTNER), event, { lang: "en" });
        expect(res.button).toEqual(expect.objectContaining({ url: INVITE, label: "Join Pulse PuGs" }));
    });

    it("gives the line alone when there is no invite", async () => {
        guild(PUG, { fetch: unknownMember() });
        const res = await hint.joinHintFor(click(PARTNER), event, { lang: "en" });
        expect(res.button).toBeNull();
        expect(res.line).toContain("Join the server **Pulse PuGs**");
    });

    it("says nothing to a member, when membership cannot be read, on the raid's own server or without a server", async () => {
        guild(PUG, { cached: [ANNA] });
        expect(await hint.joinHintFor(click(PARTNER), event)).toBeNull();
        guild(PUG, { fetch: unknownMember(50013) });
        expect(await hint.joinHintFor(click(PARTNER), event)).toBeNull();
        guild(PUG, { fetch: unknownMember() });
        expect(await hint.joinHintFor(click(PUG), event)).toBeNull();
        expect(await hint.joinHintFor(click(null), event)).toBeNull();
        expect(guilds[PUG].members.fetch).not.toHaveBeenCalled();
    });

    it("takes the main server for an event without its own server", async () => {
        guild(MAIN, { fetch: unknownMember() });
        const res = await hint.joinHintFor(click(PARTNER), { id: "eh-2" }, { lang: "en" });
        expect(res.linkKey).toBe(`${MAIN}:${PARTNER}`);
    });
});

describe("joinHintForEvents", () => {
    it("checks each raid server once, one line, one button per distinct invite", async () => {
        const pug = guild(PUG, { fetch: unknownMember() });
        guild(MAIN, { fetch: unknownMember() });
        const inviteUrlOf = jest.fn((key) => `https://discord.gg/${key.split(":")[0].slice(-1)}`);
        const res = await hint.joinHintForEvents(click(PARTNER), [{ guildId: PUG }, { guildId: PUG }, { guildId: MAIN }], { lang: "en", inviteUrlOf });
        expect(pug.members.fetch).toHaveBeenCalledTimes(1);
        expect(res.line).toContain("Join the server **Pulse PuGs**");
        expect(res.buttons.map((b) => b.url)).toEqual(["https://discord.gg/2", "https://discord.gg/1"]);
    });

    it("is null when the member is on every raid server or nothing was saved", async () => {
        guild(PUG, { cached: [ANNA] });
        expect(await hint.joinHintForEvents(click(PARTNER), [{ guildId: PUG }])).toBeNull();
        expect(await hint.joinHintForEvents(click(PARTNER), [])).toBeNull();
    });
});
