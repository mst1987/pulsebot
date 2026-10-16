// The buttons of the addon download centre (src/services/addons/addonCenterBot.js):
// download with the web's rights, orga-only, the limit, Discord's upload size and
// GitHub failures; the subscribe toggle and its error paths. GitHub and the access lookup are mocked,
// the release cache and the download limit are real.
const { Readable } = require("stream");
const { ComponentType, MessageFlags, PermissionsBitField } = require("discord.js");

const mockLog = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() };
let mockAccess = {};
let mockConfig = {};
let mockBase = "https://eh.example";

jest.mock("../../../src/logger", () => ({ ...mockLog, child: () => mockLog }));
jest.mock("../../../src/services/discord/userAccess", () => ({ resolveAccess: jest.fn(async () => mockAccess) }));
let mockLang = "de";
jest.mock("../../../src/services/discord/botLanguage", () => ({ langOfInteraction: () => mockLang }));
jest.mock("../../../src/stores/configStore", () => ({ getConfig: () => mockConfig }));
jest.mock("../../../src/utils/publicUrl", () => ({ publicBaseUrl: () => mockBase }));
jest.mock("../../../src/classes/githubReleases", () => ({
    ...jest.requireActual("../../../src/classes/githubReleases"),
    fetchLatestRelease: jest.fn(),
    openAssetStream: jest.fn(),
}));

const github = require("../../../src/classes/githubReleases");
const { resetAddonReleaseCache } = require("../../../src/services/addons/addonReleases");
const { resetDownloadLimit, LIMIT } = require("../../../src/services/addons/downloadLimit");
const { defaultAddons } = require("../../../src/services/addons/addonConfig");
const store = require("../../../src/stores/addonCenterStore");
const bot = require("../../../src/services/addons/addonCenterBot");
const button = require("../../../src/commands/lookup/addonCenterButton");
const { emptyAccess } = require("../../../src/config/permissions");
const { tempStoreFile } = require("../../helpers/tempStore");

const TOKEN = "github_pat_SECRET";
const ROLE = "200000000000000002";
const member = { ...emptyAccess(), signup: { read: true, write: true } };

const release = (assets) => ({ version: "0.3.0", tag: "v0.3.0", publishedAt: "2026-10-12T09:00:00Z", notes: "", assets });
const zip = { id: 11, name: "LevelHelper-0.3.0.zip", size: 1000, sha256: "" };

/** A click on a button: the reply methods as spies. */
function click(customId, over = {}) {
    return {
        customId,
        user: { id: "u1", username: "tester", globalName: "Tester" },
        member: null,
        guild: null,
        attachmentSizeLimit: 25 * 1000 * 1000,
        deferReply: jest.fn(async () => {}),
        deferUpdate: jest.fn(async () => {}),
        editReply: jest.fn(async () => {}),
        reply: jest.fn(async () => {}),
        ...over,
    };
}
const answer = (i) => i.editReply.mock.calls[0][0];
const textOf = (payload) => payload.components.filter((c) => c.type === ComponentType.TextDisplay).map((c) => c.content).join("\n");
const buttonsOf = (payload) => payload.components.filter((c) => c.type === ComponentType.ActionRow).flatMap((r) => r.components);
const logLines = () => [...mockLog.info.mock.calls, ...mockLog.warn.mock.calls].map((c) => c.join(" ")).join("\n");

beforeAll(() => store.useFile(tempStoreFile("addon-center.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    jest.clearAllMocks();
    resetAddonReleaseCache();
    resetDownloadLimit();
    mockBase = "https://eh.example";
    mockAccess = { isAdmin: false, access: member };
    mockConfig = { addonDownloads: defaultAddons(), github: { token: TOKEN } };
    github.fetchLatestRelease.mockResolvedValue(release([zip]));
    github.openAssetStream.mockImplementation(async () => ({ stream: Readable.from([Buffer.from("PK-zip-bytes")]), size: 12 }));
});

describe("addonCenterBot download", () => {
    it("defers at once, then sends the file only to the clicker with the install line, and logs it without the token", async () => {
        const i = click("addonhub:dl:levelhelper");
        await button.execute(i);
        expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        const p = answer(i);
        expect(p.flags).toBe(MessageFlags.IsComponentsV2);
        expect(p.components[0].content).toBe("**LevelHelper 0.3.0** – entpacken nach `Interface\\AddOns`, dann das Spiel neu starten.");
        expect(p.components[1]).toMatchObject({ type: ComponentType.File, file: { url: "attachment://LevelHelper-0.3.0.zip" } });
        expect(p.files).toEqual([{ attachment: Buffer.from("PK-zip-bytes"), name: "LevelHelper-0.3.0.zip" }]);
        expect(github.openAssetStream).toHaveBeenCalledWith({ repo: "mst1987/levelhelper", assetId: 11, token: TOKEN });
        expect(mockLog.info).toHaveBeenCalledWith("download levelhelper 0.3.0 LevelHelper-0.3.0.zip by Tester (u1) via discord");
        expect(logLines()).not.toContain(TOKEN);
    });

    it("refuses without the web's rights (signup or history)", async () => {
        mockAccess = { isAdmin: false, access: emptyAccess() };
        const i = click("addonhub:dl:levelhelper");
        await bot.handleCenter(i);
        expect(textOf(answer(i))).toBe("🔒 Downloads sind für Gildenmitglieder. Melde dich bei der Orga, wenn das nicht stimmt.");
        expect(github.fetchLatestRelease).not.toHaveBeenCalled();
    });

    it("lets the history area download too", async () => {
        mockAccess = { isAdmin: false, access: { ...emptyAccess(), history: { read: true, write: false } } };
        const i = click("addonhub:dl:levelhelper");
        await bot.handleCenter(i);
        expect(answer(i).files).toHaveLength(1);
    });

    it("an orga-only addon only for the orga, refused before GitHub is asked", async () => {
        const i = click("addonhub:dl:eventhelper-sync");
        await bot.handleCenter(i);
        expect(textOf(answer(i))).toMatch(/^🔒 /);
        expect(github.fetchLatestRelease).not.toHaveBeenCalled();
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("orga only"));

        mockAccess = { isAdmin: false, isOrga: true, access: member };
        github.fetchLatestRelease.mockResolvedValue(release([{ id: 21, name: "EventHelperSync-1.0.zip", size: 10 }]));
        const orga = click("addonhub:dl:eventhelper-sync");
        await bot.handleCenter(orga);
        expect(answer(orga).files[0].name).toBe("EventHelperSync-1.0.zip");
    });

    it("says when the next download works after the limit, in the server's time", async () => {
        for (let n = 0; n < LIMIT; n += 1) await bot.handleCenter(click("addonhub:dl:levelhelper"));
        const i = click("addonhub:dl:levelhelper");
        await bot.handleCenter(i);
        expect(textOf(answer(i))).toMatch(/^⏰ Genug geladen für den Moment – ab \*\*\d\d:\d\d\*\* geht es wieder\.$/);
        expect(github.openAssetStream).toHaveBeenCalledTimes(LIMIT);
    });

    it("a file over Discord's upload limit: the web page instead, nothing counted or fetched", async () => {
        const i = click("addonhub:dl:levelhelper", { attachmentSizeLimit: 500 });
        await bot.handleCenter(i);
        const p = answer(i);
        expect(textOf(p)).toBe("⚠️ Die Datei ist zu groß für Discord. Lade sie auf der Web-Seite.");
        expect(buttonsOf(p)).toEqual([expect.objectContaining({ label: "Zur Download-Seite", url: "https://eh.example/addon" })]);
        expect(github.openAssetStream).not.toHaveBeenCalled();
    });

    it("a file bigger than it said is cut off while reading", async () => {
        github.openAssetStream.mockResolvedValue({ stream: Readable.from([Buffer.alloc(600)]), size: 600 });
        const i = click("addonhub:dl:levelhelper", { attachmentSizeLimit: 1000 });
        github.fetchLatestRelease.mockResolvedValue(release([{ ...zip, size: 100 }]));
        await bot.handleCenter(i);
        expect(answer(i).files).toHaveLength(1);
        github.openAssetStream.mockResolvedValue({ stream: Readable.from([Buffer.alloc(800), Buffer.alloc(800)]), size: 0 });
        const big = click("addonhub:dl:levelhelper", { attachmentSizeLimit: 1000 });
        await bot.handleCenter(big);
        expect(textOf(answer(big))).toMatch(/^⚠️ /);
    });

    it("GitHub or the token failing: 'not available', with only the code in the log", async () => {
        github.openAssetStream.mockRejectedValue(Object.assign(new github.GithubError("unauthorized", 401, "x"), { config: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
        const i = click("addonhub:dl:levelhelper");
        await bot.handleCenter(i);
        expect(textOf(answer(i))).toBe("❌ Gerade nicht verfügbar – versuch es in ein paar Minuten noch einmal.");
        expect(mockLog.warn).toHaveBeenCalledWith("download failed: levelhelper/LevelHelper-0.3.0.zip for Tester (u1) via discord: unauthorized 401");
        expect(logLines()).not.toContain(TOKEN);

        mockConfig = { ...mockConfig, github: { token: "" } };
        resetAddonReleaseCache();
        const noToken = click("addonhub:dl:levelhelper");
        await bot.handleCenter(noToken);
        expect(textOf(answer(noToken))).toMatch(/^❌ /);
    });

    it("an unknown or disabled addon, or a release without a matching file, is 'not available'", async () => {
        const unknown = click("addonhub:dl:nope");
        await bot.handleCenter(unknown);
        expect(textOf(answer(unknown))).toMatch(/^❌ /);
        github.fetchLatestRelease.mockResolvedValue(release([{ id: 3, name: "readme.txt", size: 1 }]));
        const none = click("addonhub:dl:levelhelper");
        await bot.handleCenter(none);
        expect(textOf(answer(none))).toMatch(/^❌ /);
    });

    it("several matching files: one button each, then the picked one", async () => {
        const exe = { id: 31, name: "EventHelperSync.exe", size: 50 };
        const sync = { id: 32, name: "EventHelperSync-1.0.zip", size: 40 };
        github.fetchLatestRelease.mockResolvedValue(release([exe, sync]));
        mockAccess = { isAdmin: true, access: member };
        const i = click("addonhub:dl:eventhelper-sync");
        await bot.handleCenter(i);
        expect(textOf(answer(i))).toBe("**EventHelper Sync** hat mehrere Dateien. Welche?");
        expect(buttonsOf(answer(i)).map((b) => [b.label, b.custom_id])).toEqual([
            ["EventHelperSync.exe", "addonhub:file:eventhelper-sync:31"],
            ["EventHelperSync-1.0.zip", "addonhub:file:eventhelper-sync:32"],
        ]);
        const pick = click("addonhub:file:eventhelper-sync:31");
        await bot.handleCenter(pick);
        expect(answer(pick).files[0].name).toBe("EventHelperSync.exe");
        expect(answer(pick).components[0].content).toBe("**EventHelper Sync 0.3.0**");
        const gone = click("addonhub:file:eventhelper-sync:99");
        await bot.handleCenter(gone);
        expect(textOf(answer(gone))).toMatch(/^❌ /);
    });
});

describe("addonCenterBot uploadLimitOf", () => {
    it("takes Discord's limit of the interaction, else the server's boost level, else 10 MB", () => {
        expect(bot.uploadLimitOf({ attachmentSizeLimit: 26214400 })).toBe(26214400);
        expect(bot.uploadLimitOf({ guild: { premiumTier: 2 } })).toBe(50 * 1000 * 1000);
        expect(bot.uploadLimitOf({ guild: { premiumTier: 1 } })).toBe(bot.DEFAULT_UPLOAD_LIMIT);
        expect(bot.uploadLimitOf({})).toBe(10 * 1000 * 1000);
    });
});

describe("addonCenterBot subscription", () => {
    /** A server where the bot may (or may not) hand out the role, and a member with or without it. */
    function server({ has = false, manage = true, rolePos = 1, botPos = 5, managed = false, addFails = false } = {}) {
        const roles = new Map(has ? [[ROLE, {}]] : []);
        const m = {
            displayName: "Tester",
            roles: {
                cache: roles,
                add: jest.fn(async () => { if (addFails) throw new Error("Missing Permissions"); roles.set(ROLE, {}); }),
                remove: jest.fn(async () => { roles.delete(ROLE); }),
            },
        };
        const role = { id: ROLE, name: "Addon-Updates", position: rolePos, managed };
        const guild = {
            id: "g1",
            roles: { cache: new Map([[ROLE, role]]), fetch: jest.fn(async () => null) },
            members: {
                fetch: jest.fn(async () => m),
                me: { permissions: new PermissionsBitField(manage ? PermissionsBitField.Flags.ManageRoles : 0n), roles: { highest: { position: botPos } } },
            },
        };
        return { guild, member: m };
    }
    const SORRY = "❌ Abonnieren klappt gerade nicht. Sag bitte der Orga Bescheid.";

    beforeEach(() => store.setSettings({ roleId: ROLE }));
    afterAll(() => store.setSettings({ roleId: "" }));

    it("gives the role and says so, with 'Abo beenden'", async () => {
        const { guild, member: m } = server();
        const i = click("addonhub:sub", { guild, member: m });
        await button.execute(i);
        expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
        expect(m.roles.add).toHaveBeenCalledWith(ROLE, expect.any(String));
        const p = answer(i);
        expect(p.flags).toBe(MessageFlags.IsComponentsV2);
        expect(textOf(p)).toBe(`✅ Abonniert: Bei neuen Versionen pingt dich <@&${ROLE}>.`);
        expect(p.allowedMentions).toEqual({ parse: [] });
        expect(buttonsOf(p).map((b) => [b.label, b.custom_id])).toEqual([["Abo beenden", "addonhub:unsub"]]);
        expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("subscription on"));
    });

    it("the subscribe button takes the role away from who has it; 'Abo beenden' replaces the confirmation", async () => {
        const { guild, member: m } = server({ has: true });
        const again = click("addonhub:sub", { guild, member: m });
        await bot.handleCenter(again);
        expect(m.roles.remove).toHaveBeenCalledWith(ROLE, expect.any(String));
        expect(m.roles.add).not.toHaveBeenCalled();
        expect(textOf(answer(again))).toBe("🔕 Abo beendet – keine Update-Pings mehr.");

        const second = server({ has: true });
        const off = click("addonhub:unsub", { guild: second.guild, member: second.member });
        await bot.handleCenter(off);
        expect(off.deferUpdate).toHaveBeenCalled();
        expect(off.deferReply).not.toHaveBeenCalled();
        expect(second.member.roles.remove).toHaveBeenCalled();
        expect(textOf(answer(off))).toMatch(/^🔕 Abo beendet/);

        // "Abo beenden" never gives the role
        const none = server();
        const noop = click("addonhub:unsub", { guild: none.guild, member: none.member });
        await bot.handleCenter(noop);
        expect(none.member.roles.add).not.toHaveBeenCalled();
        expect(textOf(answer(noop))).toMatch(/^🔕 Abo beendet/);
    });

    it("answers in English for an English member", async () => {
        mockLang = "en";
        try {
            const { guild, member: m } = server();
            const i = click("addonhub:sub", { guild, member: m });
            await bot.handleCenter(i);
            expect(textOf(answer(i))).toBe(`✅ Subscribed: new versions ping you with <@&${ROLE}>.`);
            expect(buttonsOf(answer(i)).map((b) => b.label)).toEqual(["End subscription"]);
        } finally {
            mockLang = "de";
        }
    });

    it("fetches the member when the interaction carries only its raw form", async () => {
        const { guild, member: m } = server();
        const i = click("addonhub:sub", { guild, member: { roles: ["x"] } });
        await bot.handleCenter(i);
        expect(guild.members.fetch).toHaveBeenCalledWith("u1");
        expect(m.roles.add).toHaveBeenCalled();
    });

    it("without an update role (or outside a server) there is nothing to subscribe to", async () => {
        store.setSettings({ roleId: "" });
        const { guild, member: m } = server();
        const i = click("addonhub:sub", { guild, member: m });
        await bot.handleCenter(i);
        expect(textOf(answer(i))).toBe("❌ Es gibt keine Rolle für Update-Pings.");
        expect(m.roles.add).not.toHaveBeenCalled();

        store.setSettings({ roleId: ROLE });
        const dm = click("addonhub:sub");
        await bot.handleCenter(dm);
        expect(textOf(answer(dm))).toBe("❌ Es gibt keine Rolle für Update-Pings.");
    });

    it.each([
        ["no Manage Roles", { manage: false }, "missing Manage Roles"],
        ["the role above the bot", { rolePos: 9 }, "above the bot's highest role"],
        ["the role level with the bot", { rolePos: 5 }, "above the bot's highest role"],
        ["a managed role", { managed: true }, "integration"],
    ])("a role the bot may not hand out (%s): a clear line for the member, a warning in the log", async (_name, opts, reason) => {
        const { guild, member: m } = server(opts);
        const i = click("addonhub:sub", { guild, member: m });
        await bot.handleCenter(i);
        expect(textOf(answer(i))).toBe(SORRY);
        expect(m.roles.add).not.toHaveBeenCalled();
        expect(m.roles.remove).not.toHaveBeenCalled();
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining(reason));
    });

    it("a deleted role (fetch gives null or Unknown Role): the clear line, a warning naming the role", async () => {
        const gone = server();
        gone.guild.roles.cache = new Map();
        const i = click("addonhub:sub", { guild: gone.guild, member: gone.member });
        await bot.handleCenter(i);
        expect(gone.guild.roles.fetch).toHaveBeenCalledWith(ROLE);
        expect(textOf(answer(i))).toBe(SORRY);
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining(`update role ${ROLE} is missing`));

        mockLog.warn.mockClear();
        const unknown = server();
        unknown.guild.roles.cache = new Map();
        unknown.guild.roles.fetch.mockRejectedValue(Object.assign(new Error("Unknown Role"), { code: 10011 }));
        const j = click("addonhub:sub", { guild: unknown.guild, member: unknown.member });
        await bot.handleCenter(j);
        expect(textOf(answer(j))).toBe(SORRY);
        expect(unknown.member.roles.add).not.toHaveBeenCalled();
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining(`update role ${ROLE} is missing`));
    });

    it("Discord refusing the change, a failing role lookup or a missing member: the same line, logged", async () => {
        const failing = server({ addFails: true });
        const i = click("addonhub:sub", { guild: failing.guild, member: failing.member });
        await bot.handleCenter(i);
        expect(textOf(answer(i))).toBe(SORRY);
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Missing Permissions"));

        const broken = server();
        broken.guild.roles.cache = new Map();
        broken.guild.roles.fetch.mockRejectedValue(new Error("Service Unavailable"));
        const j = click("addonhub:sub", { guild: broken.guild, member: broken.member });
        await bot.handleCenter(j);
        expect(textOf(answer(j))).toBe(SORRY);
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Service Unavailable"));

        const away = server();
        away.guild.members.fetch.mockRejectedValue(new Error("Unknown Member"));
        const k = click("addonhub:sub", { guild: away.guild, member: null });
        await bot.handleCenter(k);
        expect(textOf(answer(k))).toBe(SORRY);
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Unknown Member"));
    });

    it("roleProblem: '' when the bot may hand the role out", () => {
        const { guild } = server();
        expect(bot.roleProblem(guild, { position: 1, managed: false })).toBe("");
        expect(bot.roleProblem({ members: {} }, { position: 1 })).toBe("missing Manage Roles");
    });
});

describe("addonCenterBot buttons", () => {
    it("an unknown button of the centre is answered, not left hanging", async () => {
        const i = click("addonhub:what");
        await bot.handleCenter(i);
        expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }));
    });
});

describe("commands/lookup/addonCenterButton", () => {
    it("is the component of the prefix 'addonhub', with the access of /addons and no event-server check", () => {
        expect(button).toMatchObject({ name: "addonhub", accessOf: "addons" });
        expect(button.data).toBeUndefined();
    });
});
