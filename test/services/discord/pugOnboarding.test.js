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
const F = PermissionsBitField.Flags;

// ---- a fake guild with everything apply touches ------------------------------

function makeRole({ id, name, color = "#000000", position = 1, managed = false }) {
    const role = { id, name, hexColor: color, position, managed, editable: true };
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

let nextRole = 0;
function guild({ features = ["COMMUNITY"], rights = [F.ManageRoles, F.ManageGuild], roles = [], prompts = [], categories = {}, top = 50 } = {}) {
    const roleCache = new Map(roles.map((r) => [r.id, r]));
    const channels = new Map();
    const names = { [TBC_CAT]: "TBC PuGs", [FOREVER_CAT]: "Forever PuGs", [GUILD_CAT]: "Gilde" };
    for (const id of [TBC_CAT, FOREVER_CAT, GUILD_CAT]) {
        channels.set(id, { id, name: names[id], type: 4, permissionOverwrites: overwrites(categories[id] || {}) });
    }
    const g = {
        id: GID,
        name: "PuG-Server",
        features,
        channels: { cache: channels },
        members: { me: { id: "bot", permissions: new PermissionsBitField(rights), roles: { highest: { position: top } } } },
        roles: {
            cache: roleCache,
            everyone: { id: GID },
            create: jest.fn(async ({ name, colors }) => {
                nextRole += 1;
                const role = makeRole({ id: `7000000000000000${String(nextRole).padStart(2, "0")}`, name, color: colors.primaryColor || "#000000" });
                roleCache.set(role.id, role);
                return role;
            }),
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
    categoryRoles: { [GUILD_CAT]: ["600000000000000001"] },
    ...over,
});

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
        expect(pug.map((c) => [c.id, c.versionId])).toEqual([[FOREVER_CAT, "forever"], [TBC_CAT, "tbc"]]);
        expect(other).toEqual([{ id: GUILD_CAT, name: "Gilde", rule: "roles" }]);
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
        expect(o.prerequisites.every((p) => p.ok === true)).toBe(true);
    });

    test("a role found by name keeps its id; a wrong colour is changed", async () => {
        mockGuild = guild({ roles: [makeRole({ id: "r-war", name: "warrior", color: "#ffffff" }), makeRole({ id: "r-tbc", name: "TBC Anniversary" })] });
        const o = await svc.overview(GID);
        const warrior = o.roles.find((r) => r.key === "class:Warrior");
        expect(warrior).toMatchObject({ status: "changed", roleId: "r-war", current: { name: "warrior", color: "#ffffff" } });
        expect(o.roles.find((r) => r.key === "version:tbc")).toMatchObject({ status: "same", roleId: "r-tbc" });
        expect(statusOf(o.roles, "class:Mage")).toBe("new");
    });

    test("the saved id wins over the name", async () => {
        mockConfig = baseConfig({ pugRoles: { [GID]: { versions: { tbc: "r-old" }, classes: {} } } });
        mockGuild = guild({ roles: [makeRole({ id: "r-old", name: "TBC" }), makeRole({ id: "r-new", name: "TBC Anniversary" })] });
        const o = await svc.overview(GID);
        expect(o.roles.find((r) => r.key === "version:tbc")).toMatchObject({ status: "changed", roleId: "r-old" });
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

    test("bot offline: no Discord read", async () => {
        mockOnline = false;
        expect(await svc.overview(GID)).toEqual({ guildId: GID, guildName: "", online: false, applied: null });
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

        const { done, overview } = await svc.apply(GID, { actor: "Orga#1" });

        expect(done).toEqual({ roles: 11, categories: 2, onboarding: true });
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

    test("nothing differs: Discord is not written", async () => {
        await svc.apply(GID, { actor: "a" });
        mockGuild.roles.create.mockClear();
        mockGuild.editOnboarding.mockClear();
        const edits = [TBC_CAT, FOREVER_CAT].map((id) => mockGuild.channels.cache.get(id).permissionOverwrites.edit);
        edits.forEach((e) => e.mockClear());

        const { done } = await svc.apply(GID, { actor: "a" });
        expect(done).toEqual({ roles: 0, categories: 0, onboarding: false });
        expect(mockGuild.roles.create).not.toHaveBeenCalled();
        expect(mockGuild.editOnboarding).not.toHaveBeenCalled();
        edits.forEach((e) => expect(e).not.toHaveBeenCalled());
    });

    test("only a wrong colour: one role edit, nothing else", async () => {
        await svc.apply(GID, { actor: "a" });
        const warriorId = mockConfig.pugRoles[GID].classes.Warrior;
        const warrior = mockGuild.roles.cache.get(warriorId);
        warrior.hexColor = "#123456";
        mockGuild.roles.create.mockClear();
        mockGuild.editOnboarding.mockClear();

        const { done } = await svc.apply(GID, { actor: "a" });
        expect(done).toEqual({ roles: 1, categories: 0, onboarding: false });
        expect(warrior.edit).toHaveBeenCalledWith(expect.objectContaining({ colors: { primaryColor: "#c79c6e" } }));
        expect(mockGuild.roles.create).not.toHaveBeenCalled();
    });

    test("a kept question keeps its id, its options their ids and emojis", async () => {
        mockGuild = guild({
            roles: [makeRole({ id: "r-tbc", name: "TBC Anniversary" })],
            prompts: [prompt({ id: "p1", title: svc.VERSION_PROMPT, required: true, options: [
                { id: "o1", title: "TBC Anniversary", roleIds: ["r-tbc"], emoji: { id: null, name: "⚔️" }, description: "Burning Crusade" },
            ] })],
        });
        await svc.apply(GID, { actor: "a" });
        const versions = mockGuild.editOnboarding.mock.calls[0][0].prompts[0];
        expect(versions.id).toBe("p1");
        expect(versions.options[0]).toMatchObject({ id: "o1", roles: ["r-tbc"], description: "Burning Crusade", emoji: { name: "⚔️" } });
        expect(versions.options[1].id).not.toBe("o1");
    });

    test("no Community: a clear error, nothing written", async () => {
        mockGuild = guild({ features: [] });
        await expect(svc.apply(GID, { actor: "a" })).rejects.toMatchObject({ status: 409, code: "no_community" });
        expect(mockGuild.roles.create).not.toHaveBeenCalled();
        expect(mockGuild.editOnboarding).not.toHaveBeenCalled();
        expect(mockSaved).toHaveLength(0);
    });

    test.each([
        ["missing rights", { rights: [F.ManageRoles] }, "missing_permissions"],
        ["a role above the bot", { roles: [makeRole({ id: "r-x", name: "Mage", position: 99 })] }, "role_above_bot"],
    ])("%s: refused before the first write", async (_label, opts, code) => {
        mockGuild = guild(opts);
        await expect(svc.apply(GID)).rejects.toMatchObject({ status: 409, code });
        expect(mockGuild.roles.create).not.toHaveBeenCalled();
    });

    test("no PuG category and bot offline are refused", async () => {
        mockConfig = baseConfig({ categoryRoles: { [TBC_CAT]: ["1"], [FOREVER_CAT]: ["1"], [GUILD_CAT]: ["1"] } });
        await expect(svc.apply(GID)).rejects.toMatchObject({ code: "no_pug_category" });
        mockOnline = false;
        await expect(svc.apply(GID)).rejects.toMatchObject({ code: "offline" });
    });

    test("an unreadable onboarding stops before the first write", async () => {
        mockGuild.fetchOnboarding = jest.fn(async () => { throw new Error("boom"); });
        await expect(svc.apply(GID)).rejects.toMatchObject({ status: 502, code: "onboarding_unreadable" });
        expect(mockGuild.roles.create).not.toHaveBeenCalled();
    });

    test("Discord refusing the onboarding: the created roles are stored, the error names the step", async () => {
        mockGuild.editOnboarding.mockRejectedValue(Object.assign(new Error("Invalid Form Body"), { code: 50035 }));
        await expect(svc.apply(GID, { actor: "a" })).rejects.toMatchObject({ status: 502, code: "discord_failed", step: "Onboarding", done: { roles: 11, categories: 2, onboarding: false } });
        expect(Object.keys(mockConfig.pugRoles[GID].classes)).toHaveLength(9);
        expect(mockConfig.pugRoles[GID].appliedAt).toBe("");
    });

    test("other servers' entries stay", async () => {
        mockConfig = baseConfig({ pugRoles: { other: { versions: { tbc: "x" }, classes: {} } } });
        await svc.apply(GID, { actor: "a" });
        expect(mockConfig.pugRoles.other).toEqual({ versions: { tbc: "x" }, classes: {} });
    });
});
