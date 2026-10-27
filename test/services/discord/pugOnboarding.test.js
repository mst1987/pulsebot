// Roles and onboarding of a PuG server (src/services/discord/pugOnboarding.js, #906): the
// desired state from the settings, the difference to what Discord has, the prerequisites
// and the apply that calls Discord only for what differs (roles, rights, onboarding last).
const { PermissionsBitField, Collection } = require("discord.js");

let mockConfig = {};
let mockOnline = true;
let mockGuild = null;
const mockSaved = [];
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: () => mockOnline,
    getGuild: (id) => (mockGuild && mockGuild.id === id ? mockGuild : null),
    getClient: () => null,
}));
jest.mock("../../../src/stores/configStore", () => ({
    getConfig: () => mockConfig,
    saveConfig: (partial) => { mockSaved.push(partial); mockConfig = { ...mockConfig, ...partial }; return mockConfig; },
}));
jest.mock("../../../src/stores/rosterStore", () => ({
    listRosters: () => [],
    rosterForCategory: () => null,
    isClosed: () => false,
}));

const svc = require("../../../src/services/discord/pugOnboarding");

const GID = "900000000000000001";
const TBC_CAT = "800000000000000001";
const FOREVER_CAT = "800000000000000002";
const GUILD_CAT = "800000000000000003";
const RAIDER_ROLE = "600000000000000001";
const F = PermissionsBitField.Flags;

// ---- a fake guild with everything apply touches ------------------------------

function makeRole({ id, name, color = "#000000", position = 1, managed = false, permissions = null }) {
    const role = { id, name, hexColor: color, position, managed, editable: true };
    if (permissions !== null) role.permissions = new PermissionsBitField(permissions);
    role.edit = jest.fn(async (patch) => {
        if (patch.name) role.name = patch.name;
        if (patch.colors) role.hexColor = patch.colors.primaryColor;
        return role;
    });
    return role;
}

function overwrites(entries = {}) {
    const cache = new Map();
    const set = (id, view) => {
        const allow = new PermissionsBitField(view === true ? [F.ViewChannel] : []);
        const deny = new PermissionsBitField(view === false ? [F.ViewChannel] : []);
        cache.set(id, { id, allow, deny });
    };
    for (const [id, view] of Object.entries(entries)) set(id, view);
    return { cache, edit: jest.fn(async (id, opts) => set(id, opts.ViewChannel)) };
}

function prompt({ id, title, required = false, options = [] }) {
    return {
        id, title, required, singleSelect: false, inOnboarding: true, type: 0,
        options: new Collection(options.map((o) => [o.id, {
            id: o.id, title: o.title, description: o.description || null, _emoji: o.emoji || null,
            roles: new Collection((o.roleIds || []).map((r) => [r, { id: r }])),
            channels: new Collection((o.channelIds || []).map((c) => [c, { id: c }])),
        }])),
    };
}

/** A text channel in a category; `synced` = permissionsLocked, lockPermissions copies the parent. */
function child(channels, { id, parentId, name, synced = true, rights = {} }) {
    const ch = { id, parentId, name, type: 0, permissionsLocked: synced, permissionOverwrites: overwrites(rights) };
    ch.lockPermissions = jest.fn(async () => {
        ch.permissionOverwrites.cache = new Map(channels.get(parentId).permissionOverwrites.cache);
        ch.permissionsLocked = true;
        return ch;
    });
    return ch;
}

let nextRole = 0;
function guild({
    features = ["COMMUNITY"], rights = [F.ManageRoles, F.ManageGuild], roles = [], prompts = [], categories = {},
    top = 50, children = [], access = null,
} = {}) {
    const roleCache = new Map(roles.map((r) => [r.id, r]));
    const channels = new Map();
    const names = { [TBC_CAT]: "TBC PuGs", [FOREVER_CAT]: "Forever PuGs", [GUILD_CAT]: "Gilde" };
    for (const id of [TBC_CAT, FOREVER_CAT, GUILD_CAT]) {
        const cat = { id, name: names[id], type: 4, permissionOverwrites: overwrites(categories[id] || {}) };
        if (access) cat.permissionsFor = () => new PermissionsBitField(access[id] || [F.ViewChannel, F.ManageRoles]);
        channels.set(id, cat);
    }
    for (const c of children) channels.set(c.id, child(channels, c));
    const g = {
        id: GID,
        name: "PuG-Server",
        features,
        channels: { cache: channels, fetch: jest.fn(async (id) => channels.get(id)) },
        members: { me: { id: "bot", permissions: new PermissionsBitField(rights), roles: { highest: { position: top } } } },
        roles: {
            cache: roleCache,
            everyone: { id: GID, permissions: new PermissionsBitField([F.ViewChannel, F.SendMessages]) },
            create: jest.fn(async ({ name, colors }) => {
                nextRole += 1;
                const role = makeRole({ id: `7000000000000000${String(nextRole).padStart(2, "0")}`, name, color: colors.primaryColor || "#000000" });
                roleCache.set(role.id, role);
                return role;
            }),
            fetch: jest.fn(async () => roleCache),
        },
        onboarding: { prompts, defaultChannels: new Collection([["c1", { id: "c1" }]]), enabled: true, mode: 0 },
    };
    g.fetchOnboarding = jest.fn(async () => ({ ...g.onboarding, prompts: new Collection(g.onboarding.prompts.map((p) => [p.id, p])) }));
    g.editOnboarding = jest.fn(async (payload) => {
        g.onboarding.prompts = payload.prompts.map((p) => prompt({ id: p.id, title: p.title, required: p.required, options: p.options.map((o) => ({ id: o.id, title: o.title, roleIds: o.roles })) }));
        return g.onboarding;
    });
    return g;
}

const baseConfig = (over = {}) => ({
    categoryIds: [TBC_CAT, FOREVER_CAT, GUILD_CAT],
    categoryVersion: { [TBC_CAT]: "tbc", [FOREVER_CAT]: "forever", [GUILD_CAT]: "tbc" },
    categoryRoles: { [GUILD_CAT]: [RAIDER_ROLE] },
    ...over,
});

/** apply with the fingerprint of the preview the orga just saw (as the web sends it). */
async function run(opts = {}) {
    const { fingerprint } = await svc.overview(GID, mockConfig, { categoryIds: opts.categoryIds });
    return svc.apply(GID, { actor: "a", fingerprint, ...opts });
}

/** Every Discord write of the fake guild, to prove "nothing was written". */
function writes() {
    const g = mockGuild;
    const ow = [...g.channels.cache.values()].flatMap((c) => c.permissionOverwrites.edit.mock.calls);
    const roleEdits = [...g.roles.cache.values()].flatMap((r) => (r.edit ? r.edit.mock.calls : []));
    return g.roles.create.mock.calls.length + ow.length + roleEdits.length + g.editOnboarding.mock.calls.length;
}

beforeEach(() => {
    mockConfig = baseConfig();
    mockOnline = true;
    mockGuild = guild();
    mockSaved.length = 0;
    nextRole = 0;
});

// ---- desired state ------------------------------------------------------------

describe("desiredState", () => {
    test("two versions: a version role each, the classes of both once, two questions", () => {
        const d = svc.desiredState([
            { id: FOREVER_CAT, name: "Forever PuGs", versionId: "forever" },
            { id: TBC_CAT, name: "TBC PuGs", versionId: "tbc" },
        ]);
        expect(d.versions.map((v) => v.name)).toEqual(["TBC Anniversary", "WoW Forever"]);
        expect(d.versions[0].categoryIds).toEqual([TBC_CAT]);
        expect(d.classes.map((c) => c.name)).toEqual(expect.arrayContaining(["Warrior", "Paladin", "Hunter", "Druid"]));
        expect(d.classes).toHaveLength(9);
        expect(new Set(d.classes.map((c) => c.key)).size).toBe(9);
        expect(d.classes.find((c) => c.id === "Warrior").color).toBe("#c79c6e");
        expect(d.prompts.map((p) => [p.title, p.required])).toEqual([[svc.VERSION_PROMPT, true], [svc.CLASS_PROMPT, false]]);
        expect(d.prompts[0].options.map((o) => o.title)).toEqual(["TBC Anniversary", "WoW Forever"]);
        expect(d.prompts[1].options).toHaveLength(9);
        expect(d.categories.map((c) => c.roleKey)).toEqual(["version:forever", "version:tbc"]);
    });

    test("one version: one version role, its classes", () => {
        const d = svc.desiredState([{ id: TBC_CAT, name: "TBC PuGs", versionId: "tbc" }]);
        expect(d.versions.map((v) => v.key)).toEqual(["version:tbc"]);
        expect(d.prompts[0].options).toHaveLength(1);
        expect(d.classes).toHaveLength(9);
    });

    test("no PuG category: nothing to set up", () => {
        expect(svc.desiredState([])).toEqual({ versions: [], classes: [], prompts: [], categories: [] });
    });

    test("only open raid categories on the server are PuG categories", () => {
        const { pug, other } = svc.serverCategories(mockGuild, mockConfig);
        expect(pug.map((c) => [c.id, c.versionId, c.fallback])).toEqual([[FOREVER_CAT, "forever", false], [TBC_CAT, "tbc", false]]);
        expect(other).toEqual([{ id: GUILD_CAT, name: "Gilde", rule: "roles" }]);
    });

    test("a category without a known version plays the default, marked as fallback", () => {
        mockConfig = baseConfig({ categoryVersion: { [FOREVER_CAT]: "forever" } });
        const { pug } = svc.serverCategories(mockGuild, mockConfig);
        expect(pug.find((c) => c.id === TBC_CAT)).toMatchObject({ versionId: "tbc", fallback: true });
        mockConfig = baseConfig({ categoryVersion: {}, mainVersion: "tbc" });
        expect(svc.serverCategories(mockGuild, mockConfig).pug.every((c) => !c.fallback)).toBe(true);
    });
});

// ---- difference -----------------------------------------------------------------

const statusOf = (list, key) => (list.find((x) => x.key === key || x.title === key || x.id === key) || {}).status;

describe("overview / diff", () => {
    test("an empty server: every role and both questions new, every category changed", async () => {
        const o = await svc.overview(GID);
        expect(o.online).toBe(true);
        expect(o.roles.every((r) => r.status === "new")).toBe(true);
        expect(o.prompts.map((p) => p.status)).toEqual(["new", "new"]);
        expect(o.categories.map((c) => [c.id, c.missing])).toEqual([
            [FOREVER_CAT, ["everyone", "version", "bot"]],
            [TBC_CAT, ["everyone", "version", "bot"]],
        ]);
        expect(o.changes).toBe(2 + 9 + 2 + 2);
        expect(o.otherCategories.map((c) => c.id)).toEqual([GUILD_CAT]);
        expect(o.pugCategories.every((c) => c.selected)).toBe(true);
        expect(o.prerequisites.filter((p) => p.ok !== true).map((p) => [p.key, p.ok])).toEqual([["categoryAccess", null]]);
        expect(o.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    });

    test("a role found by name keeps its id; a wrong colour is changed", async () => {
        mockGuild = guild({ roles: [makeRole({ id: "r-war", name: "warrior", color: "#ffffff" }), makeRole({ id: "r-tbc", name: "TBC Anniversary" })] });
        const o = await svc.overview(GID);
        const warrior = o.roles.find((r) => r.key === "class:Warrior");
        expect(warrior).toMatchObject({ status: "changed", roleId: "r-war", current: { name: "warrior", color: "#ffffff" }, privileged: null });
        expect(o.roles.find((r) => r.key === "version:tbc")).toMatchObject({ status: "same", roleId: "r-tbc" });
        expect(statusOf(o.roles, "class:Mage")).toBe("new");
    });

    test("the saved id wins over the name", async () => {
        mockConfig = baseConfig({ pugRoles: { [GID]: { versions: { tbc: "r-old" }, classes: {} } } });
        mockGuild = guild({ roles: [makeRole({ id: "r-old", name: "TBC" }), makeRole({ id: "r-new", name: "TBC Anniversary" })] });
        const o = await svc.overview(GID);
        expect(o.roles.find((r) => r.key === "version:tbc")).toMatchObject({ status: "changed", roleId: "r-old", privileged: null });
    });

    test("a question the orga added by hand is lost, an extra option too", async () => {
        mockGuild = guild({
            roles: [makeRole({ id: "r-tbc", name: "TBC Anniversary" })],
            prompts: [
                prompt({ id: "p1", title: svc.VERSION_PROMPT, required: true, options: [
                    { id: "o1", title: "TBC Anniversary", roleIds: ["r-tbc"] },
                    { id: "o2", title: "Retail", roleIds: [] },
                ] }),
                prompt({ id: "p9", title: "Where did you find us?", options: [{ id: "o9", title: "Reddit" }] }),
            ],
        });
        const o = await svc.overview(GID);
        const versions = o.prompts.find((p) => p.key === "versions");
        expect(versions.status).toBe("changed");
        expect(versions.options.map((x) => [x.title, x.status])).toEqual([
            ["TBC Anniversary", "same"], ["WoW Forever", "new"], ["Retail", "lost"],
        ]);
        expect(o.prompts.find((p) => p.id === "p9")).toMatchObject({ status: "lost", title: "Where did you find us?" });
    });

    test("a category already set up is unchanged; one without rights lists what is missing", async () => {
        mockGuild = guild({
            roles: [makeRole({ id: "r-tbc", name: "TBC Anniversary" })],
            categories: { [TBC_CAT]: { [GID]: false, "r-tbc": true, bot: true }, [FOREVER_CAT]: { bot: true } },
        });
        const o = await svc.overview(GID);
        expect(o.categories.find((c) => c.id === TBC_CAT)).toMatchObject({ status: "same", missing: [] });
        expect(o.categories.find((c) => c.id === FOREVER_CAT)).toMatchObject({ status: "changed", missing: ["everyone", "version"] });
    });

    test("orga roles of the server must keep seeing the category", async () => {
        mockConfig = baseConfig({ orgaRoleIds: ["r-orga", "r-elsewhere"] });
        mockGuild = guild({ roles: [makeRole({ id: "r-orga", name: "Orga" })], categories: { [TBC_CAT]: { "r-orga": true } } });
        const o = await svc.overview(GID);
        expect(o.categories.find((c) => c.id === FOREVER_CAT)).toMatchObject({ missing: ["everyone", "version", "orga", "bot"], orga: [{ id: "r-orga", name: "Orga" }] });
        expect(o.categories.find((c) => c.id === TBC_CAT).orga).toEqual([]);
    });

    test("channels in a category: synced ones follow it, unsynced visible ones are named", async () => {
        mockGuild = guild({ children: [
            { id: "ch-sync", parentId: TBC_CAT, name: "anmeldung" },
            { id: "ch-own", parentId: TBC_CAT, name: "offen", synced: false },
            { id: "ch-hidden", parentId: TBC_CAT, name: "versteckt", synced: false, rights: { [GID]: false } },
        ] });
        const tbc = (await svc.overview(GID)).categories.find((c) => c.id === TBC_CAT);
        expect(tbc.synced).toEqual([{ id: "ch-sync", name: "anmeldung" }]);
        expect(tbc.unsynced).toEqual([{ id: "ch-own", name: "offen" }]);
    });

    test("an unreadable onboarding is reported, not thrown", async () => {
        mockGuild.fetchOnboarding = jest.fn(async () => { throw Object.assign(new Error("Missing Permissions"), { code: 50013 }); });
        const o = await svc.overview(GID);
        expect(o.onboarding).toBeNull();
        expect(o.onboardingError).toBeTruthy();
        expect(o.prompts.map((p) => p.status)).toEqual(["new", "new"]);
    });

    test("prerequisites: no Community, missing rights, a role above the bot", async () => {
        mockGuild = guild({ features: [], rights: [F.ManageRoles], roles: [makeRole({ id: "r-tbc", name: "TBC Anniversary", position: 60 })] });
        const o = await svc.overview(GID);
        const pre = Object.fromEntries(o.prerequisites.map((p) => [p.key, p]));
        expect(pre.community.ok).toBe(false);
        expect(pre.manageRoles.ok).toBe(true);
        expect(pre.manageGuild.ok).toBe(false);
        expect(pre.roleOrder).toMatchObject({ ok: false, roles: ["TBC Anniversary"] });
    });

    test("without Manage Roles the role order is unknown, not a second blocker", async () => {
        mockGuild = guild({ rights: [F.ManageGuild], roles: [makeRole({ id: "r-tbc", name: "TBC Anniversary", position: 60 })] });
        const pre = Object.fromEntries((await svc.overview(GID)).prerequisites.map((p) => [p.key, p]));
        expect(pre.manageRoles.ok).toBe(false);
        expect(pre.roleOrder).toMatchObject({ ok: null, roles: [] });
    });

    test("the bot's access per category: a category without Manage Roles is named", async () => {
        mockGuild = guild({ access: { [TBC_CAT]: [F.ViewChannel] } });
        const pre = (await svc.overview(GID)).prerequisites.find((p) => p.key === "categoryAccess");
        expect(pre).toMatchObject({ ok: false, categories: ["TBC PuGs"] });
    });

    test("bot offline: no Discord read", async () => {
        mockOnline = false;
        expect(await svc.overview(GID)).toEqual({ guildId: GID, guildName: "", online: false, applied: null });
    });

    test("a switched-off category leaves the set: only the selected versions, its own fingerprint", async () => {
        const all = await svc.overview(GID);
        const o = await svc.overview(GID, mockConfig, { categoryIds: [TBC_CAT] });
        expect(o.pugCategories.map((c) => [c.id, c.selected])).toEqual([[FOREVER_CAT, false], [TBC_CAT, true]]);
        expect(o.roles.filter((r) => r.kind === "version").map((r) => r.key)).toEqual(["version:tbc"]);
        expect(o.categories.map((c) => c.id)).toEqual([TBC_CAT]);
        expect(o.fingerprint).not.toBe(all.fingerprint);
        const none = await svc.overview(GID, mockConfig, { categoryIds: [] });
        expect(none.roles).toEqual([]);
        expect(none.changes).toBe(0);
    });
});

describe("firstPugServer", () => {
    const servers = (...ids) => ({ discordServers: { servers: ids.map((guildId) => ({ guildId })) } });

    test("the first listed server whose guild has a PuG category", () => {
        expect(svc.firstPugServer(baseConfig(servers("111", GID)))).toBe(GID);
    });

    test("no server with a PuG category, or the bot offline: empty", () => {
        expect(svc.firstPugServer(baseConfig({ ...servers(GID), categoryRoles: { [TBC_CAT]: [RAIDER_ROLE], [FOREVER_CAT]: [RAIDER_ROLE], [GUILD_CAT]: [RAIDER_ROLE] } }))).toBe("");
        expect(svc.firstPugServer(baseConfig())).toBe("");
        mockOnline = false;
        expect(svc.firstPugServer(baseConfig(servers(GID)))).toBe("");
    });
});

// ---- self-assignment: a found role must grant nothing beyond its purpose --------

describe("privileged roles", () => {
    test.each([
        ["Administrator", makeRole({ id: "r-mage", name: "Mage", permissions: [F.Administrator] }), "permissions"],
        ["a raider role of a category", makeRole({ id: RAIDER_ROLE, name: "Mage" }), "categoryRaider"],
    ])("%s: shown in the preview, the apply refuses with 409 and writes nothing", async (_label, role, code) => {
        mockGuild = guild({ roles: [role] });
        const o = await svc.overview(GID);
        expect(o.roles.find((r) => r.key === "class:Mage").privileged).toMatchObject({ code });
        expect(o.prerequisites.find((p) => p.key === "selfAssign")).toMatchObject({ ok: false, roles: ["Mage"] });
        await expect(run()).rejects.toMatchObject({ status: 409, code: "role_privileged" });
        expect(writes()).toBe(0);
        expect(mockSaved).toHaveLength(0);
    });

    test("a default channel the apply would hide: warned in the preview, the apply refuses with 409 and writes nothing", async () => {
        mockGuild = guild({ children: [
            { id: "ch-def", parentId: TBC_CAT, name: "pug-info", synced: true },
            { id: "ch-own", parentId: FOREVER_CAT, name: "regeln", synced: false },
        ] });
        mockGuild.onboarding.defaultChannels = new Collection([["c1", { id: "c1" }], ["ch-def", { id: "ch-def" }], ["ch-own", { id: "ch-own" }]]);
        const o = await svc.overview(GID);
        expect(o.prerequisites.find((p) => p.key === "defaultChannels")).toEqual({ key: "defaultChannels", ok: false, channels: ["pug-info"] });
        await expect(run()).rejects.toMatchObject({ status: 409, code: "default_channel_hidden" });
        expect(writes()).toBe(0);
        expect(mockSaved).toHaveLength(0);
        // the category of that channel switched off: nothing hidden, the apply goes through
        const off = await svc.overview(GID, mockConfig, { categoryIds: [FOREVER_CAT] });
        expect(off.prerequisites.find((p) => p.key === "defaultChannels").ok).toBe(true);
        await expect(run({ categoryIds: [FOREVER_CAT] })).resolves.toBeTruthy();
    });

    test("a default channel that is a PuG category itself counts too; an unreadable onboarding leaves it unknown", async () => {
        mockGuild.onboarding.defaultChannels = new Collection([[TBC_CAT, { id: TBC_CAT }]]);
        const pre = (await svc.overview(GID)).prerequisites.find((p) => p.key === "defaultChannels");
        expect(pre).toMatchObject({ ok: false, channels: ["TBC PuGs"] });
        mockGuild.fetchOnboarding = jest.fn(async () => { throw new Error("nope"); });
        expect((await svc.overview(GID)).prerequisites.find((p) => p.key === "defaultChannels")).toMatchObject({ ok: null, channels: [] });
    });

    test("an orga role found by name is privileged", async () => {
        mockConfig = baseConfig({ orgaRoleIds: ["r-druid"] });
        mockGuild = guild({ roles: [makeRole({ id: "r-druid", name: "Druid" })] });
        const o = await svc.overview(GID);
        expect(o.roles.find((r) => r.key === "class:Druid").privileged).toMatchObject({ code: "orga" });
    });

    test("a channel the role unlocks is named; the version role's own categories are its purpose", async () => {
        mockGuild = guild({
            roles: [makeRole({ id: "r-tbc", name: "TBC Anniversary" }), makeRole({ id: "r-war", name: "Warrior" })],
            categories: { [TBC_CAT]: { "r-tbc": true }, [GUILD_CAT]: { "r-war": true } },
            children: [{ id: "ch-tbc", parentId: TBC_CAT, name: "anmeldung", synced: false, rights: { "r-tbc": true } }],
        });
        const o = await svc.overview(GID);
        expect(o.roles.find((r) => r.key === "version:tbc").privileged).toBeNull();
        expect(o.roles.find((r) => r.key === "class:Warrior").privileged).toEqual({ code: "channel", detail: "Gilde" });
    });

    test("the version role on a category of another version is privileged", async () => {
        mockGuild = guild({ roles: [makeRole({ id: "r-tbc", name: "TBC Anniversary" })], categories: { [FOREVER_CAT]: { "r-tbc": true } } });
        const o = await svc.overview(GID);
        expect(o.roles.find((r) => r.key === "version:tbc").privileged).toEqual({ code: "channel", detail: "Forever PuGs" });
    });

    test("after an apply its own stored version roles are not privileged", async () => {
        await run();
        const o = await svc.overview(GID);
        expect(o.roles.every((r) => r.privileged === null)).toBe(true);
        expect(o.changes).toBe(0);
    });
});

// ---- apply ------------------------------------------------------------------------

describe("apply", () => {
    test("an empty server: roles, then rights, the onboarding last; ids and who applied stored", async () => {
        const order = [];
        mockGuild.roles.create.mockImplementationOnce(async (opts) => { order.push("role"); const role = makeRole({ id: "r-first", name: opts.name, color: opts.colors.primaryColor || "#000000" }); mockGuild.roles.cache.set(role.id, role); return role; });
        for (const id of [TBC_CAT, FOREVER_CAT]) {
            const ow = mockGuild.channels.cache.get(id).permissionOverwrites;
            const edit = ow.edit;
            ow.edit = jest.fn(async (...a) => { order.push(`rights:${a[0]}`); return edit(...a); });
        }
        const sendOnboarding = mockGuild.editOnboarding.getMockImplementation();
        mockGuild.editOnboarding.mockImplementation(async (payload) => { order.push("onboarding"); return sendOnboarding(payload); });

        const { done, overview } = await run({ actor: "Orga#1" });

        expect(done).toEqual({ roles: 11, categories: 2, channels: 0, onboarding: true });
        expect(order[0]).toBe("role");
        expect(order[order.length - 1]).toBe("onboarding");
        // per category: the bot first, @everyone last
        const forever = order.filter((x) => x.startsWith("rights:"));
        expect(forever[0]).toBe("rights:bot");
        expect(forever[2]).toBe(`rights:${GID}`);

        const payload = mockGuild.editOnboarding.mock.calls[0][0];
        expect(payload.defaultChannels).toEqual(["c1"]);
        expect(payload.enabled).toBe(true);
        expect(payload.mode).toBe(0);
        expect(payload.prompts.map((p) => [p.title, p.required, p.type])).toEqual([[svc.VERSION_PROMPT, true, 0], [svc.CLASS_PROMPT, false, 0]]);
        expect(payload.prompts[0].options.every((o) => o.id && o.roles.length === 1 && o.roles[0])).toBe(true);
        expect(payload.reason).toContain("Orga#1");

        const stored = mockConfig.pugRoles[GID];
        expect(stored.versions.tbc).toBeTruthy();
        expect(Object.keys(stored.classes)).toHaveLength(9);
        expect(stored.appliedBy).toBe("Orga#1");
        expect(stored.appliedAt).toMatch(/^\d{4}-/);
        expect(overview.changes).toBe(0);
    });

    test("applied twice: the second run writes nothing", async () => {
        await run();
        const before = writes();
        const { done } = await run();
        expect(done).toEqual({ roles: 0, categories: 0, channels: 0, onboarding: false });
        expect(writes()).toBe(before);
    });

    test("only a wrong colour: one role edit, the roles read again, nothing else", async () => {
        await run();
        const warriorId = mockConfig.pugRoles[GID].classes.Warrior;
        const warrior = mockGuild.roles.cache.get(warriorId);
        warrior.hexColor = "#123456";
        mockGuild.roles.create.mockClear();
        mockGuild.editOnboarding.mockClear();
        mockGuild.roles.fetch.mockClear();

        const { done, overview } = await run();
        expect(done).toEqual({ roles: 1, categories: 0, channels: 0, onboarding: false });
        expect(warrior.edit).toHaveBeenCalledWith(expect.objectContaining({ colors: { primaryColor: "#c79c6e" } }));
        expect(mockGuild.roles.fetch).toHaveBeenCalledTimes(1);
        expect(mockGuild.roles.create).not.toHaveBeenCalled();
        expect(overview.changes).toBe(0);
    });

    test("a kept question keeps its id, its options their ids and emojis", async () => {
        mockGuild = guild({
            roles: [makeRole({ id: "r-tbc", name: "TBC Anniversary" })],
            prompts: [prompt({ id: "p1", title: svc.VERSION_PROMPT, required: true, options: [
                { id: "o1", title: "TBC Anniversary", roleIds: ["r-tbc"], emoji: { id: null, name: "⚔️" }, description: "Burning Crusade" },
            ] })],
        });
        await run();
        const versions = mockGuild.editOnboarding.mock.calls[0][0].prompts[0];
        expect(versions.id).toBe("p1");
        expect(versions.options[0]).toMatchObject({ id: "o1", roles: ["r-tbc"], description: "Burning Crusade", emoji: { name: "⚔️" } });
        expect(versions.options[1].id).not.toBe("o1");
    });

    test("only the switched-on categories: the other one stays untouched", async () => {
        const { done } = await run({ categoryIds: [TBC_CAT] });
        expect(done).toMatchObject({ roles: 10, categories: 1 });
        expect(mockGuild.channels.cache.get(FOREVER_CAT).permissionOverwrites.edit).not.toHaveBeenCalled();
        expect(mockConfig.pugRoles[GID].versions).toEqual({ tbc: expect.any(String) });
        const titles = mockGuild.editOnboarding.mock.calls[0][0].prompts[0].options.map((o) => o.title);
        expect(titles).toEqual(["TBC Anniversary"]);
    });

    test("no category switched on: refused, nothing written", async () => {
        await expect(run({ categoryIds: [] })).rejects.toMatchObject({ status: 400, code: "no_category_selected" });
        expect(writes()).toBe(0);
    });

    test("orga roles get View Channel before @everyone is hidden", async () => {
        mockConfig = baseConfig({ orgaRoleIds: ["r-orga"] });
        mockGuild = guild({ roles: [makeRole({ id: "r-orga", name: "Orga" })] });
        await run({ categoryIds: [TBC_CAT] });
        const calls = mockGuild.channels.cache.get(TBC_CAT).permissionOverwrites.edit.mock.calls.map((c) => [c[0], c[1].ViewChannel]);
        expect(calls[0]).toEqual(["bot", true]);
        expect(calls[1]).toEqual(["r-orga", true]);
        expect(calls[calls.length - 1]).toEqual([GID, false]);
    });

    test("a category with channels: the synced one is synced again after the edit, the other stays", async () => {
        mockGuild = guild({ children: [
            { id: "ch-sync", parentId: TBC_CAT, name: "anmeldung" },
            { id: "ch-own", parentId: TBC_CAT, name: "offen", synced: false },
        ] });
        const { done, overview } = await run({ categoryIds: [TBC_CAT] });
        const sync = mockGuild.channels.cache.get("ch-sync");
        const own = mockGuild.channels.cache.get("ch-own");
        expect(mockGuild.channels.fetch).toHaveBeenCalledWith(TBC_CAT, { force: true });
        expect(sync.lockPermissions).toHaveBeenCalledTimes(1);
        expect(sync.permissionOverwrites.cache.get(GID).deny.has(F.ViewChannel)).toBe(true);
        expect(own.lockPermissions).not.toHaveBeenCalled();
        expect(done).toMatchObject({ categories: 1, channels: 1 });
        expect(overview.categories[0]).toMatchObject({ status: "same", unsynced: [{ id: "ch-own", name: "offen" }] });
    });

    test("no Community: a clear error, nothing written", async () => {
        mockGuild = guild({ features: [] });
        await expect(run()).rejects.toMatchObject({ status: 409, code: "no_community" });
        expect(writes()).toBe(0);
        expect(mockSaved).toHaveLength(0);
    });

    test.each([
        ["missing rights", { rights: [F.ManageRoles] }, "missing_permissions"],
        ["no Manage Roles, a role above the bot", { rights: [F.ManageGuild], roles: [makeRole({ id: "r-x", name: "Mage", position: 99 })] }, "missing_permissions"],
        ["a role above the bot", { roles: [makeRole({ id: "r-x", name: "Mage", position: 99 })] }, "role_above_bot"],
        ["no Manage Roles in a category", { access: { [TBC_CAT]: [F.ViewChannel] } }, "category_access"],
    ])("%s: refused before the first write", async (_label, opts, code) => {
        mockGuild = guild(opts);
        await expect(run()).rejects.toMatchObject({ status: 409, code });
        expect(writes()).toBe(0);
        expect(mockSaved).toHaveLength(0);
    });

    test("no PuG category and bot offline are refused", async () => {
        mockConfig = baseConfig({ categoryRoles: { [TBC_CAT]: ["1"], [FOREVER_CAT]: ["1"], [GUILD_CAT]: ["1"] } });
        await expect(svc.apply(GID, { fingerprint: "x" })).rejects.toMatchObject({ code: "no_pug_category" });
        mockOnline = false;
        await expect(svc.apply(GID, { fingerprint: "x" })).rejects.toMatchObject({ code: "offline" });
    });

    test("an unreadable onboarding stops before the first write", async () => {
        mockGuild.fetchOnboarding = jest.fn(async () => { throw new Error("boom"); });
        await expect(run()).rejects.toMatchObject({ status: 502, code: "onboarding_unreadable" });
        expect(writes()).toBe(0);
    });

    test("without the preview's fingerprint nothing runs", async () => {
        await expect(svc.apply(GID, { actor: "a" })).rejects.toMatchObject({ status: 400, code: "fingerprint_required" });
        expect(writes()).toBe(0);
    });

    test("changed since the preview: 409 changed, nothing written", async () => {
        const { fingerprint } = await svc.overview(GID);
        mockGuild.roles.cache.set("r-mage", makeRole({ id: "r-mage", name: "Mage" }));
        await expect(svc.apply(GID, { actor: "a", fingerprint })).rejects.toMatchObject({ status: 409, code: "changed", message: expect.stringContaining("Inzwischen geändert") });
        expect(writes()).toBe(0);
        expect(mockSaved).toHaveLength(0);
    });

    test("another selection than the preview's is a change too", async () => {
        const { fingerprint } = await svc.overview(GID);
        await expect(svc.apply(GID, { fingerprint, categoryIds: [TBC_CAT] })).rejects.toMatchObject({ code: "changed" });
    });

    test("one apply per server at a time: the second call gets busy, the lock is freed after", async () => {
        const { fingerprint } = await svc.overview(GID);
        let release;
        const gate = new Promise((r) => { release = r; });
        const read = mockGuild.fetchOnboarding.getMockImplementation();
        mockGuild.fetchOnboarding.mockImplementationOnce(async () => { await gate; return read(); });

        const first = svc.apply(GID, { actor: "a", fingerprint });
        await expect(svc.apply(GID, { actor: "b", fingerprint })).rejects.toMatchObject({ status: 409, code: "busy" });
        release();
        await expect(first).resolves.toMatchObject({ done: { roles: 11 } });
        await expect(run()).resolves.toMatchObject({ done: { roles: 0 } });
    });

    test("the lock is freed after an error too", async () => {
        await expect(svc.apply(GID, { fingerprint: "stale" })).rejects.toMatchObject({ code: "changed" });
        await expect(run()).resolves.toMatchObject({ done: { roles: 11 } });
    });

    test("a refusal in the middle of the roles: the made ones are stored, a second run makes no duplicates", async () => {
        const create = mockGuild.roles.create.getMockImplementation();
        let n = 0;
        mockGuild.roles.create.mockImplementation(async (opts) => {
            n += 1;
            if (n === 3) throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
            return create(opts);
        });
        await expect(run()).rejects.toMatchObject({ status: 502, code: "discord_failed", done: { roles: 2, categories: 0 } });
        const stored = mockConfig.pugRoles[GID];
        expect(Object.keys(stored.versions).length + Object.keys(stored.classes).length).toBe(2);
        expect(mockGuild.editOnboarding).not.toHaveBeenCalled();

        mockGuild.roles.create.mockClear();
        const { done } = await run();
        expect(done.roles).toBe(9);
        const names = [...mockGuild.roles.cache.values()].map((r) => r.name);
        expect(names).toHaveLength(11);
        expect(new Set(names).size).toBe(11);
    });

    test("a refusal in the rights: the step and what was done so far, the onboarding not sent", async () => {
        mockGuild.channels.cache.get(TBC_CAT).permissionOverwrites.edit.mockRejectedValue(Object.assign(new Error("Missing Access"), { code: 50001 }));
        await expect(run()).rejects.toMatchObject({
            status: 502, code: "discord_failed", step: "Rechte TBC PuGs", done: { roles: 11, categories: 1, channels: 0, onboarding: false },
        });
        expect(Object.keys(mockConfig.pugRoles[GID].classes)).toHaveLength(9);
        expect(mockGuild.editOnboarding).not.toHaveBeenCalled();
    });

    test("Discord refusing the onboarding: the created roles are stored, the error names the step", async () => {
        mockGuild.editOnboarding.mockRejectedValue(Object.assign(new Error("Invalid Form Body"), { code: 50035 }));
        await expect(run()).rejects.toMatchObject({ status: 502, code: "discord_failed", step: "Onboarding", done: { roles: 11, categories: 2, channels: 0, onboarding: false } });
        expect(Object.keys(mockConfig.pugRoles[GID].classes)).toHaveLength(9);
        expect(mockConfig.pugRoles[GID].appliedAt).toBe("");
    });

    test("other servers' entries stay", async () => {
        mockConfig = baseConfig({ pugRoles: { other: { versions: { tbc: "x" }, classes: {} } } });
        await run();
        expect(mockConfig.pugRoles.other).toEqual({ versions: { tbc: "x" }, classes: {} });
    });
});
