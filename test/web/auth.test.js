jest.mock("axios");
jest.mock("../../src/config/variables", () => ({
    discordClientId: "client-id-123",
    discordClientSecret: "secret-xyz",
    publicBaseUrl: "https://logs.example.com",
    logcheckAdminIds: ["233598324022837249"],
}));

const axios = require("axios");
const auth = require("../../src/web/auth.js");

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
