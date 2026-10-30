// The marks of the orga's hint at signup (#983): one per raid and person, so a
// change of status, a sign-off and a new signup bring no second line.
const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const marks = require("../../src/stores/orgaSignupNoticeStore");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12);
const U = "111111111111111111";
const V = "222222222222222222";

let file;
beforeEach(() => {
    file = tempStoreFile("orga-signup-notices.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    marks.useFile(file);
});
afterAll(() => marks.useFile(null));

describe("stores/orgaSignupNoticeStore", () => {
    it("marks a person at a raid once", () => {
        expect(marks.hasMark("e1", U)).toBe(false);
        expect(marks.markOnce("e1", U, { now: NOW })).toBe(true);
        expect(marks.markOnce("e1", U, { now: NOW + 1000 })).toBe(false);
        expect(marks.hasMark("e1", U)).toBe(true);
        // another person or another raid is new
        expect(marks.markOnce("e1", V, { now: NOW })).toBe(true);
        expect(marks.markOnce("e2", U, { now: NOW })).toBe(true);
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ events: { e1: { [U]: NOW, [V]: NOW }, e2: { [U]: NOW } } });
    });

    it("refuses an empty raid or person", () => {
        expect(marks.markOnce("", U, { now: NOW })).toBe(false);
        expect(marks.markOnce("e1", "  ", { now: NOW })).toBe(false);
        expect(fs.existsSync(file)).toBe(false);
    });

    it("drops a raid once all of its marks are older than the retention", () => {
        marks.markOnce("old", U, { now: NOW - (marks.RETENTION_DAYS + 1) * DAY });
        marks.markOnce("mixed", U, { now: NOW - (marks.RETENTION_DAYS + 1) * DAY });
        marks.markOnce("mixed", V, { now: NOW - DAY });
        marks.markOnce("new", U, { now: NOW });
        expect(marks.hasMark("old", U)).toBe(false);
        expect(marks.hasMark("mixed", U)).toBe(true);
        expect(marks.hasMark("new", U)).toBe(true);
    });

    it("reads a broken file as empty", () => {
        fs.writeFileSync(file, JSON.stringify({ events: { e1: "x", e2: { [U]: "nope", [V]: 5 } } }));
        expect(marks.hasMark("e1", U)).toBe(false);
        expect(marks.hasMark("e2", U)).toBe(false);
        expect(marks.hasMark("e2", V)).toBe(true);
    });
});
