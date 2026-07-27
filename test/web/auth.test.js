jest.mock("axios");
jest.mock("../../src/config/variables", () => ({
    discordClientId: "client-id-123",
    discordClientSecret: "secret-xyz",
    publicBaseUrl: "https://logs.example.com",
    logcheckAdminIds: ["233598324022837249"],
    adminRoleIds: [],
    guildId: "guild-1",
    devAutoLogin: false,
}));
jest.mock("../../src/web/settingsStore", () => ({
    getConfig: jest.fn(() => ({ adminRoleIds: [] })),
}));

const axios = require("axios");
const { getConfig } = require("../../src/web/settingsStore");
const auth = require("../../src/web/auth.js");

// Flush the background admin re-check kicked off by sessionFor().
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** A fake bot client whose guild resolves members via the given fetch impl. */
function fakeClient(memberFetch) {
    const guild = { members: { fetch: memberFetch } };
    return {
        guild,
        client: { guilds: { cache: { get: () => guild }, fetch: jest.fn() } },
    };
}

/** A fake guild member holding exactly the given role ids. */
function memberWithRoles(...roleIds) {
    return { roles: { cache: { has: (id) => roleIds.includes(id) } } };
}

describe("web/auth", () => {
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
        });

        it("falls back to username and marks non-admins", async () => {
            axios.get.mockResolvedValue({
                data: { id: "999", username: "plainuser", global_name: null },
            });

            const sid = await auth.completeLogin("code2");
            const user = auth.getUser({ headers: { cookie: `sid=${sid}` } });
            expect(user).toMatchObject({ id: "999", name: "plainuser", isAdmin: false });
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
            auth.setClient(null);
            getConfig.mockImplementation(() => ({ adminRoleIds: [] }));
        });

        async function loginAs(id) {
            axios.get.mockResolvedValue({ data: { id, username: `user-${id}` } });
            const sid = await auth.completeLogin(`code-${id}`);
            return { sid, req: { headers: { cookie: `sid=${sid}` } } };
        }

        it("grants admin at login when the member has a configured role", async () => {
            getConfig.mockImplementation(() => ({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            auth.setClient(fakeClient(fetch).client);

            const { req } = await loginAs("555");
            expect(auth.getUser(req).isAdmin).toBe(true);
            expect(fetch).toHaveBeenCalledWith("555");
        });

        it("upgrades an existing session once roles are added and the cache expires", async () => {
            const { req } = await loginAs("556");
            expect(auth.getUser(req).isAdmin).toBe(false);

            // Admin adds a role id in the settings afterwards:
            getConfig.mockImplementation(() => ({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            auth.setClient(fakeClient(fetch).client);

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

        it("re-checks only once per cache window", async () => {
            getConfig.mockImplementation(() => ({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            auth.setClient(fakeClient(fetch).client);

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
            getConfig.mockImplementation(() => ({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            auth.setClient(fakeClient(fetch).client);
            const { req } = await loginAs("558");
            expect(auth.getUser(req).isAdmin).toBe(true);

            fetch.mockRejectedValue(new Error("network down"));
            now += FIVE_MIN + 1000;
            auth.getUser(req);
            await flush();
            expect(auth.getUser(req).isAdmin).toBe(true); // not demoted by an outage
        });

        it("demotes a session whose user left the guild (Unknown Member)", async () => {
            getConfig.mockImplementation(() => ({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            auth.setClient(fakeClient(fetch).client);
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
            getConfig.mockImplementation(() => ({ adminRoleIds: ["role-1"] }));
            const fetch = jest.fn().mockResolvedValue(memberWithRoles("role-1"));
            auth.setClient(fakeClient(fetch).client);
            const { req } = await loginAs("560");
            expect(auth.getUser(req).isAdmin).toBe(true);

            getConfig.mockImplementation(() => ({ adminRoleIds: [] }));
            now += FIVE_MIN + 1000;
            auth.getUser(req);
            await flush();
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
        });

        it("tolerates a falsy sid", () => {
            expect(() => auth.destroy(undefined)).not.toThrow();
        });
    });
});
