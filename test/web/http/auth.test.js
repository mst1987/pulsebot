jest.mock("axios");
jest.mock("../../../src/config/variables", () => ({
    discordClientId: "client-id-123",
    discordClientSecret: "secret-xyz",
    publicBaseUrl: "https://logs.example.com",
    logcheckAdminIds: ["233598324022837249"],
    adminRoleIds: [],
    guildId: "guild-1",
    devAutoLogin: false,
}));
jest.mock("../../../src/stores/settingsStore", () => ({
    getConfig: jest.fn(() => ({ adminRoleIds: [] })),
}));
// The real guildRoles.js falls back to config.guildId, which in production
// already carries the env GUILD_ID default (baked in by the real
// settingsStore.getConfig()) — the mocked getConfig() above does not
// replicate that, so this file mocks guildRoles directly instead, matching
// every other test's single configured event server ("guild-1").
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildIds: jest.fn(() => ["guild-1"]) }));

const axios = require("axios");
const { getConfig } = require("../../../src/stores/settingsStore");
const guildRoles = require("../../../src/services/discord/guildRoles");
const auth = require("../../../src/web/http/auth.js");
const discord = require("../../../src/services/discord/discord");
const fs = require("fs");
const { DATA_DIR, dataPath } = require("../../../src/config/paths");
const { makeClient, makeGuild, discordError } = require("../../helpers/discordClient");

// The sessions auth.js persists: test/setup/environment.js points DATA_DIR at a
// scratch directory of this suite's own, never the checkout's data/ (#433).
const storedSessions = () => JSON.parse(fs.readFileSync(dataPath("sessions.json"), "utf8"));

// Flush the background admin re-check kicked off by sessionFor().
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Since #925 the rights live per server (serverSettings[<guild>]); only the full
// admin roles stay global. onServer() moves the rights of a fixture onto the
// given servers, the way the start migration does.
const ACCESS = ["rolePermissions", "baseAccess", "userPermissions", "orgaRoleIds", "botCommandAccess"];
function onServer(cfg, guildIds = ["guild-1", "guild-2"]) {
    const rest = { ...cfg };
    const block = {};
    for (const key of ACCESS) {
        if (rest[key] === undefined) continue;
        block[key] = rest[key];
        delete rest[key];
    }
    return { ...rest, serverSettings: Object.fromEntries(guildIds.map((gid) => [gid, block])) };
}

/** A fake bot client whose guild resolves members via the given fetch impl. */
function fakeClient(memberFetch) {
    const guild = guildWith("guild-1", memberFetch);
    return { guild, client: makeClient({ guilds: [guild] }) };
}

/** The event server `id`, its members answered by `memberFetch`. */
function guildWith(id, memberFetch) {
    const guild = makeGuild({ id });
    guild.members.fetch = memberFetch;
    return guild;
}

const NOT_A_MEMBER = discordError("member");

/**
 * A fake bot client on several guilds at once, `{ [guildId]: memberFetch | "offline" }`;
 * an offline guild is not on the client, so fetching it rejects with Unknown Guild.
 */
function fakeMultiGuildClient(byGuild) {
    const guilds = Object.entries(byGuild)
        .filter(([, memberFetch]) => memberFetch !== "offline")
        .map(([guildId, memberFetch]) => guildWith(guildId, memberFetch));
    return makeClient({ guilds });
}

/** A fake guild member holding exactly the given role ids. */
function memberWithRoles(...roleIds) {
    return { roles: { cache: { has: (id) => roleIds.includes(id), keys: () => roleIds[Symbol.iterator]() } } };
}

describe("web/http/auth", () => {
    describe("configured", () => {
        it("is true when both client id and secret are set", () => {
            expect(auth.configured()).toBe(true);
        });
    });

    describe("parseCookies", () => {
        it("returns an empty object without a cookie header", () => {
            expect(auth.parseCookies({ headers: {} })).toEqual({});
        });

        it("parses and url-decodes cookie pairs", () => {
            const req = { headers: { cookie: "sid=abc123; foo=a%20b" } };
            expect(auth.parseCookies(req)).toEqual({ sid: "abc123", foo: "a b" });
        });
    });

    describe("loginUrl", () => {
        it("builds the Discord authorize URL with all params", () => {
            const url = auth.loginUrl("state-token");
            expect(url.startsWith("https://discord.com/api/oauth2/authorize?")).toBe(true);
            const qs = new URL(url).searchParams;
            expect(qs.get("client_id")).toBe("client-id-123");
            expect(qs.get("redirect_uri")).toBe("https://logs.example.com/auth/callback");
            expect(qs.get("response_type")).toBe("code");
            expect(qs.get("scope")).toBe("identify");
            expect(qs.get("state")).toBe("state-token");
        });
    });

    describe("getUser", () => {
        it("returns null when there is no session cookie", () => {
            expect(auth.getUser({ headers: {} })).toBeNull();
        });

        it("returns null for an unknown sid", () => {
            expect(auth.getUser({ headers: { cookie: "sid=doesnotexist" } })).toBeNull();
        });
    });

    describe("Ansicht als Rolle (setViewAs / getRealUser)", () => {
        const RAIDER = "111111111111111111";
        beforeEach(() => {
            axios.post.mockResolvedValue({ data: { access_token: "tok-abc" } });
            getConfig.mockReturnValue(onServer({ adminRoleIds: [], rolePermissions: { [RAIDER]: { signup: { read: true, write: true } } } }));
        });
        afterEach(() => getConfig.mockReturnValue({ adminRoleIds: [] }));

        it("shows every reader the role's rights while the session keeps the admin's own", async () => {
            axios.get.mockResolvedValue({ data: { id: "233598324022837249", username: "adminuser" } });
            const sid = await auth.completeLogin("code-va");
            const req = { headers: { cookie: `sid=${sid}` } };
            auth.setActiveGuild(req, "guild-1");
            expect(auth.getUser(req).isAdmin).toBe(true);

            expect(auth.setViewAs(req, [RAIDER])).toBe(true);
            const viewed = auth.getUser(req);
            expect(viewed.isAdmin).toBe(false);
            expect(viewed.access.signup).toEqual({ read: true, write: true });
            expect(viewed.access.settings).toEqual({ read: false, write: false });
            expect(viewed.viewAs.roleIds).toEqual([RAIDER]);
            // the admin's own rights are untouched
            expect(auth.getRealUser(req).isAdmin).toBe(true);
            expect(auth.getRealUser(req).access.settings.write).toBe(true);

            expect(auth.setViewAs(req, null)).toBe(true);
            expect(auth.getUser(req).isAdmin).toBe(true);
            expect(auth.getUser(req).viewAs).toBeUndefined();
            auth.destroy(sid);
        });

        it("lets no one but a full admin start a view", async () => {
            axios.get.mockResolvedValue({ data: { id: "555", username: "member" } });
            const sid = await auth.completeLogin("code-member");
            const req = { headers: { cookie: `sid=${sid}` } };
            expect(auth.setViewAs(req, [RAIDER])).toBe(false);
            expect(auth.getUser(req).viewAs).toBeUndefined();
            expect(auth.setViewAs({ headers: {} }, [RAIDER])).toBe(false);
            auth.destroy(sid);
        });
    });

    describe("completeLogin", () => {
        beforeEach(() => {
            axios.post.mockResolvedValue({ data: { access_token: "tok-abc" } });
        });

        it("exchanges the code, creates a session and marks admins", async () => {
            axios.get.mockResolvedValue({
                data: { id: "233598324022837249", username: "adminuser", global_name: "Admin User" },
            });

            const sid = await auth.completeLogin("auth-code");

            expect(sid).toMatch(/^[a-f0-9]+$/);
            // token exchange posted to Discord
            expect(axios.post).toHaveBeenCalledWith(
                "https://discord.com/api/oauth2/token",
                expect.any(String),
                expect.objectContaining({
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                })
            );
            const body = axios.post.mock.calls[0][1];
            expect(body).toContain("code=auth-code");
            expect(body).toContain("grant_type=authorization_code");
            // fetched the user with the bearer token
            expect(axios.get).toHaveBeenCalledWith(
                "https://discord.com/api/users/@me",
                { headers: { Authorization: "Bearer tok-abc" } }
            );

            // the session is now resolvable via getUser
            const user = auth.getUser({ headers: { cookie: `sid=${sid}` } });
            expect(user).toMatchObject({
                id: "233598324022837249",
                name: "Admin User",
                isAdmin: true,
            });
            // persisted for a restart - in the suite's scratch data directory
            expect(DATA_DIR).toContain("eh-test-data-");
            expect(storedSessions()[sid]).toMatchObject({ id: "233598324022837249", isAdmin: true });
        });

        it("falls back to username and marks non-admins", async () => {
            axios.get.mockResolvedValue({
                data: { id: "999", username: "plainuser", global_name: null },
            });

            const sid = await auth.completeLogin("code2");
            const user = auth.getUser({ headers: { cookie: `sid=${sid}` } });
            expect(user).toMatchObject({ id: "999", name: "plainuser", isAdmin: false });
            // no own Discord picture: none stored, the menu shows the initial
            expect(user).not.toHaveProperty("avatarUrl");
        });

        it("keeps the account's Discord picture for the menu", async () => {
            axios.get.mockResolvedValue({ data: { id: "999", username: "plainuser", avatar: "abc123" } });
            const sid = await auth.completeLogin("code3");
            expect(auth.getUser({ headers: { cookie: `sid=${sid}` } }).avatarUrl).toBe("https://cdn.discordapp.com/avatars/999/abc123.png?size=64");
        });

        it("propagates a failed token exchange", async () => {
            axios.post.mockRejectedValue(new Error("bad code"));
            await expect(auth.completeLogin("nope")).rejects.toThrow("bad code");
        });
    });

    describe("role-based admin access", () => {
        const FIVE_MIN = 300000;
        let nowSpy;
        let now;

        beforeEach(() => {
            axios.post.mockResolvedValue({ data: { access_token: "tok" } });
            now = Date.now();
            nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
        });

        afterEach(() => {
            nowSpy.mockRestore();
            discord.setClient(null);
            getConfig.mockImplementation(() => onServer({ adminRoleIds: [] }));
        });

        async function loginAs(id) {
            axios.get.mockResolvedValue({ data: { id, username: `user-${id}` } });
            const sid = await auth.completeLogin(`code-${id}`);
            return { sid, req: { headers: { cookie: `sid=${sid}` } } };
        }

        it("grants admin at login when the member has a configured role", async () => {
            getConfig.mockImplementation(() => onServer({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            discord.setClient(fakeClient(fetch).client);

            const { req } = await loginAs("555");
            expect(auth.getUser(req).isAdmin).toBe(true);
            expect(fetch).toHaveBeenCalledWith("555");
        });

        it("upgrades an existing session once roles are added and the cache expires", async () => {
            const { req } = await loginAs("556");
            expect(auth.getUser(req).isAdmin).toBe(false);

            // Admin adds a role id in the settings afterwards:
            getConfig.mockImplementation(() => onServer({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            discord.setClient(fakeClient(fetch).client);

            // Within the cache window nothing is re-checked.
            expect(auth.getUser(req).isAdmin).toBe(false);
            await flush();
            expect(fetch).not.toHaveBeenCalled();

            // After 5 minutes the next request triggers a background re-check…
            now += FIVE_MIN + 1000;
            expect(auth.getUser(req).isAdmin).toBe(false);
            await flush();
            // …and the request after that sees the new status.
            expect(auth.getUser(req).isAdmin).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it("marks an orga role at login and takes the mark away when the role is no orga role any more", async () => {
            let orgaRoleIds = ["role-lead"];
            getConfig.mockImplementation(() => onServer({ orgaRoleIds }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-lead"));
            discord.setClient(fakeClient(fetch).client);

            const { req } = await loginAs("560");
            expect(auth.getUser(req)).toMatchObject({ isAdmin: false, isOrga: true });

            // the role is set back to a raider role; the next re-check drops the mark
            orgaRoleIds = [];
            now += FIVE_MIN + 1000;
            auth.getUser(req);
            await flush();
            expect(auth.getUser(req).isOrga).toBeUndefined();
        });

        // #1000: the profile's sync keys read the servers from the session, no member lookup per view.
        it("hands out the session's rights per server, none without a session", async () => {
            getConfig.mockImplementation(() => onServer({ orgaRoleIds: ["role-lead"] }));
            discord.setClient(fakeClient(jest.fn().mockResolvedValue(memberWithRoles("role-lead"))).client);
            const { req } = await loginAs("561");
            const access = auth.sessionGuildAccess(req);
            expect(access.isAdmin).toBe(false);
            expect(access.guilds["guild-1"]).toMatchObject({ isOrga: true });
            expect(auth.sessionGuildAccess({ headers: {} })).toBeNull();
        });

        it("re-checks only once per cache window", async () => {
            getConfig.mockImplementation(() => onServer({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            discord.setClient(fakeClient(fetch).client);

            const { req } = await loginAs("557");
            expect(fetch).toHaveBeenCalledTimes(1); // login-time check

            now += FIVE_MIN + 1000;
            auth.getUser(req);
            await flush();
            auth.getUser(req);
            auth.getUser(req);
            await flush();
            expect(fetch).toHaveBeenCalledTimes(2); // login + one refresh
        });

        it("keeps the last known status when the re-check lookup fails", async () => {
            getConfig.mockImplementation(() => onServer({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            discord.setClient(fakeClient(fetch).client);
            const { req } = await loginAs("558");
            expect(auth.getUser(req).isAdmin).toBe(true);

            fetch.mockRejectedValue(new Error("network down"));
            now += FIVE_MIN + 1000;
            auth.getUser(req);
            await flush();
            expect(auth.getUser(req).isAdmin).toBe(true); // not demoted by an outage
        });

        it("demotes a session whose user left the guild (Unknown Member)", async () => {
            getConfig.mockImplementation(() => onServer({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            discord.setClient(fakeClient(fetch).client);
            const { req } = await loginAs("559");
            expect(auth.getUser(req).isAdmin).toBe(true);

            const err = new Error("Unknown Member");
            err.code = 10007;
            fetch.mockRejectedValue(err);
            now += FIVE_MIN + 1000;
            auth.getUser(req);
            await flush();
            expect(auth.getUser(req).isAdmin).toBe(false);
        });

        it("demotes an admin whose role was removed from the config", async () => {
            getConfig.mockImplementation(() => onServer({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            discord.setClient(fakeClient(fetch).client);
            const { req } = await loginAs("560");
            expect(auth.getUser(req).isAdmin).toBe(true);

            getConfig.mockImplementation(() => onServer({ adminRoleIds: [] }));
            now += FIVE_MIN + 1000;
            auth.getUser(req);
            await flush();
            expect(auth.getUser(req).isAdmin).toBe(false);
        });
    });

    // Roles that are not admin roles can still be given single areas of the menu
    // (Einstellungen → Berechtigungen, see src/config/permissions.js).
    describe("role permissions", () => {
        let nowSpy;
        let now;

        beforeEach(() => {
            axios.post.mockResolvedValue({ data: { access_token: "tok" } });
            now = Date.now();
            nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
        });

        afterEach(() => {
            nowSpy.mockRestore();
            discord.setClient(null);
            getConfig.mockImplementation(() => onServer({ adminRoleIds: [] }));
        });

        // the rights of guild-1, the server these tests work on (#925)
        async function loginAs(id) {
            axios.get.mockResolvedValue({ data: { id, username: `user-${id}` } });
            const sid = await auth.completeLogin(`code-${id}`);
            const req = { headers: { cookie: `sid=${sid}` } };
            auth.setActiveGuild(req, "guild-1");
            return { sid, req };
        }

        it("resolves the union of the member's role permissions, without admin", async () => {
            getConfig.mockImplementation(() => onServer({
                adminRoleIds: [],
                rolePermissions: {
                    "role-a": { raids: { read: true, write: false }, cla: { read: true, write: false } },
                    "role-b": { raids: { read: true, write: true } },
                },
            }));
            discord.setClient(fakeClient(jest.fn().mockResolvedValue(memberWithRoles("role-a", "role-b"))).client);

            const { req } = await loginAs("601");
            const user = auth.getUser(req);

            expect(user.isAdmin).toBe(false);
            expect(user.access.raids).toEqual({ read: true, write: true });
            expect(user.access.cla).toEqual({ read: true, write: false });
            expect(user.access.settings).toEqual({ read: false, write: false });
        });

        it("gives a full admin every area regardless of role permissions", async () => {
            getConfig.mockImplementation(() => onServer({
                adminRoleIds: ["role-admin"],
                rolePermissions: { "role-a": { raids: { read: true, write: false } } },
            }));
            discord.setClient(fakeClient(jest.fn().mockResolvedValue(memberWithRoles("role-admin", "role-a"))).client);

            const { req } = await loginAs("602");
            const user = auth.getUser(req);

            expect(user.isAdmin).toBe(true);
            expect(user.access.settings).toEqual({ read: true, write: true });
        });

        it("grants nothing when the member holds no configured role", async () => {
            getConfig.mockImplementation(() => onServer({
                adminRoleIds: [],
                rolePermissions: { "role-a": { raids: { read: true, write: false } } },
            }));
            discord.setClient(fakeClient(jest.fn().mockResolvedValue(memberWithRoles("role-other"))).client);

            const { req } = await loginAs("603");
            const user = auth.getUser(req);

            expect(user.isAdmin).toBe(false);
            expect(user.access.raids).toEqual({ read: false, write: false });
        });

        it("skips the Discord lookup entirely when nothing is configured", async () => {
            getConfig.mockImplementation(() => onServer({ adminRoleIds: [], rolePermissions: {} }));
            const fetch = jest.fn();
            discord.setClient(fakeClient(fetch).client);

            const { req } = await loginAs("604");

            expect(fetch).not.toHaveBeenCalled();
            expect(auth.getUser(req).isAdmin).toBe(false);
        });

        // config.baseAccess: what every logged-in account holds without any role.
        // Deliberately independent of Discord, so it also survives "not a member
        // of the guild" and a lookup that fails outright.
        describe("base access", () => {
            it("grants it without any role and unions the role grants on top", async () => {
                getConfig.mockImplementation(() => onServer({
                    adminRoleIds: [],
                    baseAccess: { loot: { read: true, write: false } },
                    rolePermissions: { "role-a": { raids: { read: true, write: true } } },
                }));
                discord.setClient(fakeClient(jest.fn().mockResolvedValue(memberWithRoles("role-a"))).client);

                const { req } = await loginAs("606");
                const user = auth.getUser(req);

                expect(user.isAdmin).toBe(false);
                expect(user.access.loot).toEqual({ read: true, write: false });
                expect(user.access.raids).toEqual({ read: true, write: true });
                expect(user.access.settings).toEqual({ read: false, write: false });
            });

            it("still applies when nothing else is configured — without a Discord lookup", async () => {
                getConfig.mockImplementation(() => onServer({
                    adminRoleIds: [], rolePermissions: {}, baseAccess: { loot: { read: true, write: false } },
                }));
                const fetch = jest.fn();
                discord.setClient(fakeClient(fetch).client);

                const { req } = await loginAs("607");

                expect(fetch).not.toHaveBeenCalled();
                expect(auth.getUser(req).access.loot).toEqual({ read: true, write: false });
            });

            it("applies to someone who is not a member of the guild", async () => {
                getConfig.mockImplementation(() => onServer({
                    adminRoleIds: ["role-admin"],
                    baseAccess: { loot: { read: true, write: false } },
                }));
                discord.setClient(fakeClient(jest.fn().mockRejectedValue(NOT_A_MEMBER)).client);

                const { req } = await loginAs("608");
                const user = auth.getUser(req);

                expect(user.isAdmin).toBe(false);
                expect(user.access.loot).toEqual({ read: true, write: false });
            });

            it("falls back to it when the role lookup fails outright", async () => {
                getConfig.mockImplementation(() => onServer({
                    adminRoleIds: ["role-admin"],
                    baseAccess: { loot: { read: true, write: false } },
                }));
                discord.setClient(fakeClient(jest.fn().mockRejectedValue(new Error("Discord down"))).client);

                const { req } = await loginAs("609");
                const user = auth.getUser(req);

                expect(user.isAdmin).toBe(false);
                expect(user.access.loot).toEqual({ read: true, write: false });
            });

            it("leaves an unconfigured base access closed", async () => {
                getConfig.mockImplementation(() => onServer({ adminRoleIds: [], rolePermissions: {} }));
                const { req } = await loginAs("610");
                expect(auth.getUser(req).access.loot).toEqual({ read: false, write: false });
            });
        });

        // config.userPermissions: rights for one named account, for areas that
        // go to people rather than to a group (the loot council). Sits next to
        // the base access and is likewise independent of Discord.
        describe("per-account grants", () => {
            const councilFor = (id) => onServer({
                adminRoleIds: [], rolePermissions: {}, baseAccess: {},
                userPermissions: { [id]: { lootcouncil: { read: true, write: true } } },
            });

            it("grants exactly the configured account, nobody else", async () => {
                getConfig.mockImplementation(() => councilFor("611"));

                const mine = await loginAs("611");
                expect(auth.getUser(mine.req).access.lootcouncil).toEqual({ read: true, write: true });

                const other = await loginAs("612");
                expect(auth.getUser(other.req).access.lootcouncil).toEqual({ read: false, write: false });
            });

            it("grants nothing beyond the named area", async () => {
                getConfig.mockImplementation(() => councilFor("613"));
                const { req } = await loginAs("613");
                const user = auth.getUser(req);
                expect(user.isAdmin).toBe(false);
                expect(user.access.settings).toEqual({ read: false, write: false });
                expect(user.access.history).toEqual({ read: false, write: false });
            });

            it("needs no Discord lookup when nothing role-based is configured", async () => {
                getConfig.mockImplementation(() => councilFor("614"));
                const fetch = jest.fn();
                discord.setClient(fakeClient(fetch).client);

                const { req } = await loginAs("614");

                expect(fetch).not.toHaveBeenCalled();
                expect(auth.getUser(req).access.lootcouncil.write).toBe(true);
            });

            it("survives a failing role lookup, like the base access does", async () => {
                getConfig.mockImplementation(() => ({ ...councilFor("615"), adminRoleIds: ["role-admin"] }));
                discord.setClient(fakeClient(jest.fn().mockRejectedValue(new Error("Discord down"))).client);

                const { req } = await loginAs("615");

                expect(auth.getUser(req).access.lootcouncil).toEqual({ read: true, write: true });
            });

            // The Kaderplaner is handed to named people only (docs/kaderplaner.md).
            it("opens the Kaderplaner to exactly the named account", async () => {
                getConfig.mockImplementation(() => onServer({
                    adminRoleIds: [], rolePermissions: {}, baseAccess: { loot: { read: true } },
                    userPermissions: { "617": { kader: { read: true, write: true } } },
                }));
                const mine = await loginAs("617");
                expect(auth.getUser(mine.req).access.kader).toEqual({ read: true, write: true });
                const other = await loginAs("618");
                expect(auth.getUser(other.req).access.kader).toEqual({ read: false, write: false });
            });

            it("unions with the role grants instead of replacing them", async () => {
                getConfig.mockImplementation(() => onServer({
                    adminRoleIds: [],
                    userPermissions: { "616": { lootcouncil: { read: true, write: false } } },
                    rolePermissions: { "role-a": { raids: { read: true, write: true } } },
                }));
                discord.setClient(fakeClient(jest.fn().mockResolvedValue(memberWithRoles("role-a"))).client);

                const { req } = await loginAs("616");
                const user = auth.getUser(req);

                expect(user.access.lootcouncil).toEqual({ read: true, write: false });
                expect(user.access.raids).toEqual({ read: true, write: true });
            });
        });

        it("picks up permissions added after login once the cache expires", async () => {
            getConfig.mockImplementation(() => onServer({ adminRoleIds: [], rolePermissions: {} }));
            const { req } = await loginAs("605");
            expect(auth.getUser(req).access.history).toEqual({ read: false, write: false });

            getConfig.mockImplementation(() => onServer({
                adminRoleIds: [],
                rolePermissions: { "role-a": { history: { read: true, write: true } } },
            }));
            discord.setClient(fakeClient(jest.fn().mockResolvedValue(memberWithRoles("role-a"))).client);

            now += 300000 + 1000;
            auth.getUser(req); // triggers the background re-check
            await flush();

            expect(auth.getUser(req).access.history).toEqual({ read: true, write: true });
        });
    });

    // Several event servers can be configured at once (#361) — role-based
    // access is granted from ANY of them, not just the first.
    describe("several event servers", () => {
        let nowSpy;

        beforeEach(() => {
            axios.post.mockResolvedValue({ data: { access_token: "tok" } });
            const now = Date.now();
            nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
            guildRoles.eventGuildIds.mockReturnValue(["guild-1", "guild-2"]);
        });

        afterEach(() => {
            nowSpy.mockRestore();
            discord.setClient(null);
            getConfig.mockImplementation(() => onServer({ adminRoleIds: [] }));
            guildRoles.eventGuildIds.mockReturnValue(["guild-1"]);
        });

        async function loginAs(id) {
            axios.get.mockResolvedValue({ data: { id, username: `user-${id}` } });
            const sid = await auth.completeLogin(`code-${id}`);
            return { sid, req: { headers: { cookie: `sid=${sid}` } } };
        }

        it("grants access via a role on a secondary event server when not even a member of the first", async () => {
            getConfig.mockImplementation(() => onServer({ adminRoleIds: ["role-1"] }));
            discord.setClient(fakeMultiGuildClient({
                "guild-1": jest.fn().mockRejectedValue(NOT_A_MEMBER),
                "guild-2": jest.fn().mockResolvedValue(memberWithRoles("role-1")),
            }));
            const { req } = await loginAs("701");
            expect(auth.getUser(req).isAdmin).toBe(true);
        });

        // #925: the rights of a server hold on that server only; the union over
        // every server is allAccess (pages under "All servers"), never access.
        it("keeps the rights of each server apart and unions them only in allAccess", async () => {
            const RIGHTS = {
                "role-a": { raids: { read: true, write: false } },
                "role-b": { cla: { read: true, write: true } },
            };
            getConfig.mockImplementation(() => ({ adminRoleIds: [], serverSettings: { "guild-1": { rolePermissions: RIGHTS }, "guild-2": { rolePermissions: RIGHTS } } }));
            discord.setClient(fakeMultiGuildClient({
                "guild-1": jest.fn().mockResolvedValue(memberWithRoles("role-a")),
                "guild-2": jest.fn().mockResolvedValue(memberWithRoles("role-b")),
            }));
            const { req } = await loginAs("702");
            // on guild-1: only what role-a gives there
            auth.setActiveGuild(req, "guild-1");
            const user = auth.getUser(req);
            expect(user.isAdmin).toBe(false);
            expect(user.access.raids).toEqual({ read: true, write: false });
            expect(user.access.cla).toEqual({ read: false, write: false });
            expect(user.allAccess.raids).toEqual({ read: true, write: false });
            expect(user.allAccess.cla).toEqual({ read: true, write: true });
            // on guild-2 it is the other way round
            auth.setActiveGuild(req, "guild-2");
            const there = auth.getUser(req);
            expect(there.access.cla).toEqual({ read: true, write: true });
            expect(there.access.raids).toEqual({ read: false, write: false });
        });

        it("an orga role of guild-2 opens nothing on guild-1, a full admin role of guild-1 opens guild-2 too", async () => {
            getConfig.mockImplementation(() => ({
                adminRoleIds: ["role-admin"],
                serverSettings: { "guild-2": { rolePermissions: { "role-orga": { raids: { read: true, write: true } } }, orgaRoleIds: ["role-orga"] } },
            }));
            discord.setClient(fakeMultiGuildClient({
                "guild-1": jest.fn().mockResolvedValue(memberWithRoles()),
                "guild-2": jest.fn().mockResolvedValue(memberWithRoles("role-orga")),
            }));
            const orga = await loginAs("705");
            auth.setActiveGuild(orga.req, "guild-1");
            const onA = auth.getUser(orga.req);
            expect(onA.isAdmin).toBe(false);
            expect(onA.isOrga).toBeFalsy();
            expect(onA.access.raids).toEqual({ read: false, write: false });
            auth.setActiveGuild(orga.req, "guild-2");
            expect(auth.getUser(orga.req)).toMatchObject({ isOrga: true, access: { raids: { read: true, write: true } } });

            discord.setClient(fakeMultiGuildClient({
                "guild-1": jest.fn().mockResolvedValue(memberWithRoles("role-admin")),
                "guild-2": jest.fn().mockRejectedValue(NOT_A_MEMBER),
            }));
            const admin = await loginAs("706");
            auth.setActiveGuild(admin.req, "guild-2");
            const onB = auth.getUser(admin.req);
            expect(onB.isAdmin).toBe(true);
            expect(onB.access.settings).toEqual({ read: true, write: true });
        });

        it("keeps only the base access without a throw when a member of no configured event server", async () => {
            getConfig.mockImplementation(() => onServer({ adminRoleIds: ["role-1"] }));
            discord.setClient(fakeMultiGuildClient({
                "guild-1": jest.fn().mockRejectedValue(NOT_A_MEMBER),
                "guild-2": jest.fn().mockRejectedValue(NOT_A_MEMBER),
            }));
            const { req } = await loginAs("703");
            expect(auth.getUser(req).isAdmin).toBe(false);
        });

        it("falls back to base access, not a crash, when no configured event server can be reached at all", async () => {
            getConfig.mockImplementation(() => onServer({ adminRoleIds: ["role-1"] }));
            discord.setClient(fakeMultiGuildClient({ "guild-1": "offline", "guild-2": "offline" }));
            const { req } = await loginAs("704");
            // resolveAccess() swallows the "no guild reachable" throw at login time,
            // same as an outage on the single-server setup — never a crash.
            expect(auth.getUser(req).isAdmin).toBe(false);
        });
    });

    describe("destroy", () => {
        it("removes a session so getUser no longer resolves it", async () => {
            axios.post.mockResolvedValue({ data: { access_token: "t" } });
            axios.get.mockResolvedValue({ data: { id: "1", username: "u" } });
            const sid = await auth.completeLogin("c");
            expect(auth.getUser({ headers: { cookie: `sid=${sid}` } })).not.toBeNull();

            auth.destroy(sid);
            expect(auth.getUser({ headers: { cookie: `sid=${sid}` } })).toBeNull();
            expect(storedSessions()).not.toHaveProperty(sid);
        });

        it("ignores a falsy sid without touching the stored sessions", async () => {
            axios.post.mockResolvedValue({ data: { access_token: "t" } });
            axios.get.mockResolvedValue({ data: { id: "2", username: "v" } });
            const sid = await auth.completeLogin("d");
            const before = storedSessions();

            expect(auth.destroy(undefined)).toBeUndefined();
            expect(auth.destroy("")).toBeUndefined();
            expect(storedSessions()).toEqual(before);
            expect(auth.getUser({ headers: { cookie: `sid=${sid}` } })).toMatchObject({ id: "2" });
        });
    });
});
