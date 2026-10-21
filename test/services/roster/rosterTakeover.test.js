// rosterTakeover (docs/kaderplaner.md "Übernahme"): one confirmed dialog makes
// role, category and channels, fills the Kader's roster and hands the role out;
// afterwards Kader and Discord stay in step in both directions, without a loop.
// Discord is a fake guild; the stores run on memoryFs.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/services/discord/memberRoles", () => ({
    giveRole: jest.fn(),
    takeRole: jest.fn(),
    recentWrite: jest.fn(() => undefined),
    roleBelowBot: jest.fn(() => true),
}));
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: jest.fn(() => true),
    getGuild: jest.fn(),
    fetchGuildMembersCached: jest.fn(async () => []),
}));
jest.mock("../../../src/services/discord/roleSync", () => ({ canManageRoles: jest.fn(() => true) }));
jest.mock("../../../src/services/discord/discordChannels", () => ({
    botCanManageChannels: jest.fn(() => true),
    discordErrorText: jest.fn((e) => (e && e.message) || "?"),
}));
jest.mock("../../../src/services/roster/rosterCreate", () => ({
    kaderCharacter: jest.fn((p) => (p.characterName ? [p.characterName] : undefined)),
}));
jest.mock("../../../src/stores/raiderProfileStore", () => ({
    getProfile: jest.fn((userId) => ({ userId, name: "", characters: [] })),
    firstCharacter: jest.fn(() => null),
    charactersOfVersion: jest.fn(() => []),
}));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ adminRoleIds: ["adm"], orgaRoleIds: ["orga", "gone"] })),
}));

const fs = require("fs");
const { ChannelType, PermissionsBitField } = require("discord.js");
const memberRoles = require("../../../src/services/discord/memberRoles");
const discord = require("../../../src/services/discord/discord");
const { canManageRoles } = require("../../../src/services/discord/roleSync");
const { botCanManageChannels } = require("../../../src/services/discord/discordChannels");
const kaderStore = require("../../../src/stores/kaderStore");
const rosterStore = require("../../../src/stores/rosterStore");
const kaderRoster = require("../../../src/services/kader/kaderRoster");
const rosterRoleSync = require("../../../src/services/roster/rosterRoleSync");
const takeover = require("../../../src/services/roster/rosterTakeover");

const Flags = PermissionsBitField.Flags;
const U = { a: "111111111111111111", b: "222222222222222222", c: "333333333333333333", d: "444444444444444444", e: "555555555555555555" };
const ok = (roleId, changed = true) => ({ ok: true, code: changed ? "done" : "unchanged", changed, roleId, roleName: roleId.toUpperCase() });

/** A fake guild: roles and channels are created into its caches. */
function fakeGuild({ features = ["ROLE_ICONS"], failChannels = [], failCategory = false, failRole = false } = {}) {
    let n = 0;
    const roles = new Map([["g1", { id: "g1" }], ["adm", { id: "adm" }], ["orga", { id: "orga" }], ["old", { id: "old" }]]);
    const channels = new Map([["cat1", { id: "cat1", name: "Bestand", type: ChannelType.GuildCategory, rawPosition: 2 }],
        ["cat0", { id: "cat0", name: "Oben", type: ChannelType.GuildCategory, rawPosition: 0 }],
        ["t1", { id: "t1", name: "allgemein", type: ChannelType.GuildText, rawPosition: 1 }]]);
    return {
        id: "g1",
        features,
        premiumTier: features.includes("ROLE_ICONS") ? 2 : 0,
        members: { me: { id: "bot" } },
        roles: {
            cache: roles,
            create: jest.fn(async (opts) => {
                if (failRole) throw new Error("Missing Permissions");
                const role = { id: `role${++n}`, name: opts.name, delete: jest.fn(async () => {}) };
                roles.set(role.id, role);
                return role;
            }),
        },
        channels: {
            cache: channels,
            create: jest.fn(async (opts) => {
                if (opts.type === ChannelType.GuildCategory && failCategory) throw new Error("Missing Access");
                if (failChannels.includes(opts.name)) throw new Error("Missing Permissions");
                const ch = { id: `ch${++n}`, name: opts.name, type: opts.type, parent: opts.parent };
                channels.set(ch.id, ch);
                return ch;
            }),
        },
    };
}

/** The planner: a, b, c in takeover states, d in the pool. */
function seedPlanner() {
    kaderStore.writePlanner("g1", {
        v: 2,
        accounts: [],
        assignments: {},
        kaders: [{
            id: "k1",
            name: "Forever 2027",
            players: {
                [U.a]: { state: "roster", decision: { className: "Mage", spec: "Mage-Frost" } },
                [U.b]: { state: "bench" },
                [U.c]: { state: "provisional" },
                [U.d]: { state: "pool" },
            },
        }],
    });
}

const kaderNow = () => kaderStore.readPlanner("g1").kaders.find((k) => k.id === "k1");
const rosterNow = () => rosterStore.getRoster(roster.id);
const body = (extra = {}) => ({
    confirm: true,
    baseRev: kaderRoster.takeoverPlayers("g1", "k1").rev,
    role: { name: "Forever Raider", color: "#3366aa", unicodeEmoji: "⚔️" },
    category: { name: "Forever", emoji: "⚔️" },
    channels: [{ name: "Raid Talk" }, { name: "Ankündigungen", orgaOnlyWrite: true }],
    ...extra,
});

let guild;
let roster;
beforeEach(() => {
    fs.__store.clear();
    jest.clearAllMocks();
    takeover._resetForTests();
    rosterRoleSync._resetForTests();
    guild = fakeGuild();
    discord.getGuild.mockImplementation(() => guild);
    discord.isOnline.mockReturnValue(true);
    discord.fetchGuildMembersCached.mockResolvedValue([]);
    canManageRoles.mockReturnValue(true);
    botCanManageChannels.mockReturnValue(true);
    memberRoles.roleBelowBot.mockReturnValue(true);
    memberRoles.giveRole.mockImplementation(async (g, u, r) => ok(r));
    memberRoles.takeRole.mockImplementation(async (g, u, r) => ok(r));
    seedPlanner();
    roster = rosterStore.createRoster({ name: "Forever", guildId: "g1", roleIds: ["old"], versionId: "forever", kaderId: "k1" });
});

/** Start and wait for the background role hand-out. */
async function startAndWait(b = body(), opts = {}) {
    const res = await takeover.start("g1", "k1", b, { actor: "o1", gapMs: 0, ...opts });
    await takeover.whenIdle("g1", "k1");
    return res;
}

describe("services/roster/rosterTakeover precheck", () => {
    it("lists the players from provisional upwards with server, role and roster state", async () => {
        discord.fetchGuildMembersCached.mockResolvedValue([{ id: U.a, roles: { cache: new Map() } }]);
        const pre = await takeover.precheck("g1", "k1");
        expect(pre.blockers).toEqual([]);
        expect(pre.notes).toEqual([]);
        expect(pre.iconPossible).toBe(true);
        expect(pre.premiumTier).toBe(2);
        expect(pre.roster).toMatchObject({ id: roster.id, closed: false, roleIds: ["old"] });
        expect(pre.players.map((p) => [p.userId, p.state, p.onServer, p.hasRole, p.inRoster])).toEqual([
            [U.a, "roster", true, null, false], [U.b, "bench", false, null, false], [U.c, "provisional", false, null, false],
        ]);
        // the server's categories only for a caller who may start the takeover
        expect(pre.categories).toEqual([]);
        expect((await takeover.precheck("g1", "k1", { withCategories: true })).categories).toEqual([{ id: "cat0", name: "Oben" }, { id: "cat1", name: "Bestand" }]);
        expect(pre.running).toBe(false);
        expect(pre.aborted).toBe(false);
        expect(pre.outsideCount).toBe(0);
    });

    it("counts roster members the Kader does not plan", async () => {
        rosterStore.upsertMember(roster.id, U.e, {});
        rosterStore.upsertMember(roster.id, U.d, {});
        rosterStore.upsertMember(roster.id, U.a, {});
        const pre = await takeover.precheck("g1", "k1");
        expect(pre.notes).toEqual(["roster_members_outside"]);
        expect(pre.outsideCount).toBe(2);
    });

    it("a takeover still running without a job here (bot restarted) is aborted", async () => {
        kaderRoster.saveTakeover("g1", "k1", { rosterId: roster.id, roleId: "old", roleName: "Old", categoryId: "", channelIds: [] }, { actor: "o1" });
        let pre = await takeover.precheck("g1", "k1");
        expect(pre.takeover.status).toBe("running");
        expect(pre).toMatchObject({ running: false, aborted: true });
        // "Rolle nachziehen" finishes it
        expect(await takeover.pullRole("g1", "k1", { actor: "o1", gapMs: 0 })).toEqual({ count: 3, away: 0 });
        await takeover.whenIdle("g1", "k1");
        pre = await takeover.precheck("g1", "k1");
        expect(pre.takeover.status).toBe("done");
        expect(pre.aborted).toBe(false);
    });

    it("answers the role and category of a takeover as Discord has them now", async () => {
        expect(await takeover.precheck("g1", "k1")).toMatchObject({ role: null, category: null });
        guild.roles.cache.set("old", { id: "old", name: "Raider 2027", color: 0x3366cc, hexColor: "#3366cc" });
        kaderRoster.saveTakeover("g1", "k1", { rosterId: roster.id, roleId: "old", roleName: "Alt", categoryId: "cat1", channelIds: [] }, { actor: "o1" });
        let pre = await takeover.precheck("g1", "k1");
        expect(pre.role).toEqual({ id: "old", name: "Raider 2027", color: "#3366cc", gone: false });
        expect(pre.category).toEqual({ id: "cat1", name: "Bestand", gone: false });
        guild.roles.cache.delete("old");
        guild.channels.cache.delete("cat1");
        pre = await takeover.precheck("g1", "k1");
        expect(pre.role).toEqual({ id: "old", name: "Alt", color: "", gone: true });
        expect(pre.category).toEqual({ id: "cat1", name: "", gone: true });
        discord.isOnline.mockReturnValue(false);
        expect(await takeover.precheck("g1", "k1")).toMatchObject({ role: null, category: null });
    });

    it("names every blocker: no roster, offline, no rights, nobody, already taken", async () => {
        rosterStore.deleteRoster(roster.id);
        discord.isOnline.mockReturnValue(false);
        let pre = await takeover.precheck("g1", "k1");
        expect(pre.blockers).toEqual(["no_roster", "offline"]);
        expect(pre.online).toBe(false);
        expect(pre.categories).toEqual([]);
        discord.isOnline.mockReturnValue(true);
        canManageRoles.mockReturnValue(false);
        botCanManageChannels.mockReturnValue(false);
        pre = await takeover.precheck("g1", "k1");
        expect(pre.blockers).toEqual(["no_roster", "no_manage_roles", "no_manage_channels"]);
        await expect(takeover.precheck("g1", "nope")).rejects.toMatchObject({ code: "kader_not_found", status: 404 });
    });

    it("notes icon_not_possible without ROLE_ICONS, and an unknown member list stays null", async () => {
        guild = fakeGuild({ features: [] });
        discord.fetchGuildMembersCached.mockRejectedValue(new Error("no intent"));
        const pre = await takeover.precheck("g1", "k1");
        expect(pre.notes).toEqual(["icon_not_possible"]);
        expect(pre.iconPossible).toBe(false);
        expect(pre.players.every((p) => p.onServer === null && p.hasRole === null)).toBe(true);
    });

    it("gives up on a member list that hangs (no GuildMembers intent)", async () => {
        discord.fetchGuildMembersCached.mockImplementation(() => new Promise(() => {}));
        expect(await takeover.membersOf("g1", guild, { timeoutMs: 5 })).toBeNull();
        expect(await takeover.membersOf("g1", null)).toBeNull();
    });
});

describe("services/roster/rosterTakeover start", () => {
    it("makes role, category and channels, the role the roster's main role, and hands it to everyone", async () => {
        const res = await startAndWait();
        expect(res.assigning).toBe(3);
        expect(res.steps.map((s) => [s.step, s.ok])).toEqual([["role", true], ["roster", true], ["category", true], ["channel", true], ["channel", true]]);
        expect(res.steps[0]).toMatchObject({ icon: "set", name: "Forever Raider" });
        const roleOpts = guild.roles.create.mock.calls[0][0];
        expect(roleOpts).toMatchObject({ name: "Forever Raider", colors: { primaryColor: 0x3366aa }, unicodeEmoji: "⚔️", permissions: [] });
        const roleId = res.steps[0].id;
        // the new role replaces the roster's old roles (they stay in Discord, unsynced)
        expect(rosterNow().roleIds).toEqual([roleId]);

        // the channels: the name rules of docs/channels.md, under the new category
        const [cat, talk, news] = guild.channels.create.mock.calls.map((c) => c[0]);
        expect(cat).toMatchObject({ name: "⚔️・Forever", type: ChannelType.GuildCategory });
        expect(talk).toMatchObject({ name: "raid-talk", type: ChannelType.GuildText, parent: res.steps[2].id });
        expect(news.name).toBe("ankündigungen");
        // only the role and the orga see them; "gone" is no role of the server
        expect(cat.permissionOverwrites).toEqual([
            { id: "g1", deny: [Flags.ViewChannel] },
            { id: roleId, allow: [Flags.ViewChannel], deny: [] },
            { id: "adm", allow: [Flags.ViewChannel, Flags.SendMessages] },
            { id: "orga", allow: [Flags.ViewChannel, Flags.SendMessages] },
            { id: "bot", allow: [Flags.ViewChannel, Flags.SendMessages, Flags.ManageChannels] },
        ]);
        expect(news.permissionOverwrites[1]).toEqual({ id: roleId, allow: [Flags.ViewChannel], deny: [Flags.SendMessages] });

        // everyone joined as core and got the new role
        expect(Object.keys(rosterNow().members).sort()).toEqual([U.a, U.b, U.c]);
        expect(Object.values(rosterNow().members).every((m) => m.status === "core")).toBe(true);
        expect(memberRoles.giveRole.mock.calls).toEqual([["g1", U.a, roleId], ["g1", U.b, roleId], ["g1", U.c, roleId]]);

        const k = kaderNow();
        expect(k.takeover).toMatchObject({
            rosterId: roster.id, roleId, roleName: "Forever Raider", categoryId: res.steps[2].id,
            channelIds: [res.steps[3].id, res.steps[4].id], by: "o1", status: "done",
            results: { [U.a]: "ok", [U.b]: "ok", [U.c]: "ok" },
        });
        expect(k.activity.map((a) => [a.type, a.count || a.playerId || null])).toEqual(expect.arrayContaining([["takeover", null], ["role_given", 3]]));
        expect(k.players[U.a].history.map((h) => h.type)).toContain("role_given");
        expect(kaderRoster.takeoverPlayers("g1", "k1").pending).toEqual([]);
    });

    it("a Kader of provisional players only goes, too", async () => {
        const p = kaderStore.readPlanner("g1");
        for (const e of Object.values(p.kaders[0].players)) if (e.state !== "pool") e.state = "provisional";
        kaderStore.writePlanner("g1", p);
        await startAndWait();
        expect(Object.keys(rosterNow().members)).toHaveLength(3);
    });

    it("without ROLE_ICONS the icon is left out and the step says so", async () => {
        guild = fakeGuild({ features: [] });
        const res = await startAndWait();
        expect(guild.roles.create.mock.calls[0][0].unicodeEmoji).toBeUndefined();
        expect(res.steps[0].icon).toBe("not_possible");
        const plain = await (async () => {
            fs.__store.clear();
            seedPlanner();
            roster = rosterStore.createRoster({ name: "Forever", guildId: "g1", roleIds: [], versionId: "forever", kaderId: "k1" });
            return startAndWait(body({ role: { name: "Raider" } }));
        })();
        expect(plain.steps[0].icon).toBe("none");
        expect(guild.roles.create.mock.calls[1][0].colors).toBeUndefined();
        expect(rosterNow().roleIds).toEqual([plain.steps[0].id]);
    });

    it("uses an existing category as it is", async () => {
        const res = await startAndWait(body({ category: { id: "cat1" }, channels: [{ name: "raid" }] }));
        expect(res.steps[2]).toEqual({ step: "category", ok: true, id: "cat1", name: "Bestand", existing: true });
        expect(guild.channels.create).toHaveBeenCalledTimes(1);
        expect(guild.channels.create.mock.calls[0][0].parent).toBe("cat1");
        expect(kaderNow().takeover.categoryId).toBe("cat1");
    });

    it("reports a failed channel on its own and goes on", async () => {
        guild = fakeGuild({ failChannels: ["raid-talk"] });
        const res = await startAndWait();
        expect(res.steps.map((s) => [s.step, s.ok])).toEqual([["role", true], ["roster", true], ["category", true], ["channel", false], ["channel", true]]);
        expect(res.steps[3]).toMatchObject({ name: "raid-talk", error: "Missing Permissions" });
        expect(kaderNow().takeover.channelIds).toEqual([res.steps[4].id]);
    });

    it("without a category no channel is made, the role still goes out", async () => {
        guild = fakeGuild({ failCategory: true });
        const res = await startAndWait();
        expect(res.steps.slice(2).map((s) => [s.step, s.ok, s.error])).toEqual([
            ["category", false, "Missing Access"], ["channel", false, "keine Kategorie"], ["channel", false, "keine Kategorie"],
        ]);
        expect(kaderNow().takeover).toMatchObject({ categoryId: "", channelIds: [], status: "done" });
    });

    it("keeps every result per player: not on the server, failed", async () => {
        memberRoles.giveRole.mockImplementation(async (g, u, r) => {
            if (u === U.b) return { ok: false, code: "not_member", changed: false, roleId: r, roleName: "" };
            if (u === U.c) return { ok: false, code: "role_too_high", changed: false, roleId: r, roleName: "" };
            return ok(r);
        });
        await startAndWait();
        expect(kaderNow().takeover.results).toEqual({ [U.a]: "ok", [U.b]: "missing", [U.c]: "failed" });
        expect(kaderRoster.takeoverPlayers("g1", "k1").pending).toEqual([U.b, U.c]);
        expect(kaderNow().activity.find((a) => a.type === "role_given")).toMatchObject({ playerId: U.a });
    });

    it("a player already in the roster becomes core; one outside the Kader stays as he is", async () => {
        rosterStore.upsertMember(roster.id, U.a, { status: "trial" });
        rosterStore.upsertMember(roster.id, U.e, { status: "trial" });
        await startAndWait();
        expect(rosterNow().members[U.a].status).toBe("core");
        expect(kaderNow().takeover.results[U.a]).toBe("ok");
        expect(rosterNow().members[U.e].status).toBe("trial");
        expect(kaderNow().players[U.e]).toBeUndefined();
        expect(memberRoles.giveRole.mock.calls.map((c) => c[1])).not.toContain(U.e);
    });

    it("skips a player the orga dropped while the roles go out, and keeps his removal", async () => {
        memberRoles.giveRole.mockImplementation(async (g, u, r) => {
            if (u === U.a) {
                // the orga moves b to the pool between two role writes
                const p = kaderStore.readPlanner("g1");
                p.kaders[0].players[U.b].state = "pool";
                kaderStore.writePlanner("g1", p);
            }
            return ok(r);
        });
        await startAndWait();
        expect(memberRoles.giveRole.mock.calls.map((c) => c[1])).toEqual([U.a, U.c]);
        expect(rosterNow().members[U.b]).toBeUndefined();
        expect(kaderNow().takeover.results).toEqual({ [U.a]: "ok", [U.c]: "ok" });
    });

    it("takes the role back from a player the orga moved while it was written, and his echo changes nothing", async () => {
        let roleId = "";
        memberRoles.giveRole.mockImplementation(async (g, u, r) => {
            roleId = r;
            if (u === U.b) {
                // the orga moves b to the pool right now; its drop ran before b was in the roster
                const p = kaderStore.readPlanner("g1");
                p.kaders[0].players[U.b].state = "pool";
                kaderStore.writePlanner("g1", p);
            }
            return ok(r);
        });
        await startAndWait();
        expect(rosterNow().members[U.b]).toBeUndefined();
        expect(memberRoles.takeRole.mock.calls).toContainEqual(["g1", U.b, roleId]);
        expect(kaderNow().takeover.results).toEqual({ [U.a]: "ok", [U.c]: "ok" });
        // the gateway echo of that give comes late: the tool wrote it, so the Kader stays
        memberRoles.recentWrite.mockImplementation((g, u, r) => (u === U.b && r === roleId ? true : undefined));
        const member = (roles) => ({ id: U.b, partial: false, user: { bot: false }, guild: { id: "g1" }, roles: { cache: new Map(roles.map((x) => [x, {}])) } });
        rosterRoleSync.onGuildMemberUpdate(member([]), member([roleId]));
        expect(kaderNow().players[U.b].state).toBe("pool");
        memberRoles.recentWrite.mockReturnValue(undefined);
    });

    it("a roster member moved while getting the role: dropped meanwhile, the role is taken back", async () => {
        rosterStore.upsertMember(roster.id, U.a, { status: "trial" });
        let roleId = "";
        memberRoles.giveRole.mockImplementation(async (g, u, r) => {
            roleId = r;
            if (u === U.a) {
                // the orga moves a to the pool and its drop removes him before the role is there
                const p = kaderStore.readPlanner("g1");
                p.kaders[0].players[U.a].state = "pool";
                kaderStore.writePlanner("g1", p);
                rosterStore.removeMember(roster.id, U.a);
            }
            return ok(r);
        });
        await startAndWait();
        expect(rosterNow().members[U.a]).toBeUndefined();
        expect(memberRoles.takeRole.mock.calls).toContainEqual(["g1", U.a, roleId]);
        expect(kaderNow().takeover.results).toEqual({ [U.b]: "ok", [U.c]: "ok" });
        expect(kaderNow().players[U.a].state).toBe("pool");
    });

    it("a roster member moved while getting the role and still in the roster leaves it", async () => {
        rosterStore.upsertMember(roster.id, U.a, { status: "trial" });
        memberRoles.giveRole.mockImplementation(async (g, u, r) => {
            if (u === U.a) {
                const p = kaderStore.readPlanner("g1");
                p.kaders[0].players[U.a].state = "pool";
                kaderStore.writePlanner("g1", p);
            }
            return ok(r);
        });
        await startAndWait();
        expect(rosterNow().members[U.a]).toBeUndefined();
        expect(memberRoles.takeRole.mock.calls.map((c) => c[1])).toContain(U.a);
        expect(kaderNow().takeover.results[U.a]).toBeUndefined();
    });

    it("finishing never overwrites a removal from Discord in between", async () => {
        memberRoles.giveRole.mockImplementation(async (g, u, r) => {
            // a lost the role in Discord meanwhile: back to provisional, "removed"
            if (u === U.c) expect(kaderRoster.backToProvisional("g1", "k1", U.a)).toBe(true);
            return ok(r);
        });
        await startAndWait();
        expect(kaderNow().takeover.results[U.a]).toBe("removed");
        expect(kaderNow().takeover.results[U.c]).toBe("ok");
    });

    it("hands nothing out when the record cannot be saved", async () => {
        const spy = jest.spyOn(kaderRoster, "saveTakeover").mockReturnValue(null);
        try {
            const res = await startAndWait();
            expect(res).toMatchObject({ takeover: null, assigning: 0 });
            expect(memberRoles.giveRole).not.toHaveBeenCalled();
            expect((await takeover.precheck("g1", "k1")).running).toBe(false);
        } finally {
            spy.mockRestore();
        }
    });

    it("refuses without confirm or baseRev, and a stale baseRev", async () => {
        await expect(takeover.start("g1", "k1", { ...body(), confirm: false })).rejects.toMatchObject({ code: "confirm_required", status: 400 });
        await expect(takeover.start("g1", "k1", { ...body(), baseRev: undefined })).rejects.toMatchObject({ code: "base_rev_required", status: 400 });
        await expect(takeover.start("g1", "nope", body())).rejects.toMatchObject({ code: "kader_not_found", status: 404 });
        const old = body();
        // a write through the planner moves the rev
        const before = kaderStore.readPlanner("g1");
        const next = JSON.parse(JSON.stringify(before));
        next.kaders[0].name = "Forever 2028";
        kaderStore.writePlanner("g1", require("../../../src/services/kader/kaderActivity").recordChanges(before, next, { actor: "o2" }));
        await expect(takeover.start("g1", "k1", old)).rejects.toMatchObject({ code: "stale", status: 409, details: { kaderId: "k1" } });
        expect(guild.roles.create).not.toHaveBeenCalled();
    });

    it("refuses what cannot work: no roster, closed, offline, no rights, nobody, twice, running", async () => {
        const refused = (b = body()) => takeover.start("g1", "k1", b, { gapMs: 0 });
        canManageRoles.mockReturnValue(false);
        await expect(refused()).rejects.toMatchObject({ code: "no_manage_roles", status: 409 });
        canManageRoles.mockReturnValue(true);
        botCanManageChannels.mockReturnValue(false);
        await expect(refused()).rejects.toMatchObject({ code: "no_manage_channels", status: 409 });
        botCanManageChannels.mockReturnValue(true);
        discord.isOnline.mockReturnValue(false);
        await expect(refused()).rejects.toMatchObject({ code: "offline", status: 503 });
        discord.isOnline.mockReturnValue(true);
        // closing a roster unlinks it from its Kader: the Kader has no roster then
        rosterStore.closeRoster(roster.id, { actor: "o1" });
        await expect(refused()).rejects.toMatchObject({ code: "no_roster", status: 409 });
        expect(guild.roles.create).not.toHaveBeenCalled();
        roster = rosterStore.createRoster({ name: "Forever", guildId: "g1", roleIds: [], versionId: "forever", kaderId: "k1" });
        // a second start while the first is still making the role
        const first = refused();
        await expect(refused()).rejects.toMatchObject({ code: "running", status: 409 });
        await first;
        await takeover.whenIdle("g1", "k1");
        await expect(refused()).rejects.toMatchObject({ code: "already_taken", status: 409 });
    });

    it("refuses a Kader with nobody from provisional upwards", async () => {
        const p = kaderStore.readPlanner("g1");
        for (const e of Object.values(p.kaders[0].players)) e.state = "pool";
        kaderStore.writePlanner("g1", p);
        await expect(takeover.start("g1", "k1", body())).rejects.toMatchObject({ code: "no_players", status: 409 });
    });

    it("checks the input: role name, colour, emoji, category, channels", async () => {
        const bad = (extra) => takeover.start("g1", "k1", body(extra));
        await expect(bad({ role: { name: " " } })).rejects.toMatchObject({ code: "invalid_role", status: 400 });
        await expect(bad({ role: { name: "R", color: "blau" } })).rejects.toMatchObject({ code: "invalid_color" });
        await expect(bad({ role: { name: "R", unicodeEmoji: "<:x:1>" } })).rejects.toMatchObject({ code: "invalid_emoji" });
        await expect(bad({ category: { id: "t1" } })).rejects.toMatchObject({ code: "invalid_category" });
        await expect(bad({ category: {} })).rejects.toMatchObject({ code: "invalid_category" });
        await expect(bad({ channels: [{ name: "" }] })).rejects.toMatchObject({ code: "invalid_channel" });
        await expect(bad({ channels: Array.from({ length: 11 }, (_, i) => ({ name: `k${i}` })) })).rejects.toMatchObject({ code: "too_many_channels" });
        expect(guild.roles.create).not.toHaveBeenCalled();
        // the lock went with every refusal
        expect((await takeover.precheck("g1", "k1")).running).toBe(false);
    });

    it("a role above the bot's role is deleted again, a failed role write refused", async () => {
        memberRoles.roleBelowBot.mockReturnValue(false);
        await expect(takeover.start("g1", "k1", body())).rejects.toMatchObject({ code: "role_too_high", status: 409 });
        const made = [...guild.roles.cache.values()].find((r) => r.name === "Forever Raider");
        expect(made.delete).toHaveBeenCalled();
        expect(rosterNow().roleIds).toEqual(["old"]);
        guild = fakeGuild({ failRole: true });
        await expect(takeover.start("g1", "k1", body())).rejects.toMatchObject({ code: "role_failed", status: 502 });
        expect(kaderNow().takeover).toBeNull();
        expect((await takeover.precheck("g1", "k1")).running).toBe(false);
    });
});

describe("services/roster/rosterTakeover Rolle nachziehen", () => {
    it("gives the role to every pending player, the count right away", async () => {
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        const p = kaderStore.readPlanner("g1");
        p.kaders[0].players[U.d].state = "provisional";
        p.kaders[0].players[U.e] = { state: "roster" };
        kaderStore.writePlanner("g1", p);
        expect(kaderRoster.takeoverPlayers("g1", "k1").pending).toEqual([U.d, U.e]);
        memberRoles.giveRole.mockClear();
        expect(await takeover.pullRole("g1", "k1", { actor: "o1", gapMs: 0 })).toEqual({ count: 2, away: 0 });
        await takeover.whenIdle("g1", "k1");
        expect(memberRoles.giveRole.mock.calls).toEqual([["g1", U.d, roleId], ["g1", U.e, roleId]]);
        expect(kaderRoster.takeoverPlayers("g1", "k1").pending).toEqual([]);
        expect(rosterNow().members[U.e].status).toBe("core");
        expect(await takeover.pullRole("g1", "k1", { gapMs: 0 })).toEqual({ count: 0, away: 0 });
    });

    it("pulls only players on the server; the away ones wait and are counted", async () => {
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        const p = kaderStore.readPlanner("g1");
        p.kaders[0].players[U.d].state = "provisional";
        p.kaders[0].players[U.e] = { state: "roster" };
        kaderStore.writePlanner("g1", p);
        // U.e is on the server, U.d is not (joining later gives nobody the role by itself)
        discord.fetchGuildMembersCached.mockResolvedValue([{ id: U.e, roles: { cache: new Map() } }]);
        const pre = await takeover.precheck("g1", "k1");
        expect(pre).toMatchObject({ pendingCount: 2, pullCount: 1, pendingAway: 1 });
        memberRoles.giveRole.mockClear();
        expect(await takeover.pullRole("g1", "k1", { gapMs: 0 })).toEqual({ count: 1, away: 1 });
        await takeover.whenIdle("g1", "k1");
        expect(memberRoles.giveRole.mock.calls).toEqual([["g1", U.e, roleId]]);
        expect(kaderRoster.takeoverPlayers("g1", "k1").pending).toEqual([U.d]);
        // nobody on the server left to pull: nothing goes out
        expect(await takeover.pullRole("g1", "k1", { gapMs: 0 })).toEqual({ count: 0, away: 1 });
    });

    it("with the member list unknown every pending player counts as pullable", async () => {
        await startAndWait();
        const p = kaderStore.readPlanner("g1");
        p.kaders[0].players[U.d].state = "provisional";
        kaderStore.writePlanner("g1", p);
        discord.fetchGuildMembersCached.mockRejectedValue(new Error("no intent"));
        const pre = await takeover.precheck("g1", "k1");
        expect(pre).toMatchObject({ pendingCount: 1, pullCount: 1, pendingAway: 0 });
    });

    it("refuses before a takeover, for a deleted role and offline", async () => {
        await expect(takeover.pullRole("g1", "k1")).rejects.toMatchObject({ code: "not_taken", status: 409 });
        await expect(takeover.pullRole("g1", "nope")).rejects.toMatchObject({ code: "kader_not_found" });
        const res = await startAndWait();
        guild.roles.cache.delete(res.steps[0].id);
        await expect(takeover.pullRole("g1", "k1")).rejects.toMatchObject({ code: "role_gone" });
        discord.isOnline.mockReturnValue(false);
        await expect(takeover.pullRole("g1", "k1")).rejects.toMatchObject({ code: "offline", status: 503 });
    });
});

describe("services/roster/rosterTakeover sync Kader -> Discord", () => {
    it("drops a player who fell below provisional or left the Kader: out of the roster, roles taken", async () => {
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        const before = kaderStore.readPlanner("g1");
        const after = JSON.parse(JSON.stringify(before));
        after.kaders[0].players[U.b].state = "pool";
        delete after.kaders[0].players[U.c];
        const { drops, lines } = kaderRoster.takeoverDrops(before, require("../../../src/services/kader/kaderModel").normalizePlanner(after), { actor: "o1" });
        expect(drops).toEqual([{ kaderId: "k1", rosterId: roster.id, userId: U.b }, { kaderId: "k1", rosterId: roster.id, userId: U.c }]);
        expect(lines.k1.map((l) => [l.type, l.playerId])).toEqual([["role_removed_kader", U.b], ["role_removed_kader", U.c]]);
        memberRoles.takeRole.mockClear();
        expect(await takeover.dropPlayers(drops, { actor: "o1" })).toBe(2);
        expect(Object.keys(rosterNow().members)).toEqual([U.a]);
        // only the roster's role now; the old one is no longer synced
        expect(memberRoles.takeRole.mock.calls).toEqual([["g1", U.b, roleId], ["g1", U.c, roleId]]);
        // twice is nothing, an unknown roster too
        expect(await takeover.dropPlayers(drops)).toBe(0);
        expect(await takeover.dropPlayers([{ rosterId: "nope", userId: U.a }])).toBe(0);
    });

    it("no loop: the role events of the drop find no member and touch the Kader not", async () => {
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        await takeover.dropPlayers([{ kaderId: "k1", rosterId: roster.id, userId: U.b }]);
        const rev = kaderNow().rev;
        const member = (roles) => ({ id: U.b, partial: false, user: { bot: false }, guild: { id: "g1" }, roles: { cache: new Map(roles.map((r) => [r, {}])) } });
        rosterRoleSync.onGuildMemberUpdate(member([roleId, "old"]), member([]));
        expect(kaderNow().rev).toBe(rev);
        expect(kaderNow().players[U.b].state).toBe("bench");
    });
});

describe("services/roster/rosterTakeover sync Discord -> Kader", () => {
    const member = (uid, roles) => ({ id: uid, partial: false, user: { bot: false }, guild: { id: "g1" }, roles: { cache: new Map(roles.map((r) => [r, {}])) } });

    it("a member who lost every roster role goes back to provisional and out of the roster", async () => {
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        rosterRoleSync.onGuildMemberUpdate(member(U.a, [roleId]), member(U.a, []));
        expect(rosterNow().members[U.a]).toBeUndefined();
        const k = kaderNow();
        expect(k.players[U.a].state).toBe("provisional");
        expect(k.players[U.a].history.slice(-1)[0]).toMatchObject({ type: "role_removed_discord", from: "roster", to: "provisional" });
        expect(k.takeover.results[U.a]).toBe("removed");
        expect(k.activity.slice(-1)[0]).toMatchObject({ type: "role_removed_discord", playerId: U.a });
        // provisional is no nachziehen and no drop: no loop
        expect(kaderRoster.takeoverPlayers("g1", "k1").pending).toEqual([]);
    });

    it("the old roster role no longer counts: holding it does not keep a member", async () => {
        const res = await startAndWait();
        rosterRoleSync.onGuildMemberUpdate(member(U.a, [res.steps[0].id, "old"]), member(U.a, ["old"]));
        expect(rosterNow().members[U.a]).toBeUndefined();
        expect(kaderNow().players[U.a].state).toBe("provisional");
    });

    it("the new signature removes nobody: old-role holders outside the Kader stay in the roster", async () => {
        const holder = (uid, roles) => ({ id: uid, user: { bot: false }, roles: { cache: new Map(roles.map((r) => [r, {}])) } });
        rosterStore.upsertMember(roster.id, U.e, {});
        discord.fetchGuildMembersCached.mockResolvedValue([holder(U.e, ["old"])]);
        await rosterRoleSync.reconcile("g1");
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        // e kept only the old role, only a is listed with the new one
        discord.fetchGuildMembersCached.mockResolvedValue([holder(U.e, ["old"]), holder(U.a, [roleId])]);
        const out = await rosterRoleSync.reconcile("g1");
        expect(out).toMatchObject({ removed: 0, held: [] });
        expect(Object.keys(rosterNow().members).sort()).toEqual([U.a, U.b, U.c, U.e]);
        // the same signature again: still nobody lost, e never held the new role
        expect((await rosterRoleSync.reconcile("g1")).removed).toBe(0);
        expect(rosterNow().members[U.e]).toBeDefined();
        expect(kaderNow().players[U.e]).toBeUndefined();
    });

    it("a role given by hand puts a newcomer into the Kader as provisional", async () => {
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        const named = { ...member(U.e, [roleId]), displayName: "Neuling" };
        rosterRoleSync.onGuildMemberUpdate(member(U.e, []), named);
        expect(rosterNow().members[U.e]).toMatchObject({ status: "core" });
        const k = kaderNow();
        expect(k.players[U.e]).toMatchObject({ state: "provisional", name: "Neuling" });
        expect(k.players[U.e].history).toEqual([expect.objectContaining({ type: "role_added_discord", to: "provisional" })]);
        expect(k.takeover.results[U.e]).toBe("ok");
        expect(k.activity.filter((a) => a.playerId === U.e).map((a) => a.type)).toEqual(["role_added_discord"]);
        // nothing to nachziehen, nothing to drop: no loop
        expect(kaderRoster.takeoverPlayers("g1", "k1").pending).toEqual([]);
    });

    it("a pool player who gets the role moves up; a planned one stays as he is", async () => {
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        rosterRoleSync.onGuildMemberUpdate(member(U.d, []), member(U.d, [roleId]));
        expect(kaderNow().players[U.d].state).toBe("provisional");
        expect(kaderNow().players[U.d].history.slice(-1)[0]).toMatchObject({ type: "role_added_discord", from: "pool", to: "provisional" });
        const rev = kaderNow().rev;
        // a roster member gaining it again (the takeover's own write) changes nothing
        rosterRoleSync.onGuildMemberUpdate(member(U.a, []), member(U.a, [roleId]));
        expect(kaderNow().rev).toBe(rev);
        expect(kaderNow().players[U.a].state).toBe("roster");
    });

    it("onRoleGained asks the cheap stillPlanned first and reads the takeover only for others", async () => {
        await startAndWait();
        const spy = jest.spyOn(kaderRoster, "takeoverPlayers");
        try {
            expect(takeover.onRoleGained(rosterNow(), U.a)).toBe(false);
            expect(spy).not.toHaveBeenCalled();
            expect(takeover.onRoleGained(rosterNow(), U.d)).toBe(true);
            expect(spy).toHaveBeenCalledTimes(1);
        } finally {
            spy.mockRestore();
        }
    });

    it("a deleted Kader: gaining or losing the role changes nothing", async () => {
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        const p = kaderStore.readPlanner("g1");
        p.kaders = [];
        kaderStore.writePlanner("g1", p);
        const before = JSON.stringify(kaderStore.readPlanner("g1"));
        rosterRoleSync.onGuildMemberUpdate(member(U.e, []), member(U.e, [roleId]));
        rosterRoleSync.onGuildMemberUpdate(member(U.a, [roleId]), member(U.a, []));
        expect(JSON.stringify(kaderStore.readPlanner("g1"))).toBe(before);
        expect(takeover.onRoleGained(rosterNow(), U.d)).toBe(false);
        expect(takeover.onRoleLost(rosterNow(), U.b)).toBe(false);
        // the roster itself still follows its role
        expect(rosterNow().members[U.e]).toBeDefined();
        expect(rosterNow().members[U.a]).toBeUndefined();
    });

    it("onRoleGained leaves a roster alone that is no takeover's", async () => {
        expect(takeover.onRoleGained(rosterNow(), U.e)).toBe(false);
        expect(takeover.onRoleGained({ id: "x" }, U.e)).toBe(false);
        expect(takeover.onRoleGained(null, U.e)).toBe(false);
        await startAndWait();
        const other = { ...rosterNow(), id: "andere" };
        expect(takeover.onRoleGained(other, U.e)).toBe(false);
        expect(kaderNow().players[U.e]).toBeUndefined();
    });

    it("a second loss changes nothing; the orga moving the player makes him pending again", async () => {
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        rosterRoleSync.onGuildMemberUpdate(member(U.c, [roleId]), member(U.c, []));
        expect(kaderNow().players[U.c].state).toBe("provisional");
        expect(kaderRoster.backToProvisional("g1", "k1", U.c)).toBe(false);
        const before = kaderStore.readPlanner("g1");
        const after = JSON.parse(JSON.stringify(before));
        after.kaders[0].players[U.c].state = "roster";
        const normalized = require("../../../src/services/kader/kaderModel").normalizePlanner(after);
        const { drops } = kaderRoster.takeoverDrops(before, normalized);
        expect(drops).toEqual([]);
        expect(normalized.kaders[0].takeover.results[U.c]).toBeUndefined();
    });

    it("a failing handler only logs; the member is out of the roster anyway", async () => {
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        rosterRoleSync.setRoleLostHandler(() => { throw new Error("boom"); });
        try {
            rosterRoleSync.onGuildMemberUpdate(member(U.a, [roleId]), member(U.a, []));
            expect(rosterNow().members[U.a]).toBeUndefined();
            expect(kaderNow().players[U.a].state).toBe("roster");
        } finally {
            rosterRoleSync.setRoleLostHandler(takeover.onRoleLost);
        }
    });

    it("without a registered handler the Kader is left alone", async () => {
        const res = await startAndWait();
        const roleId = res.steps[0].id;
        rosterRoleSync.setRoleLostHandler("not a function");
        try {
            rosterRoleSync.onGuildMemberUpdate(member(U.a, [roleId]), member(U.a, []));
            expect(rosterNow().members[U.a]).toBeUndefined();
            expect(kaderNow().players[U.a].state).toBe("roster");
        } finally {
            rosterRoleSync.setRoleLostHandler(takeover.onRoleLost);
        }
    });

    it("leaves a roster alone that is no takeover's", () => {
        expect(takeover.onRoleLost(rosterNow(), U.a)).toBe(false);
        expect(takeover.onRoleLost({ id: "x" }, U.a)).toBe(false);
        expect(takeover.onRoleLost(null, U.a)).toBe(false);
    });
});

describe("services/roster/rosterTakeover helpers", () => {
    it("maps role write results", () => {
        expect(takeover.resultOf(null)).toBe("failed");
        expect(takeover.resultOf({ ok: true })).toBe("ok");
        expect(takeover.resultOf({ code: "unchanged" })).toBe("ok");
        expect(takeover.resultOf({ code: "not_member" })).toBe("missing");
        expect(takeover.resultOf({ code: "role_too_high" })).toBe("failed");
    });

    it("handOut never throws: a closed roster and a throwing write are failures", async () => {
        memberRoles.giveRole.mockRejectedValue(new Error("boom"));
        rosterStore.upsertMember(roster.id, U.a, {});
        expect(await takeover.handOut(roster.id, "old", [{ userId: U.a }], { gapMs: 0 })).toEqual({ [U.a]: "failed" });
        expect(await takeover.handOut("nope", "old", [{ userId: U.a }], { gapMs: 0 })).toEqual({ [U.a]: "failed" });
    });
});
