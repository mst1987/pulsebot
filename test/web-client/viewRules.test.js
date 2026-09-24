// What is drawn and for whom (lib/viewRules.ts): plan switches, object switches, viewer preferences; persistence of the viewer's choice.
const { loadTs } = require("./i18nHelper");

const vr = loadTs("lib/viewRules.ts");

describe("viewer preferences", () => {
    it("start with everything on and read back what was stored, keys that are no booleans stay on", () => {
        expect(vr.parsePrefs(null)).toEqual({ highlight: true, selection: true, links: true, names: true, roleRings: true, groupRings: true });
        expect(vr.parsePrefs(JSON.stringify({ highlight: false, names: false }))).toMatchObject({ highlight: false, names: false, links: true });
        expect(vr.parsePrefs(JSON.stringify({ highlight: "no", roleRings: 0 }))).toMatchObject({ highlight: true, roleRings: true });
        expect(vr.parsePrefs("{ broken")).toEqual(vr.DEFAULT_PREFS);
        expect(vr.parsePrefs("null")).toEqual(vr.DEFAULT_PREFS);
    });
    it("a stored choice survives a round trip (persistence)", () => {
        const stored = JSON.stringify({ ...vr.DEFAULT_PREFS, selection: false, groupRings: false });
        expect(vr.parsePrefs(stored)).toEqual({ ...vr.DEFAULT_PREFS, selection: false, groupRings: false });
    });
});

describe("what is drawn", () => {
    it("a viewer can only hide more than the plan shows, an old plan without the field shows it", () => {
        expect(vr.shownFor(undefined, true)).toBe(true);
        expect(vr.shownFor(true, true)).toBe(true);
        expect(vr.shownFor(false, true)).toBe(false);
        expect(vr.shownFor(true, false)).toBe(false);
        expect(vr.shownFor(false, false)).toBe(false);
    });
    it("the ring of one object needs the board's role rings AND the object's own switch", () => {
        expect(vr.ringShownFor(undefined, undefined)).toBe(true);
        expect(vr.ringShownFor(true, true)).toBe(true);
        expect(vr.ringShownFor(false, undefined)).toBe(false);
        expect(vr.ringShownFor(true, false)).toBe(false);
    });
    it("the selection frame is only drawn in an editor, for a selected object, when the viewer wants it", () => {
        expect(vr.selectionDrawn(true, true, true)).toBe(true);
        expect(vr.selectionDrawn(false, true, true)).toBe(false);
        expect(vr.selectionDrawn(true, false, true)).toBe(false);
        expect(vr.selectionDrawn(true, true, false)).toBe(false);
    });
});
