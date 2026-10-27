// The WCL guild list of a server (#922): its final shape, the identity of an
// entry, and that a settings PATCH never writes the job's fields.
const {
    INTERVALS, DEFAULT_INTERVAL, REGIONS, entryKey, normalizeWclGuilds, wclGuildsOf, allWclGuilds, wclGuildsFromBody,
} = require("../../../src/services/logcheck/wclGuildSettings");

const entry = (over = {}) => ({ versionId: "tbc", guildName: "Pulse", realm: "Thunderstrike", region: "EU", interval: 60, ...over });

describe("services/logcheck/wclGuildSettings (#922)", () => {
    it("offers off, 15/30/60 minutes and 3/6/24 hours, 60 by default, the WCL regions", () => {
        expect(INTERVALS).toEqual([0, 15, 30, 60, 180, 360, 1440]);
        expect(DEFAULT_INTERVAL).toBe(60);
        expect(REGIONS).toEqual(["EU", "US", "KR", "TW", "CN"]);
    });

    describe("entryKey", () => {
        it("is version, guild, realm and region, case-blind on the names", () => {
            expect(entryKey(entry())).toBe("tbc|pulse|thunderstrike|EU");
            expect(entryKey(entry({ guildName: " PULSE ", realm: "thunderstrike", region: "eu" }))).toBe("tbc|pulse|thunderstrike|EU");
        });

        it("defaults the region to EU and copes with nothing", () => {
            expect(entryKey(entry({ region: "" }))).toBe("tbc|pulse|thunderstrike|EU");
            expect(entryKey(null)).toBe("|||EU");
        });
    });

    describe("normalizeWclGuilds", () => {
        it("trims, upper-cases the region and keeps the job's fields", () => {
            const out = normalizeWclGuilds([{
                ...entry({ guildName: " Pulse ", realm: " Thunderstrike ", region: "us" }),
                lastRunAt: 123, lastSuccessAt: 120, lastResult: { found: 2.7, error: "", at: 123 },
            }]);
            expect(out).toEqual([{
                versionId: "tbc", guildName: "Pulse", realm: "Thunderstrike", region: "US", interval: 60,
                lastRunAt: 123, lastSuccessAt: 120, lastResult: { found: 2, error: "", at: 123 },
            }]);
        });

        it("drops entries without guild, realm or a known version, and non-objects", () => {
            expect(normalizeWclGuilds([
                entry({ guildName: "" }), entry({ realm: " " }), entry({ versionId: "nope" }), null, "x", [1],
            ])).toEqual([]);
            expect(normalizeWclGuilds("not a list")).toEqual([]);
        });

        it("an unknown interval becomes the default, an unknown region EU, 0 stays off", () => {
            const [a, b] = normalizeWclGuilds([entry({ interval: 7, region: "Mars" }), entry({ versionId: "classic", interval: 0 })]);
            expect(a).toMatchObject({ interval: 60, region: "EU" });
            expect(b).toMatchObject({ interval: 0 });
        });

        it("keeps one entry per key (the first)", () => {
            const out = normalizeWclGuilds([entry({ interval: 15 }), entry({ guildName: "pulse", interval: 30 })]);
            expect(out).toHaveLength(1);
            expect(out[0].interval).toBe(15);
        });

        it("caps the names and the error text", () => {
            const [e] = normalizeWclGuilds([{ ...entry({ guildName: "g".repeat(80) }), lastResult: { error: "e".repeat(400) } }]);
            expect(e.guildName).toHaveLength(64);
            expect(e.lastResult.error).toHaveLength(300);
            expect(normalizeWclGuilds([{ ...entry(), lastResult: [] }])[0].lastResult).toBeNull();
        });
    });

    describe("wclGuildsOf / allWclGuilds", () => {
        const config = {
            serverSettings: {
                g1: { wclGuilds: [entry(), entry({ versionId: "classic", guildName: "Alt" })] },
                g2: { wclGuilds: [entry({ guildName: "Other" })] },
                g3: { logChannels: [] },
            },
        };

        it("reads the list of one server, [] for a server without one", () => {
            expect(wclGuildsOf("g1", { config }).map((e) => e.guildName)).toEqual(["Pulse", "Alt"]);
            expect(wclGuildsOf("g3", { config })).toEqual([]);
            expect(wclGuildsOf("unknown", { config })).toEqual([]);
        });

        it("lists every server's entries with server and key", () => {
            const all = allWclGuilds({ config });
            expect(all.map((e) => [e.guildId, e.key])).toEqual([
                ["g1", "tbc|pulse|thunderstrike|EU"],
                ["g1", "classic|alt|thunderstrike|EU"],
                ["g2", "tbc|other|thunderstrike|EU"],
            ]);
        });

        it("reads the stored config without one handed in", () => {
            jest.isolateModules(() => {
                jest.doMock("../../../src/stores/settingsStore", () => ({ getConfig: () => config }));
                const mod = require("../../../src/services/logcheck/wclGuildSettings");
                expect(mod.allWclGuilds()).toHaveLength(3);
            });
            jest.dontMock("../../../src/stores/settingsStore");
        });
    });

    describe("wclGuildsFromBody", () => {
        const current = [{ ...entry(), lastRunAt: 500, lastSuccessAt: 400, lastResult: { found: 1, error: "", at: 500 } }];

        it("keeps lastRunAt/lastResult of the stored entry with the same key, whatever the body says", () => {
            const out = wclGuildsFromBody([{ ...entry({ guildName: "PULSE", region: "eu", interval: 15 }), lastRunAt: 9, lastSuccessAt: 9, lastResult: { found: 99 } }], { current });
            expect(out).toEqual([{
                versionId: "tbc", guildName: "PULSE", realm: "Thunderstrike", region: "EU", interval: 15,
                lastRunAt: 500, lastSuccessAt: 400, lastResult: { found: 1, error: "", at: 500 },
            }]);
        });

        it("a new entry starts unfetched", () => {
            const [e] = wclGuildsFromBody([{ ...entry({ guildName: "Neu" }), lastRunAt: 9, lastResult: { found: 3 } }], { current });
            expect(e).toMatchObject({ guildName: "Neu", lastRunAt: 0, lastSuccessAt: 0, lastResult: null });
        });

        it("an empty or broken body clears the list", () => {
            expect(wclGuildsFromBody([], { current })).toEqual([]);
            expect(wclGuildsFromBody(null, { current })).toEqual([]);
            expect(wclGuildsFromBody([null, "x"])).toEqual([]);
        });
    });
});
