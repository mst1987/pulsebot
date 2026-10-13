// The LevelHelper upload ("levelhelper-runs" v1): what is taken over and what
// refuses the whole request.
const {
    parseLevelHelperUpload, LevelHelperParseError, memberKey, LH_FORMAT, MAX_RUNS, MAX_CHARACTERS,
} = require("../../../src/utils/dungeons/levelHelperUpload");

const run = (over = {}) => ({
    id: "r1", dungeon: "The Deadmines", seconds: 1902, start: 1791700000, instance: 123, medal: "gold",
    members: [{ guid: "0A1", name: "Devira", class: "PALADIN" }, { guid: "0A2", name: "Thalor", class: "WARRIOR" }],
    at: 1791702000, ...over,
});
const character = (over = {}) => ({
    guid: "0A1", name: "Devira", realm: "Forever", class: "PALADIN", level: 18, points: 340, count: 34, golds: 2, at: 1791702000, ...over,
});
const upload = (over = {}) => ({
    format: LH_FORMAT, v: 1, versionId: "forever", guild: "Pulse", uploader: { account: "405280973#1" },
    runs: [run()], characters: [character()], ...over,
});

/** The error message of a refused upload. */
function refusal(body) {
    try {
        parseLevelHelperUpload(body);
    } catch (e) {
        expect(e).toBeInstanceOf(LevelHelperParseError);
        return e.message;
    }
    throw new Error("not refused");
}

describe("parseLevelHelperUpload", () => {
    it("takes over a complete upload", () => {
        const parsed = parseLevelHelperUpload(upload());
        expect(parsed).toEqual({
            versionId: "forever", guild: "Pulse", account: "405280973#1",
            runs: [run()],
            characters: [character()],
        });
    });

    it("accepts what may be missing: guild, uploader, instance, medal, at, both lists", () => {
        const parsed = parseLevelHelperUpload({
            format: LH_FORMAT, v: 1, versionId: "forever", guild: null,
            runs: [run({ instance: null, medal: null, at: undefined, members: [{ guid: null, name: "Devira", class: null }] })],
        });
        expect(parsed.guild).toBe("");
        expect(parsed.account).toBe("");
        expect(parsed.characters).toEqual([]);
        expect(parsed.runs[0]).toMatchObject({ instance: null, medal: null, at: 1791700000 + 1902, members: [{ guid: "", name: "Devira", class: "" }] });
    });

    it("takes a numeric run id as text, rounds a fractional time and drops a member listed twice", () => {
        const parsed = parseLevelHelperUpload(upload({
            runs: [run({ id: 42, seconds: 1902.6, members: [{ name: "Devira" }, { name: "devira" }, { guid: "x", name: "Devira" }] })],
        }));
        expect(parsed.runs[0].id).toBe("42");
        expect(parsed.runs[0].seconds).toBe(1903);
        // the same name twice is one member; a guid makes it another player
        expect(parsed.runs[0].members.map(memberKey)).toEqual(["n:devira", "g:x"]);
    });

    it("refuses an envelope that is not LevelHelper's or is newer than the server", () => {
        expect(refusal(null)).toMatch(/^Upload/);
        expect(refusal(upload({ format: "eventhelper-guildbank" }))).toMatch(/^format/);
        expect(refusal(upload({ v: "1" }))).toMatch(/^v:/);
        expect(refusal(upload({ v: 2 }))).toMatch(/neuer als dieser Server/);
    });

    it("refuses an unknown game version", () => {
        expect(refusal(upload({ versionId: "retail" }))).toMatch(/versionId: „retail“ ist keine bekannte Spielversion/);
        expect(refusal(upload({ versionId: "" }))).toMatch(/^versionId/);
    });

    it("refuses wrong types and too long texts", () => {
        expect(refusal(upload({ guild: 5 }))).toMatch(/^guild: muss Text sein/);
        expect(refusal(upload({ guild: "x".repeat(61) }))).toMatch(/^guild: ist länger als 60/);
        expect(refusal(upload({ uploader: "me" }))).toMatch(/^uploader/);
        expect(refusal(upload({ runs: {} }))).toMatch(/^runs: muss eine Liste sein/);
        expect(refusal(upload({ runs: [run({ dungeon: "" })] }))).toMatch(/^runs\[0\]\.dungeon: ist leer/);
        expect(refusal(upload({ runs: [run({ id: { a: 1 } })] }))).toMatch(/^runs\[0\]\.id/);
        expect(refusal(upload({ runs: [run({ start: 1791700000123 })] }))).toMatch(/^runs\[0\]\.start/);
        expect(refusal(upload({ runs: [run({ instance: "123" })] }))).toMatch(/^runs\[0\]\.instance/);
        expect(refusal(upload({ runs: [run({ members: [{ name: "Devira", class: "Paladin!" }] })] }))).toMatch(/class: ist kein Klassen-Token/);
    });

    it("refuses an implausible time, an unknown medal and a group of 0 or 6", () => {
        expect(refusal(upload({ runs: [run({ seconds: 59 })] }))).toMatch(/^runs\[0\]\.seconds: 59 liegt nicht zwischen 60 und 14400/);
        expect(refusal(upload({ runs: [run({ seconds: 14401 })] }))).toMatch(/14401/);
        expect(refusal(upload({ runs: [run({ seconds: "1902" })] }))).toMatch(/seconds: muss eine Zahl sein/);
        expect(refusal(upload({ runs: [run({ medal: "platinum" })] }))).toMatch(/medal/);
        expect(refusal(upload({ runs: [run({ members: [] })] }))).toMatch(/members: braucht 1 bis 5/);
        const six = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}` }));
        expect(refusal(upload({ runs: [run({ members: six })] }))).toMatch(/members: braucht 1 bis 5/);
        expect(refusal(upload({ runs: [run({ members: [{ guid: "1" }] })] }))).toMatch(/members\[0\]\.name: fehlt/);
    });

    it("names the run that does not fit, not just the first", () => {
        expect(refusal(upload({ runs: [run(), run({ id: "r2", seconds: 10 })] }))).toMatch(/^runs\[1\]\.seconds/);
    });

    it("refuses more than 500 runs or 200 characters per request", () => {
        expect(refusal(upload({ runs: Array.from({ length: MAX_RUNS + 1 }, (_, i) => run({ id: `r${i}` })) }))).toMatch(/höchstens 500/);
        expect(refusal(upload({ characters: Array.from({ length: MAX_CHARACTERS + 1 }, () => character()) }))).toMatch(/höchstens 200/);
        expect(parseLevelHelperUpload(upload({ runs: Array.from({ length: MAX_RUNS }, (_, i) => run({ id: `r${i}` })) })).runs).toHaveLength(500);
    });

    it("checks the characters: counts are whole numbers in range, the reading time is required", () => {
        expect(refusal(upload({ characters: [character({ points: -1 })] }))).toMatch(/^characters\[0\]\.points/);
        expect(refusal(upload({ characters: [character({ level: 101 })] }))).toMatch(/^characters\[0\]\.level/);
        expect(refusal(upload({ characters: [character({ at: undefined })] }))).toMatch(/^characters\[0\]\.at/);
        expect(refusal(upload({ characters: [character({ name: " " })] }))).toMatch(/^characters\[0\]\.name: ist leer/);
        const parsed = parseLevelHelperUpload(upload({ characters: [character({ guid: null, realm: null, level: undefined, golds: undefined })] }));
        expect(parsed.characters[0]).toMatchObject({ guid: "", realm: "", level: 0, golds: 0 });
    });
});
