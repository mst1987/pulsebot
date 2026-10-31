// Which raid an addon upload with a game version belongs to (#1002).
jest.mock("../../../src/services/versions/mainVersion", () => ({
    versionOfEvent: (e) => e.versionId || "tbc",
}));
jest.mock("../../../src/services/versions/versionSettings", () => ({
    settingsForVersion: (versionId, { guildId }) => ({ blizzardRealmSlug: guildId === "gEU2" ? "spineshatter" : "thunderstrike" }),
}));
jest.mock("../../../src/stores/roster/raiderProfileStore", () => ({
    getProfile: jest.fn(() => null),
    charactersOfVersion: (profile, versionId) => ((profile && profile.characters) || []).filter((c) => c.versionId === versionId),
}));

jest.mock("../../../src/stores/events/eventStore", () => ({
    isOwnEventId: (id) => String(id).startsWith("eh-"),
    getEvent: jest.fn(() => null),
}));

const eventStore = require("../../../src/stores/events/eventStore");
const raiderProfiles = require("../../../src/stores/roster/raiderProfileStore");
const {
    MATCH_SHARE, realmKey, recipientKeys, signupKeys, setupCharacters, scoreCandidates, decideCandidates, isStrong,
} = require("../../../src/web/loot/inboxCandidates");

// 2026-10-29 20:00 Europe/Berlin
const AT = Date.UTC(2026, 9, 29, 19, 0, 0);
const START = Math.floor(AT / 1000);

const session = (names) => ({ items: names.map((n, i) => ({ character: n, rawId: `r${i}` })) });
const signup = (character, over = {}) => ({ userId: `u-${character}`, character, ...over });
const row = (id, guildId, names, over = {}) => ({
    ev: { id, title: `Raid ${id}`, startTime: START, signUps: names.map((n) => signup(n)), ...over },
    g: { categoryId: `c-${guildId}`, categoryName: `Kategorie ${guildId}` },
    guildId,
});

const FIVE = ["Arthas", "Jaina", "Thrall", "Sylvanas", "Uther"];

describe("web/loot/inboxCandidates", () => {
    it("compares realms loosely", () => {
        expect(realmKey("Thunder-Strike ")).toBe(realmKey("thunderstrike"));
        expect(realmKey(null)).toBe("");
    });

    it("collects the distinct recipients of a session", () => {
        expect([...recipientKeys(session(["Arthas", "arthas", "Jaina"]))]).toHaveLength(2);
        expect(recipientKeys(null).size).toBe(0);
    });

    it("reads signed characters, skips absences and falls back to the profile", () => {
        raiderProfiles.getProfile.mockReturnValueOnce({ characters: [{ name: "Muradin", versionId: "tbc" }, { name: "Other", versionId: "forever" }] });
        const keys = signupKeys({
            signUps: [
                signup("Arthas"),
                signup("Jaina", { status: "absence" }),
                { userId: "u1", characters: [{ character: "Thrall" }, { character: "Rexxar" }] },
                { userId: "u2" },
            ],
        }, "tbc");
        expect([...keys].sort()).toEqual(["arthas", "muradin", "rexxar", "thrall"]);
    });

    it("counts the characters of the setup as participants too", () => {
        const setup = {
            groups: [{ index: 1, slots: [{ userId: "u1", character: "Varian" }, { userId: "u2" }] }],
            bench: [{ userId: "u3", character: "Bolvar" }],
            approved: { groups: [{ slots: [{ userId: "u4", character: "Tirion" }] }] },
            events: [{ groups: [{ slots: [{ userId: "u5", character: "Anduin" }] }] }],
        };
        expect(setupCharacters(setup).sort()).toEqual(["Anduin", "Bolvar", "Tirion", "Varian"]);
        expect(setupCharacters(null)).toEqual([]);
        // the own event's stored setup: a swapped-in character who never signed up counts
        eventStore.getEvent.mockReturnValueOnce({ setup });
        const keys = signupKeys({ id: "eh-1", signUps: [signup("Arthas")] }, "tbc");
        expect([...keys].sort()).toEqual(["anduin", "arthas", "bolvar", "tirion", "varian"]);
        // a Raid-Helper raid has no stored setup to look up
        expect([...signupKeys({ id: "123", signUps: [], setup: [] }, "tbc")]).toEqual([]);
        expect(eventStore.getEvent).toHaveBeenCalledTimes(1);
    });

    it("lets the setup lift a raid to the clear match", () => {
        const setupOf = (id) => (id === "eh-s" ? { groups: [{ slots: FIVE.slice(2).map((c) => ({ character: c })) }] } : null);
        const out = scoreCandidates(session(FIVE), [row("eh-s", "gA", FIVE.slice(0, 1))], { gameVersion: "tbc", at: AT, setupOf });
        expect(out[0]).toMatchObject({ matched: 4, total: 5 });
        expect(isStrong(out[0])).toBe(true);
    });

    describe("scoreCandidates", () => {
        it("keeps only raids of the same day, version and realm, best first", () => {
            const rows = [
                row("weak", "gA", ["Arthas"]),
                row("strong", "gB", FIVE),
                row("other-version", "gA", FIVE, { versionId: "forever" }),
                row("other-day", "gA", FIVE, { startTime: START + 3 * 86400 }),
                row("other-realm", "gEU2", FIVE),
            ];
            const out = scoreCandidates(session(FIVE), rows, { gameVersion: "tbc", realm: "Thunderstrike", at: AT });
            expect(out.map((c) => c.eventId)).toEqual(["strong", "weak"]);
            expect(out[0]).toMatchObject({ guildId: "gB", matched: 5, total: 5, eventLabel: "Raid strong", categoryId: "c-gB" });
            expect(out[1]).toMatchObject({ matched: 1, total: 5 });
        });

        it("takes the raid of any realm when the upload names none", () => {
            const out = scoreCandidates(session(FIVE), [row("eu2", "gEU2", FIVE)], { gameVersion: "tbc", realm: "", at: AT });
            expect(out.map((c) => c.eventId)).toEqual(["eu2"]);
        });

        it("has no candidates without rows", () => {
            expect(scoreCandidates(session(FIVE), null, { gameVersion: "tbc", at: AT })).toEqual([]);
        });
    });

    describe("decideCandidates (60 % rule)", () => {
        const cand = (eventId, guildId, matched, total = 5) => ({ eventId, guildId, matched, total });

        it("counts 60 % as strong, below as weak", () => {
            expect(MATCH_SHARE).toBe(0.6);
            expect(isStrong(cand("a", "gA", 3))).toBe(true);
            expect(isStrong(cand("a", "gA", 2))).toBe(false);
            expect(isStrong(cand("a", "gA", 0, 0))).toBe(false);
        });

        it("files the upload under exactly one strong candidate", () => {
            const d = decideCandidates([cand("a", "gA", 4), cand("b", "gB", 1)], ["gA", "gB"]);
            expect(d.waiting).toBe(false);
            expect(d.servers).toEqual([]);
            expect(d.match.suggested.eventId).toBe("a");
            expect(d.match.best).toBe("a");
        });

        it("waits when two candidates are above 60 %, for both servers", () => {
            const d = decideCandidates([cand("a", "gA", 4), cand("b", "gB", 3)], ["gA", "gB", "gC"]);
            expect(d.waiting).toBe(true);
            expect(d.servers).toEqual(["gA", "gB"]);
            expect(d.match).toMatchObject({ ambiguous: true, suggested: null, best: "a" });
        });

        it("waits without a strong candidate and marks none without any match", () => {
            const weak = decideCandidates([cand("a", "gA", 1)], ["gA", "gB"]);
            expect(weak.waiting).toBe(true);
            expect(weak.match.best).toBe("a");
            const none = decideCandidates([cand("a", "gA", 0)], ["gA"]);
            expect(none.match.best).toBe("");
        });

        it("waits on the key's servers when there is no candidate at all", () => {
            const d = decideCandidates([], ["gA", "gB"]);
            expect(d).toMatchObject({ waiting: true, servers: ["gA", "gB"] });
            expect(d.match).toMatchObject({ ambiguous: false, suggested: null, candidates: [], best: "" });
            expect(decideCandidates(undefined, null).servers).toEqual([]);
        });
    });
});
