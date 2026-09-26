jest.mock("axios", () => require("../helpers/axiosMock").mockAxios());

const { transport, reply, fail, timeout, respond, sent } = require("../helpers/axiosMock");
const Raidhelper = require("../../src/classes/raidhelper.js");

// Raid-Helper answers every request with a body, JSON or plain text, whatever
// the status; the client judges the body. `respondWith` answers every request
// of the test the same way (retries included).
function respondWith(body, { status = 200, error, hang } = {}) {
    let handler;
    if (hang) handler = timeout();
    else if (error) handler = fail(error.message, error.code || "ECONNRESET");
    else handler = reply(status, body === undefined ? "" : (typeof body === "string" ? body : JSON.stringify(body)));
    transport.mockImplementation(handler);
}

function lastRequest() {
    const cfg = sent();
    return { ...cfg, fullUrl: `${cfg.baseURL}${cfg.url}` };
}

describe("classes/Raidhelper", () => {
    const OLD_KEY = process.env.RAIDHELPER_API_KEY;
    const OLD_SERVER = process.env.RAIDHELPER_SERVER_ID;

    beforeEach(() => {
        transport.mockReset();
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

        it("takes the server id from the options over the environment", () => {
            expect(new Raidhelper({ serverId: "from-settings" }).serverId).toBe("from-settings");
        });

        it("builds the v4 event request with the start-time filter", () => {
            const client = new Raidhelper();
            expect(client.getEventOptions(1700000000)).toEqual({
                method: "GET",
                url: "v4/servers/server-42/events",
                headers: { StartTimeFilter: 1700000000, IncludeSignups: true },
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
            const result = await new Raidhelper().getAllEvents();

            expect(result.map((e) => e.id)).toEqual(["a", "c", "b"]);
            const req = lastRequest();
            expect(req.method).toBe("get");
            expect(req.fullUrl).toBe("https://raid-helper.xyz/api/v4/servers/server-42/events");
            expect(req.headers.Authorization).toBe("test-key");
            expect(String(req.headers.IncludeSignups)).toBe("true");
        });

        it("filters by now when no start time is given", async () => {
            respondWith({ postedEvents: [] });
            const now = Math.floor(Date.now() / 1000);
            await new Raidhelper().getAllEvents();
            const filter = Number(lastRequest().headers.StartTimeFilter);
            expect(filter).toBeGreaterThanOrEqual(now);
            expect(filter).toBeLessThan(now + 5);
        });

        it("rejects with the payload when the API reports status failed", async () => {
            respondWith({ status: "failed", message: "bad key" });
            await expect(new Raidhelper().getAllEvents()).rejects.toEqual({ status: "failed", message: "bad key" });
        });

        it("reads a failure payload sent with an HTTP error status the same way", async () => {
            respondWith({ status: "failed", message: "bad key" }, { status: 401 });
            await expect(new Raidhelper().getAllEvents()).rejects.toEqual({ status: "failed", message: "bad key" });
            expect(transport).toHaveBeenCalledTimes(1);
        });

        it("rejects (does not throw) on a non-JSON error body, naming the status", async () => {
            respondWith("Endpoint GET /api/v4/servers/events not found", { status: 404 });
            await expect(new Raidhelper().getAllEvents()).rejects.toThrow(
                "Unerwartete Antwort von Raid-Helper (HTTP 404): Endpoint GET /api/v4/servers/events not found"
            );
        });

        it("rejects when the answer carries no event list", async () => {
            respondWith({ something: "else" });
            await expect(new Raidhelper().getAllEvents()).rejects.toThrow("Raid-Helper lieferte keine Events.");
            respondWith("null");
            await expect(new Raidhelper().getAllEvents()).rejects.toThrow("Raid-Helper lieferte keine Events.");
        });

        it("rejects when the request fails, after retrying it", async () => {
            respondWith(null, { error: new Error("socket hang up") });
            await expect(new Raidhelper().getAllEvents()).rejects.toThrow("socket hang up");
            expect(transport).toHaveBeenCalledTimes(3);
        });

        it("retries a 5xx and uses the later answer", async () => {
            respond(reply(502, "Bad Gateway"), reply(200, JSON.stringify({ postedEvents: [{ id: "a", startTime: 1 }] })));
            const result = await new Raidhelper().getAllEvents();
            expect(result.map((e) => e.id)).toEqual(["a"]);
        });
    });

    // A request that is accepted and then never answered used to leave the
    // promise pending forever, which hung whatever admin action triggered it
    // until the reverse proxy answered 504 (see "fehlende Raider pingen").
    describe("request timeout", () => {
        it("caps every request at 20 s", async () => {
            respondWith({ postedEvents: [] });
            await new Raidhelper().getAllEvents();
            expect(lastRequest().timeout).toBe(20000);
            expect(Raidhelper.REQUEST_TIMEOUT_MS).toBe(20000);
        });

        it("rejects with a timeout error when the server never answers, without retrying", async () => {
            respondWith(null, { hang: true });
            await expect(new Raidhelper().getAllEvents()).rejects.toThrow(/nicht innerhalb von 20s geantwortet/);
            expect(transport).toHaveBeenCalledTimes(1);
        });

        it("rejects getUserSignUps on timeout rather than leaving it pending", async () => {
            respondWith(null, { hang: true });
            await expect(new Raidhelper().getUserSignUps("u1")).rejects.toThrow(/nicht innerhalb von 20s geantwortet/);
        });

        it("resolves getSetup to undefined on timeout (no setup, not a crash)", async () => {
            respondWith(null, { hang: true });
            await expect(new Raidhelper().getSetup("r1")).resolves.toBeUndefined();
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
            const result = await new Raidhelper().getPastEvents(nowSecs - 86400);
            expect(result.map((e) => e.id)).toEqual(["recent", "old"]);
        });

        it("sends the given lower bound as StartTimeFilter", async () => {
            respondWith({ postedEvents: [] });
            await new Raidhelper().getPastEvents(1699999999);
            expect(Number(lastRequest().headers.StartTimeFilter)).toBe(1699999999);
        });

        it("falls back to now when no lower bound is given", async () => {
            respondWith({ postedEvents: [] });
            await new Raidhelper().getPastEvents();
            expect(Number(lastRequest().headers.StartTimeFilter)).toBe(nowSecs);
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
            expect(await new Raidhelper().getTemplates()).toEqual([
                { id: "3", name: "Karazhan" },
                { id: "7", name: "Molten Core" },
            ]);
        });

        it("falls back to the event title when no template name is present", async () => {
            respondWith({ postedEvents: [{ id: "e1", startTime: 100, templateId: 5, title: "Fun Run" }] });
            expect(await new Raidhelper().getTemplates()).toEqual([{ id: "5", name: "Fun Run" }]);
        });

        it("keeps a template without any name under its id", async () => {
            respondWith({ postedEvents: [{ id: "e1", startTime: 100, templateId: 5 }, { id: "e2", startTime: 1, templateId: 2, templateName: "A" }] });
            expect(await new Raidhelper().getTemplates()).toEqual([{ id: "5", name: "" }, { id: "2", name: "A" }]);
        });

        it("skips events without a templateId", async () => {
            respondWith({
                postedEvents: [
                    { id: "e1", startTime: 100, title: "No template" },
                    { id: "e2", startTime: 200, templateId: 9, templateName: "Real" },
                ],
            });
            expect(await new Raidhelper().getTemplates()).toEqual([{ id: "9", name: "Real" }]);
        });

        it("returns an empty list when the events request fails", async () => {
            respondWith({ status: "failed", message: "bad key" });
            await expect(new Raidhelper().getTemplates()).resolves.toEqual([]);
            respondWith(null, { hang: true });
            await expect(new Raidhelper().getTemplates()).resolves.toEqual([]);
        });
    });

    describe("getUserSignUps", () => {
        const body = {
            postedEvents: [
                { id: "later", startTime: 200, signUps: [{ userId: "u1", specName: "Fire" }] },
                { id: "earlier", startTime: 100, signUps: [{ userId: "u2", specName: "Frost" }] },
                { id: "absent", startTime: 50, signUps: [{ userId: "u1", specName: "Absence" }] },
                { id: "empty", startTime: 60 },
            ],
        };

        it("returns only events the user signed up for (excluding Absence), sorted", async () => {
            respondWith({
                postedEvents: [
                    { id: "b", startTime: 300, signUps: [{ userId: "u1", specName: "Fire" }] },
                    ...body.postedEvents,
                ],
            });
            const result = await new Raidhelper().getUserSignUps("u1");
            expect(result.map((e) => e.id)).toEqual(["later", "b"]);
        });

        it("returns an empty list for a user with no non-absence signups", async () => {
            respondWith(body);
            expect(await new Raidhelper().getUserSignUps("nobody")).toEqual([]);
        });

        it("rejects on a non-JSON body instead of crashing the process", async () => {
            respondWith("Internal oops", { status: 400 });
            await expect(new Raidhelper().getUserSignUps("u1")).rejects.toThrow(/Unerwartete Antwort/);
        });
    });

    describe("getMissingSignUps", () => {
        it("returns channelIds of events the user did NOT sign up for, in start order", async () => {
            respondWith({
                postedEvents: [
                    { startTime: 300, channelId: "chan-c", signUps: [{ userId: "u1", specName: "Absence" }] },
                    { startTime: 100, channelId: "chan-a", signUps: [{ userId: "u1", specName: "Fire" }] },
                    { startTime: 200, channelId: "chan-b", signUps: [{ userId: "u2", specName: "Frost" }] },
                ],
            });
            expect(await new Raidhelper().getMissingSignUps("u1")).toEqual(["chan-b", "chan-c"]);
        });

        it("rejects when the API fails", async () => {
            respondWith({ status: "failed", message: "bad key" });
            await expect(new Raidhelper().getMissingSignUps("u1")).rejects.toEqual({ status: "failed", message: "bad key" });
        });
    });

    describe("getEvent", () => {
        it("GETs the v4 event path with only the auth header and returns parsed JSON", async () => {
            respondWith({ id: "evt-1", title: "Raid" });
            const result = await new Raidhelper().getEvent("evt-1");

            expect(result).toEqual({ id: "evt-1", title: "Raid" });
            const req = lastRequest();
            expect(req.fullUrl).toBe("https://raid-helper.xyz/api/v4/events/evt-1");
            expect(req.headers.Authorization).toBe("test-key");
            expect(req.headers.StartTimeFilter).toBeUndefined();
        });

        it("resolves a JSON failure payload sent with a 404", async () => {
            respondWith({ status: "failed", reason: "not found" }, { status: 404 });
            expect(await new Raidhelper().getEvent("x")).toEqual({ status: "failed", reason: "not found" });
        });

        it("rejects on invalid JSON", async () => {
            respondWith("not-json{");
            await expect(new Raidhelper().getEvent("evt-1")).rejects.toBeInstanceOf(Error);
        });
    });

    describe("getSetup", () => {
        it("returns raidid, setup slots and startTime", async () => {
            respondWith({ slots: [{ id: 1 }], startTime: 1700000000 });
            const result = await new Raidhelper().getSetup("raid-9");

            expect(result).toEqual({ raidid: "raid-9", setup: [{ id: 1 }], startTime: 1700000000 });
            expect(lastRequest().fullUrl).toBe("https://raid-helper.xyz/api/raidplan/raid-9");
        });

        it("falls back through date / start_time for startTime, else null", async () => {
            respondWith({ slots: [], date: 42 });
            expect((await new Raidhelper().getSetup("raid-9")).startTime).toBe(42);
            respondWith({ slots: [], start_time: 7 });
            expect((await new Raidhelper().getSetup("raid-9")).startTime).toBe(7);
            respondWith({ slots: [] });
            expect((await new Raidhelper().getSetup("raid-9")).startTime).toBeNull();
        });

        it("resolves undefined when the response body is empty", async () => {
            respondWith(undefined);
            expect(await new Raidhelper().getSetup("raid-9")).toBeUndefined();
        });

        it("resolves undefined (does not throw) on a non-JSON body", async () => {
            respondWith("Raidplan not found", { status: 404 });
            await expect(new Raidhelper().getSetup("raid-9")).resolves.toBeUndefined();
        });

        it("resolves undefined on a JSON null and on a network error", async () => {
            respondWith("null");
            await expect(new Raidhelper().getSetup("raid-9")).resolves.toBeUndefined();
            respondWith(null, { error: new Error("ECONNRESET") });
            await expect(new Raidhelper().getSetup("raid-9")).resolves.toBeUndefined();
        });
    });

    describe("signUp / signUpToRaid", () => {
        it("POSTs a signup with the correct path, headers and body, resolving the raw response", async () => {
            respondWith("OK");
            const result = await new Raidhelper().signUp("raid-1", { className: "Mage", specName: "Fire" }, "u1");

            expect(result).toBe("OK");
            const req = lastRequest();
            expect(req.method).toBe("post");
            expect(req.fullUrl).toBe("https://raid-helper.xyz/api/v4/events/raid-1/signups");
            expect(req.headers.Authorization).toBe("test-key");
            expect(req.headers["Content-Type"]).toBe("application/json");
            expect(req.data).toBe(JSON.stringify({ userId: "u1", className: "Mage", specName: "Fire" }));
        });

        it("resolves the raw body of a refused signup too", async () => {
            respondWith("{\"status\":\"failed\"}", { status: 400 });
            expect(await new Raidhelper().signUp("raid-1", { className: "Mage", specName: "Fire" }, "u1")).toBe("{\"status\":\"failed\"}");
        });

        it("rejects when the request fails, and never repeats the POST", async () => {
            respondWith(null, { error: new Error("socket hang up") });
            await expect(
                new Raidhelper().signUp("raid-1", { className: "Mage", specName: "Fire" }, "u1")
            ).rejects.toThrow("socket hang up");
            expect(transport).toHaveBeenCalledTimes(1);
        });

        it("signUpToRaid issues one request per signup, in order", async () => {
            respondWith("OK");
            await new Raidhelper().signUpToRaid(
                "raid-1",
                [{ className: "Mage", specName: "Fire" }, { className: "Warrior", specName: "Fury" }],
                "u1"
            );
            expect(transport).toHaveBeenCalledTimes(2);
            expect(JSON.parse(sent(0).data).className).toBe("Mage");
            expect(JSON.parse(sent(1).data).className).toBe("Warrior");
        });
    });

    describe("createEvent", () => {
        it("POSTs to the v4 servers/channels/event path with channelId excluded from the body", async () => {
            respondWith({ id: "evt-9", status: "success" });
            const result = await new Raidhelper().createEvent({
                channelId: "chan-1",
                leaderId: "u1",
                templateId: "tpl-1",
                date: "05-03-2026",
                time: "20:00",
                title: "GDKP Kara",
                description: "Bring pots",
            });

            expect(result).toEqual({ id: "evt-9", status: "success" });
            const req = lastRequest();
            expect(req.method).toBe("post");
            expect(req.fullUrl).toBe("https://raid-helper.xyz/api/v4/servers/server-42/channels/chan-1/event");
            expect(req.headers.Authorization).toBe("test-key");
            expect(req.data).toBe(JSON.stringify({
                leaderId: "u1",
                templateId: "tpl-1",
                date: "05-03-2026",
                time: "20:00",
                title: "GDKP Kara",
                description: "Bring pots",
            }));
        });

        it("surfaces Raid-Helper's structured failure payload (status/reason), whatever the HTTP status", async () => {
            respondWith({ status: "failed", reason: "invalid token" });
            expect(await new Raidhelper().createEvent({ channelId: "chan-1" })).toEqual({ status: "failed", reason: "invalid token" });
            respondWith({ status: "failed", reason: "invalid token" }, { status: 403 });
            expect(await new Raidhelper().createEvent({ channelId: "chan-1" })).toEqual({ status: "failed", reason: "invalid token" });
        });

        it("rejects with a descriptive error on a non-JSON response", async () => {
            respondWith("Endpoint POST /api/v4/servers/1/channels/2/event not found", { status: 404 });
            await expect(new Raidhelper().createEvent({ channelId: "chan-1" })).rejects.toThrow(
                /Unerwartete Antwort von Raid-Helper \(HTTP 404\)/
            );
        });

        it("never creates the event twice: no retry on 5xx or on a dropped connection", async () => {
            respond(reply(503, "busy"), reply(200, "{}"));
            await expect(new Raidhelper().createEvent({ channelId: "chan-1" })).rejects.toThrow(/HTTP 503/);
            expect(transport).toHaveBeenCalledTimes(1);

            transport.mockReset();
            respondWith(null, { error: new Error("ECONNRESET") });
            await expect(new Raidhelper().createEvent({ channelId: "chan-1" })).rejects.toThrow("ECONNRESET");
            expect(transport).toHaveBeenCalledTimes(1);
        });
    });
});
