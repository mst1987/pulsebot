// The network guard from test/setup/noNetwork.js is installed for every suite
// (jest.config.js `setupFiles`), so these tests exercise the real thing.
const http = require("http");
const https = require("https");
const axios = require("axios");
const { NetworkBlockedError, isLoopback, targetOf, MESSAGE } = require("./noNetwork");

describe("test/setup/noNetwork", () => {
    it("rejects an unmocked axios.get with a clear message", async () => {
        await expect(axios.get("https://raid-helper.xyz/api/v2/events")).rejects.toThrow(MESSAGE);
        await expect(axios.get("https://raid-helper.xyz/x")).rejects.toBeInstanceOf(NetworkBlockedError);
    });

    it("also guards axios instances made with axios.create()", async () => {
        const client = axios.create({ baseURL: "https://pulse-gdkp.de:3001/api" });
        await expect(client.get("/legendary")).rejects.toThrow(/pulse-gdkp\.de/);
    });

    it("throws for http(s).request and http(s).get to another host", () => {
        expect(() => https.request("https://discord.com/api")).toThrow(MESSAGE);
        expect(() => https.get({ hostname: "discord.com", path: "/" })).toThrow(NetworkBlockedError);
        expect(() => http.request({ host: "example.com", port: 80 })).toThrow(/example\.com/);
        expect(() => http.get(new URL("http://example.com/x"))).toThrow(MESSAGE);
    });

    it("rejects an unmocked fetch", async () => {
        await expect(globalThis.fetch("https://www.warcraftlogs.com/api")).rejects.toThrow(MESSAGE);
    });

    it("lets loopback requests through (suites that start their own server)", async () => {
        const server = http.createServer((req, res) => res.end("ok"));
        await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address();
        try {
            const body = await new Promise((resolve, reject) => {
                http.get({ host: "127.0.0.1", port, path: "/" }, (res) => {
                    let b = "";
                    res.on("data", (c) => { b += c; });
                    res.on("end", () => resolve(b));
                }).on("error", reject);
            });
            expect(body).toBe("ok");
            expect((await axios.get(`http://localhost:${port}/`)).data).toBe("ok");
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    describe("helpers", () => {
        it("recognises loopback hosts", () => {
            expect(isLoopback("localhost")).toBe(true);
            expect(isLoopback("127.0.0.1")).toBe(true);
            expect(isLoopback("127.1.2.3")).toBe(true);
            expect(isLoopback("::1")).toBe(true);
            expect(isLoopback("[::1]")).toBe(true);
            expect(isLoopback("discord.com")).toBe(false);
            expect(isLoopback("")).toBe(false);
        });

        it("reads the target host from every request signature", () => {
            expect(targetOf(["https://a.example/x"]).host).toBe("a.example");
            expect(targetOf([new URL("http://b.example:8080/")]).host).toBe("b.example");
            expect(targetOf(["https://a.example/x", { hostname: "c.example" }]).host).toBe("c.example");
            expect(targetOf([{ host: "d.example:443" }]).host).toBe("d.example");
            expect(targetOf([{ socketPath: "/tmp/s" }]).socketPath).toBe("/tmp/s");
            expect(targetOf([{}]).host).toBe("localhost");
            expect(targetOf([]).host).toBe("localhost");
        });
    });
});

describe("test/setup/noNetwork with a mocked module", () => {
    it("keeps jest.mock in charge (the mock replaces the guarded module)", async () => {
        let mocked;
        jest.isolateModules(() => {
            jest.doMock("axios", () => ({ get: jest.fn(async () => ({ data: "mocked" })) }));
            mocked = require("axios");
        });
        await expect(mocked.get("https://raid-helper.xyz")).resolves.toEqual({ data: "mocked" });
        jest.dontMock("axios");
    });
});
