jest.mock("https");

const { EventEmitter } = require("events");
const https = require("https");
const Raidhelper = require("../../src/classes/raidhelper.js");

// Install a fake https.request implementation.
// - body: what the response stream should emit (string or object -> JSON).
//   Pass `undefined` to emit no "data" event at all (empty response).
// - error: if set, the request emits "error" instead of a response.
function respondWith(body, { error } = {}) {
    https.request.mockImplementation((options, callback) => {
        const req = new EventEmitter();
        req.write = jest.fn();
        req.end = jest.fn(() => {
            if (error) {
                req.emit("error", error);
                return;
            }
            const res = new EventEmitter();
            if (typeof callback === "function") callback(res);
            if (body !== undefined) {
                const chunk = typeof body === "string" ? body : JSON.stringify(body);
                res.emit("data", chunk);
            }
            res.emit("end");
        });
        return req;
    });
}

function lastOptions() {
    const calls = https.request.mock.calls;
    return calls[calls.length - 1][0];
}

describe("classes/Raidhelper", () => {
    const OLD_KEY = process.env.RAIDHELPER_API_KEY;
    const OLD_SERVER = process.env.RAIDHELPER_SERVER_ID;

    beforeEach(() => {
        process.env.RAIDHELPER_API_KEY = "test-key";
        process.env.RAIDHELPER_SERVER_ID = "server-42";
    });

    afterEach(() => {
        if (OLD_KEY === undefined) delete process.env.RAIDHELPER_API_KEY;
        else process.env.RAIDHELPER_API_KEY = OLD_KEY;
        if (OLD_SERVER === undefined) delete process.env.RAIDHELPER_SERVER_ID;
        else process.env.RAIDHELPER_SERVER_ID = OLD_SERVER;
    });

    describe("constructor / getEventOptions", () => {
        it("reads api key and server id from the environment", () => {
            const client = new Raidhelper();
            expect(client.apiKey).toBe("test-key");
            expect(client.serverId).toBe("server-42");
        });

        it("builds v4 event request options with auth header and filters", () => {
            const client = new Raidhelper();
            const options = client.getEventOptions(1700000000);
            expect(options).toEqual({
                host: "raid-helper.xyz",
                port: 443,
                path: "/api/v4/servers/server-42/events",
                method: "GET",
                headers: {
                    Authorization: "test-key",
                    StartTimeFilter: 1700000000,
                    IncludeSignups: true,
                },
            });
        });
    });

    describe("getAllEvents", () => {
        it("returns postedEvents sorted ascending by startTime", async () => {
            respondWith({
                postedEvents: [
                    { id: "b", startTime: 300 },
                    { id: "a", startTime: 100 },
                    { id: "c", startTime: 200 },
                ],
            });
            const client = new Raidhelper();

            const result = await client.getAllEvents();

            expect(result.map((e) => e.id)).toEqual(["a", "c", "b"]);
            const options = lastOptions();
            expect(options.method).toBe("GET");
            expect(options.path).toBe("/api/v4/servers/server-42/events");
            expect(options.headers.Authorization).toBe("test-key");
        });

        it("filters by now when no start time is given", async () => {
            respondWith({ postedEvents: [] });
            const now = Math.floor(Date.now() / 1000);
            await new Raidhelper().getAllEvents();
            const filter = lastOptions().headers.StartTimeFilter;
            expect(filter).toBeGreaterThanOrEqual(now);
            expect(filter).toBeLessThan(now + 5);
        });

        it("rejects when the API reports status failed", async () => {
            respondWith({ status: "failed", message: "bad key" });
            const client = new Raidhelper();

            await expect(client.getAllEvents()).rejects.toEqual({
                status: "failed",
                message: "bad key",
            });
        });

        it("rejects (does not throw) on a non-JSON error body", async () => {
            respondWith("Endpoint GET /api/v4/servers/events not found");
            const client = new Raidhelper();

            await expect(client.getAllEvents()).rejects.toBeInstanceOf(Error);
        });

        it("rejects when the request emits an error", async () => {
            respondWith(null, { error: new Error("socket hang up") });
            const client = new Raidhelper();

            await expect(client.getAllEvents()).rejects.toThrow("socket hang up");
        });
    });

    describe("getPastEvents", () => {
        const NOW = 1_700_000_000_000;
        let nowSpy;
        beforeEach(() => { nowSpy = jest.spyOn(Date, "now").mockReturnValue(NOW); });
        afterEach(() => nowSpy.mockRestore());
        const nowSecs = Math.floor(NOW / 1000);

        it("returns only events that already started, newest first", async () => {
            respondWith({
                postedEvents: [
                    { id: "old", startTime: nowSecs - 7200 },
                    { id: "upcoming", startTime: nowSecs + 3600 },
                    { id: "recent", startTime: nowSecs - 600 },
                ],
            });
            const client = new Raidhelper();

            const result = await client.getPastEvents(nowSecs - 86400);

            expect(result.map((e) => e.id)).toEqual(["recent", "old"]);
        });

        it("sends the given lower bound as StartTimeFilter", async () => {
            respondWith({ postedEvents: [] });
            await new Raidhelper().getPastEvents(1699999999);
            expect(lastOptions().headers.StartTimeFilter).toBe(1699999999);
        });

        it("falls back to now when no lower bound is given", async () => {
            respondWith({ postedEvents: [] });
            await new Raidhelper().getPastEvents();
            expect(lastOptions().headers.StartTimeFilter).toBe(nowSecs);
        });

        it("rejects when the API fails", async () => {
            respondWith({ status: "failed", message: "bad key" });
            await expect(new Raidhelper().getPastEvents(1)).rejects.toEqual({ status: "failed", message: "bad key" });
        });
    });

    describe("getTemplates", () => {
        it("derives distinct templates from events, keyed by templateId, sorted by name", async () => {
            respondWith({
                postedEvents: [
                    { id: "e1", startTime: 100, templateId: 3, templateName: "Karazhan" },
                    { id: "e2", startTime: 200, templateId: 7, templateName: "Molten Core" },
                    { id: "e3", startTime: 300, templateId: 3, templateName: "Karazhan" },
                ],
            });
            const client = new Raidhelper();

            const result = await client.getTemplates();

            expect(result).toEqual([
                { id: "3", name: "Karazhan" },
                { id: "7", name: "Molten Core" },
            ]);
        });

        it("falls back to the event title when no template name is present", async () => {
            respondWith({
                postedEvents: [{ id: "e1", startTime: 100, templateId: 5, title: "Fun Run" }],
            });
            const client = new Raidhelper();

            const result = await client.getTemplates();

            expect(result).toEqual([{ id: "5", name: "Fun Run" }]);
        });

        it("skips events without a templateId", async () => {
            respondWith({
                postedEvents: [
                    { id: "e1", startTime: 100, title: "No template" },
                    { id: "e2", startTime: 200, templateId: 9, templateName: "Real" },
                ],
            });
            const client = new Raidhelper();

            const result = await client.getTemplates();

            expect(result).toEqual([{ id: "9", name: "Real" }]);
        });

        it("returns an empty list when the events request fails", async () => {
            respondWith({ status: "failed", message: "bad key" });
            const client = new Raidhelper();

            await expect(client.getTemplates()).resolves.toEqual([]);
        });
    });

    describe("getUserSignUps", () => {
        const body = {
            postedEvents: [
                {
                    id: "later",
                    startTime: 200,
                    signUps: [{ userId: "u1", specName: "Fire" }],
                },
                {
                    id: "earlier",
                    startTime: 100,
                    signUps: [{ userId: "u2", specName: "Frost" }],
                },
                {
                    id: "absent",
                    startTime: 50,
                    signUps: [{ userId: "u1", specName: "Absence" }],
                },
            ],
        };

        it("returns only events the user signed up for (excluding Absence), sorted", async () => {
            respondWith(body);
            const client = new Raidhelper();

            const result = await client.getUserSignUps("u1");

            expect(result.map((e) => e.id)).toEqual(["later"]);
        });

        it("returns an empty list for a user with no non-absence signups", async () => {
            respondWith(body);
            const client = new Raidhelper();

            const result = await client.getUserSignUps("nobody");

            expect(result).toEqual([]);
        });
    });

    describe("getMissingSignUps", () => {
        it("returns channelIds of events the user did NOT sign up for", async () => {
            respondWith({
                postedEvents: [
                    {
                        startTime: 100,
                        channelId: "chan-a",
                        signUps: [{ userId: "u1", specName: "Fire" }],
                    },
                    {
                        startTime: 200,
                        channelId: "chan-b",
                        signUps: [{ userId: "u2", specName: "Frost" }],
                    },
                    {
                        startTime: 300,
                        channelId: "chan-c",
                        signUps: [{ userId: "u1", specName: "Absence" }],
                    },
                ],
            });
            const client = new Raidhelper();

            const result = await client.getMissingSignUps("u1");

            expect(result).toEqual(["chan-b", "chan-c"]);
        });
    });

    describe("getEvent", () => {
        it("GETs the v4 event path and returns parsed JSON", async () => {
            respondWith({ id: "evt-1", title: "Raid" });
            const client = new Raidhelper();

            const result = await client.getEvent("evt-1");

            expect(result).toEqual({ id: "evt-1", title: "Raid" });
            const options = lastOptions();
            expect(options.path).toBe("/api/v4/events/evt-1");
            expect(options.headers).toEqual({ Authorization: "test-key" });
        });

        it("rejects on invalid JSON", async () => {
            respondWith("not-json{");
            const client = new Raidhelper();

            await expect(client.getEvent("evt-1")).rejects.toBeInstanceOf(Error);
        });
    });

    describe("getSetup", () => {
        it("returns raidid, setup slots and startTime", async () => {
            respondWith({ slots: [{ id: 1 }], startTime: 1700000000 });
            const client = new Raidhelper();

            const result = await client.getSetup("raid-9");

            expect(result).toEqual({
                raidid: "raid-9",
                setup: [{ id: 1 }],
                startTime: 1700000000,
            });
            expect(lastOptions().path).toBe("/api/raidplan/raid-9");
        });

        it("falls back through date / start_time for startTime", async () => {
            respondWith({ slots: [], date: 42 });
            const client = new Raidhelper();

            const result = await client.getSetup("raid-9");

            expect(result.startTime).toBe(42);
        });

        it("resolves undefined when the response body is empty", async () => {
            respondWith(undefined);
            const client = new Raidhelper();

            const result = await client.getSetup("raid-9");

            expect(result).toBeUndefined();
        });

        it("resolves undefined (does not throw) on a non-JSON body", async () => {
            respondWith("Raidplan not found");
            const client = new Raidhelper();

            await expect(client.getSetup("raid-9")).resolves.toBeUndefined();
        });
    });

    describe("signUp / signUpToRaid", () => {
        it("POSTs a signup with the correct path, headers and body, resolving the raw response", async () => {
            respondWith("OK");
            const client = new Raidhelper();

            const result = await client.signUp(
                "raid-1",
                { className: "Mage", specName: "Fire" },
                "u1"
            );

            expect(result).toBe("OK");
            const options = lastOptions();
            expect(options.method).toBe("POST");
            expect(options.path).toBe("/api/v4/events/raid-1/signups");
            expect(options.headers.Authorization).toBe("test-key");
            expect(options.headers["Content-Type"]).toBe("application/json");

            // request.write got the JSON payload
            const req = https.request.mock.results[https.request.mock.results.length - 1].value;
            expect(req.write).toHaveBeenCalledWith(
                JSON.stringify({ userId: "u1", className: "Mage", specName: "Fire" })
            );
        });

        it("rejects when the request emits an error", async () => {
            respondWith(null, { error: new Error("socket hang up") });
            const client = new Raidhelper();

            await expect(
                client.signUp("raid-1", { className: "Mage", specName: "Fire" }, "u1")
            ).rejects.toThrow("socket hang up");
        });

        it("signUpToRaid issues one request per signup", async () => {
            respondWith("OK");
            const client = new Raidhelper();

            await client.signUpToRaid(
                "raid-1",
                [
                    { className: "Mage", specName: "Fire" },
                    { className: "Warrior", specName: "Fury" },
                ],
                "u1"
            );

            expect(https.request).toHaveBeenCalledTimes(2);
        });
    });

    describe("createEvent", () => {
        it("POSTs to the v4 servers/channels/event path with channelId excluded from the body", async () => {
            respondWith({ id: "evt-9", status: "success" });
            const client = new Raidhelper();

            const result = await client.createEvent({
                channelId: "chan-1",
                leaderId: "u1",
                templateId: "tpl-1",
                date: "05-03-2026",
                time: "20:00",
                title: "GDKP Kara",
                description: "Bring pots",
            });

            expect(result).toEqual({ id: "evt-9", status: "success" });
            const options = lastOptions();
            expect(options.method).toBe("POST");
            expect(options.path).toBe("/api/v4/servers/server-42/channels/chan-1/event");
            expect(options.headers.Authorization).toBe("test-key");

            const req = https.request.mock.results[https.request.mock.results.length - 1].value;
            expect(req.write).toHaveBeenCalledWith(JSON.stringify({
                leaderId: "u1",
                templateId: "tpl-1",
                date: "05-03-2026",
                time: "20:00",
                title: "GDKP Kara",
                description: "Bring pots",
            }));
        });

        it("surfaces Raid-Helper's structured failure payload (status/reason)", async () => {
            respondWith({ status: "failed", reason: "invalid token" });
            const client = new Raidhelper();

            const result = await client.createEvent({ channelId: "chan-1" });

            expect(result).toEqual({ status: "failed", reason: "invalid token" });
        });

        it("rejects with a descriptive error on a non-JSON response", async () => {
            respondWith("Endpoint POST /api/v4/servers/1/channels/2/event not found");
            const client = new Raidhelper();

            await expect(client.createEvent({ channelId: "chan-1" })).rejects.toThrow(
                /Unerwartete Antwort von Raid-Helper/
            );
        });

        it("rejects when the request emits an error", async () => {
            respondWith(null, { error: new Error("ECONNRESET") });
            const client = new Raidhelper();

            await expect(client.createEvent({ channelId: "chan-1" })).rejects.toThrow("ECONNRESET");
        });
    });

    describe("saveRaid", () => {
        // NOTE: BUG — saveRaid targets pulse-gdkp.de:3001 which is a plain HTTP
        // (non-TLS) port, yet it uses the `https` module. The request would fail
        // against the real server. These tests assert the CURRENT (buggy) behavior:
        // it still calls https.request with port 3001.
        it("POSTs to pulse-gdkp.de:3001 via https.request (documents the http/https bug)", async () => {
            respondWith({ imported: true });
            const client = new Raidhelper();

            const result = await client.saveRaid({ raid: "data" });

            expect(result).toEqual({ imported: true });
            const options = lastOptions();
            expect(options.host).toBe("pulse-gdkp.de");
            expect(options.port).toBe(3001); // non-TLS port used with the https module
            expect(options.path).toBe("/api/raids/import");
            expect(options.method).toBe("POST");

            const req = https.request.mock.results[https.request.mock.results.length - 1].value;
            expect(req.write).toHaveBeenCalledWith(JSON.stringify({ raid: "data" }));
        });

        it("rejects when the request emits an error", async () => {
            respondWith(null, { error: new Error("ECONNRESET") });
            const client = new Raidhelper();

            await expect(client.saveRaid({ raid: "data" })).rejects.toThrow(
                "ECONNRESET"
            );
        });
    });
});
