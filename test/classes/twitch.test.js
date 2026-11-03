const Twitch = require("../../src/classes/twitch");

const SECRET = "geheim-123";

function clientWith({ get = jest.fn(), post = jest.fn() } = {}) {
    const client = new Twitch({ clientId: "id", clientSecret: SECRET });
    post.mockResolvedValue({ data: { access_token: "tok", expires_in: 3600 } });
    client.http = { get, post };
    return client;
}

const answer = (data) => ({ data: { data } });
const loginsOf = (url) => [...new URL(url).searchParams.getAll("user_login")];

describe("Twitch client", () => {
    const envId = process.env.TWITCH_CLIENT_ID;
    const envSecret = process.env.TWITCH_CLIENT_SECRET;

    afterEach(() => {
        for (const [key, value] of [["TWITCH_CLIENT_ID", envId], ["TWITCH_CLIENT_SECRET", envSecret]]) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    describe("isConfigured", () => {
        it("needs both credentials, the env is the fallback", () => {
            delete process.env.TWITCH_CLIENT_ID;
            delete process.env.TWITCH_CLIENT_SECRET;
            expect(new Twitch().isConfigured()).toBe(false);
            expect(new Twitch({ clientId: "id" }).isConfigured()).toBe(false);
            expect(new Twitch({ clientId: "id", clientSecret: "s" }).isConfigured()).toBe(true);
            process.env.TWITCH_CLIENT_ID = "env-id";
            process.env.TWITCH_CLIENT_SECRET = "env-secret";
            expect(new Twitch().isConfigured()).toBe(true);
        });
    });

    describe("getToken", () => {
        it("asks with client credentials and keeps the token until shortly before it expires", async () => {
            const client = clientWith();
            await expect(client.getToken()).resolves.toBe("tok");
            await client.getToken();

            expect(client.http.post).toHaveBeenCalledTimes(1);
            const [url, form] = client.http.post.mock.calls[0];
            expect(url).toBe("https://id.twitch.tv/oauth2/token");
            expect(new URLSearchParams(form).get("grant_type")).toBe("client_credentials");
            expect(new URLSearchParams(form).get("client_secret")).toBe(SECRET);

            client._tokenExpiry = Date.now() - 1;
            await client.getToken();
            expect(client.http.post).toHaveBeenCalledTimes(2);
        });

        it("shares one request between parallel callers", async () => {
            const client = clientWith();
            await Promise.all([client.getToken(), client.getToken()]);
            expect(client.http.post).toHaveBeenCalledTimes(1);
        });
    });

    describe("getStreams", () => {
        it("asks Helix with token and client id", async () => {
            const client = clientWith({ get: jest.fn().mockResolvedValue(answer([{ id: "s1" }])) });
            await expect(client.getStreams(["foo", "bar"])).resolves.toEqual([{ id: "s1" }]);

            const [url, opts] = client.http.get.mock.calls[0];
            expect(url).toContain("https://api.twitch.tv/helix/streams?");
            expect(loginsOf(url)).toEqual(["foo", "bar"]);
            expect(new URL(url).searchParams.get("first")).toBe("100");
            expect(opts.headers).toEqual({ Authorization: "Bearer tok", "Client-Id": "id" });
        });

        it("asks for a double login once", async () => {
            const client = clientWith({ get: jest.fn().mockResolvedValue(answer([])) });
            await client.getStreams(["foo", "foo", "bar"]);
            expect(loginsOf(client.http.get.mock.calls[0][0])).toEqual(["foo", "bar"]);
        });

        it("splits more than 100 logins into requests of 100", async () => {
            const get = jest.fn()
                .mockResolvedValueOnce(answer([{ id: "a" }]))
                .mockResolvedValueOnce(answer([{ id: "b" }]))
                .mockResolvedValueOnce(answer([{ id: "c" }]));
            const client = clientWith({ get });
            const logins = Array.from({ length: 250 }, (_, i) => `name${i}`);

            await expect(client.getStreams(logins)).resolves.toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);

            expect(get.mock.calls.map(([url]) => loginsOf(url).length)).toEqual([100, 100, 50]);
            expect(new Set(get.mock.calls.flatMap(([url]) => loginsOf(url))).size).toBe(250);
            expect(Twitch.LOGINS_PER_REQUEST).toBe(100);
        });

        it("asks nothing for no logins", async () => {
            const client = clientWith();
            await expect(client.getStreams([])).resolves.toEqual([]);
            await expect(client.getStreams(undefined)).resolves.toEqual([]);
            expect(client.http.get).not.toHaveBeenCalled();
        });

        it("reads an answer without a list as no streams", async () => {
            const client = clientWith({ get: jest.fn().mockResolvedValue({ data: {} }) });
            await expect(client.getStreams(["foo"])).resolves.toEqual([]);
        });

        it("fetches a new token once after a 401 and asks again", async () => {
            const get = jest.fn().mockRejectedValueOnce({ status: 401 }).mockResolvedValueOnce(answer([{ id: "s1" }]));
            const client = clientWith({ get });
            await expect(client.getStreams(["foo"])).resolves.toEqual([{ id: "s1" }]);
            expect(client.http.post).toHaveBeenCalledTimes(2);
            expect(get).toHaveBeenCalledTimes(2);
        });

        it("throws on a second 401", async () => {
            const client = clientWith({ get: jest.fn().mockRejectedValue({ status: 401 }) });
            await expect(client.getStreams(["foo"])).rejects.toEqual({ status: 401 });
            expect(client.http.get).toHaveBeenCalledTimes(2);
        });

        it.each([
            ["a 429", { status: 429 }],
            ["a 500", { status: 500 }],
            ["a timeout", { kind: "timeout" }],
        ])("throws on %s instead of answering nobody is live", async (_name, failure) => {
            const client = clientWith({ get: jest.fn().mockRejectedValue(failure) });
            await expect(client.getStreams(["foo"])).rejects.toEqual(failure);
            expect(client.http.get).toHaveBeenCalledTimes(1);
        });
    });
});
