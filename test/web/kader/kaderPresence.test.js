// Who is in which Kader right now (docs/kaderplaner.md, "Live"): in memory
// only, per server and Kader, one entry per person, gone 25 seconds after the
// last poll or at once when the page leaves.
const presence = require("../../../src/web/kader/kaderPresence");

const KURT = "100000000000000001";
const LENA = "100000000000000002";
const T0 = 1_800_000_000_000;

const beat = (over = {}, now = T0) => presence.beat({ guildId: "g1", kaderId: "k1", userId: LENA, name: "Lena", tab: "t1", sub: "vorauswahl", playerId: "111", what: "interview", edit: true, ...over }, now);

beforeEach(() => presence.reset());

describe("web/kader/kaderPresence", () => {
    it("names everybody else in the same Kader, with page, player and whether they edit", () => {
        beat();
        presence.beat({ guildId: "g1", kaderId: "k1", userId: KURT, name: "Kurt", tab: "t9", sub: "pool" }, T0);
        expect(presence.present({ guildId: "g1", kaderId: "k1", except: KURT }, T0)).toEqual([
            { userId: LENA, name: "Lena", sub: "vorauswahl", playerId: "111", what: "interview", edit: true },
        ]);
        expect(presence.present({ guildId: "g1", kaderId: "k1", except: LENA }, T0)).toEqual([
            { userId: KURT, name: "Kurt", sub: "pool", playerId: "", what: "", edit: false },
        ]);
    });

    it("never tells one Kader or server about another", () => {
        beat();
        expect(presence.present({ guildId: "g1", kaderId: "k2", except: KURT }, T0)).toEqual([]);
        expect(presence.present({ guildId: "g2", kaderId: "k1", except: KURT }, T0)).toEqual([]);
    });

    it("forgets a page 25 seconds after its last poll, and at once when it leaves", () => {
        jest.useFakeTimers({ now: T0 });
        try {
            beat({}, Date.now());
            jest.advanceTimersByTime(presence.TTL_MS - 1000);
            expect(presence.present({ guildId: "g1", kaderId: "k1", except: KURT })).toHaveLength(1);
            jest.advanceTimersByTime(2000);
            expect(presence.present({ guildId: "g1", kaderId: "k1", except: KURT })).toEqual([]);
            beat({}, Date.now());
            presence.leave({ guildId: "g1", userId: LENA, tab: "t1" });
            expect(presence.present({ guildId: "g1", kaderId: "k1", except: KURT })).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });

    it("counts one person in several tabs once, with their newest tab", () => {
        beat({ tab: "a", sub: "pool", playerId: "", what: "" }, T0);
        beat({ tab: "b", sub: "roster", playerId: "222", what: "drawer", edit: false }, T0 + 1000);
        expect(presence.present({ guildId: "g1", kaderId: "k1", except: KURT }, T0 + 1000)).toEqual([
            { userId: LENA, name: "Lena", sub: "roster", playerId: "222", what: "drawer", edit: false },
        ]);
    });

    it("drops what is malformed: no tab, an unknown page, a player without a kind, an id that is no id", () => {
        beat({ tab: "" });
        expect(presence.present({ guildId: "g1", kaderId: "k1", except: KURT }, T0)).toEqual([]);
        beat({ sub: "admin", what: "secret", playerId: "<script>" });
        expect(presence.present({ guildId: "g1", kaderId: "k1", except: KURT }, T0)).toEqual([
            { userId: LENA, name: "Lena", sub: "", playerId: "", what: "", edit: false },
        ]);
        beat({ kaderId: "../k1" });
        expect(presence.present({ guildId: "g1", kaderId: "../k1", except: KURT }, T0)).toEqual([]);
    });

    it("keeps at most MAX_ENTRIES pages", () => {
        for (let i = 0; i <= presence.MAX_ENTRIES; i++) beat({ userId: String(i), tab: `t${i}` }, T0);
        expect(presence.present({ guildId: "g1", kaderId: "k1" }, T0)).toHaveLength(presence.MAX_ENTRIES);
    });
});
