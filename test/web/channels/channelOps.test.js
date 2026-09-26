const { runSerial, summarize, eventStatusByChannel } = require("../../../src/web/channels/channelOps");

describe("web/channels/channelOps", () => {
    describe("runSerial", () => {
        it("runs one channel after another and reports each, failures included", async () => {
            const order = [];
            const results = await runSerial(["a", "b", "a", "c"], async (id) => {
                order.push(id);
                if (id === "b") throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
                return { name: `#${id}` };
            }, { pauseMs: 0 });
            expect(order).toEqual(["a", "b", "c"]);
            expect(results).toEqual([
                { id: "a", ok: true, name: "#a" },
                { id: "b", ok: false, error: "fehlende Rechte" },
                { id: "c", ok: true, name: "#c" },
            ]);
        });

        it("pauses between channels, not before the first", async () => {
            jest.useFakeTimers();
            const seen = [];
            const run = runSerial(["a", "b"], async (id) => seen.push(id), { pauseMs: 500 });
            await Promise.resolve();
            await Promise.resolve();
            expect(seen).toEqual(["a"]);
            await jest.advanceTimersByTimeAsync(500);
            await run;
            expect(seen).toEqual(["a", "b"]);
            jest.useRealTimers();
        });
    });

    describe("summarize", () => {
        it("says how many worked and why the rest failed, each reason once", () => {
            expect(summarize([
                { ok: true }, { ok: true }, { ok: true },
                { ok: false, error: "fehlende Rechte" },
            ]).message).toBe("3 Kanäle geändert, 1 fehlgeschlagen: fehlende Rechte");
            expect(summarize([{ ok: true }], "archiviert")).toEqual({ done: 1, failed: 0, message: "1 Kanal archiviert" });
        });
    });

    describe("eventStatusByChannel", () => {
        const now = 1_800_000_000_000;
        const s = now / 1000;

        it("marks the newest event of a channel as upcoming or past", () => {
            const status = eventStatusByChannel([
                { id: "e1", channelId: "c1", title: "SSC", startTime: s - 7 * 86400 },
                { id: "e2", channelId: "c1", title: "SSC", startTime: s + 86400 },
                { id: "e3", channelId: "c2", title: "Kara", startTime: s - 3 * 86400 },
                { id: "e4", channelId: "c3", title: "BT", startTime: s - 3600 },
                { id: "x", title: "ohne Kanal", startTime: s },
            ], { now });
            expect(status.c1).toMatchObject({ status: "event", eventId: "e2" });
            expect(status.c2).toMatchObject({ status: "past", title: "Kara" });
            // a raid that started an hour ago is still running, not "vergangen"
            expect(status.c3.status).toBe("event");
            expect(Object.keys(status)).toEqual(["c1", "c2", "c3"]);
        });
    });
});
