// Where the visitor's characters are named in words (lib/mention.ts).
const { loadTs } = require("./i18nHelper");

const m = loadTs("lib/mention.ts");
const row = (over = {}) => ({ id: "a", type: "other", title: "", spell: null, assignees: [], targets: [], note: "", suggested: false, ...over });

describe("splitMentions", () => {
    it("marks a character named in the text, whatever the case", () => {
        expect(m.splitMentions("Heilbert heilt Tank 1", ["Heilbert"])).toEqual([{ text: "Heilbert", hit: true }, { text: " heilt Tank 1", hit: false }]);
        expect(m.splitMentions("wer ist heilbert?", ["Heilbert"]).filter((p) => p.hit).map((p) => p.text)).toEqual(["heilbert"]);
    });
    it("takes several characters (main and alts), each every time it appears", () => {
        const parts = m.splitMentions("Tankwart und Baerchen, dann wieder Tankwart", ["Tankwart", "Baerchen"]);
        expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["Tankwart", "Baerchen", "Tankwart"]);
        expect(parts.map((p) => p.text).join("")).toBe("Tankwart und Baerchen, dann wieder Tankwart");
    });
    it("a name is a whole word: part of another word is no mention", () => {
        expect(m.mentions("Heilbertine heilt", ["Heilbert"])).toBe(false);
        expect(m.mentions("Superheilbert", ["Heilbert"])).toBe(false);
        expect(m.mentions("(Heilbert)", ["Heilbert"])).toBe(true);
        expect(m.mentions("Heilbert's Zug", ["Heilbert"])).toBe(true);
    });
    it("names with umlauts and special characters work, and regex characters in a name are just text", () => {
        expect(m.mentions("Bär ist dran", ["Bär"])).toBe(true);
        expect(m.mentions("Nix da: a.b", ["a.b"])).toBe(true);
        expect(m.mentions("axb", ["a.b"])).toBe(false);
        expect(m.mentions("Dunkel(priester) gemeint", ["Dunkel(priester)"])).toBe(true);
    });
    it("the longer name wins, and nothing is found for no names, a very short name or an empty text", () => {
        expect(m.splitMentions("Heilbert", ["Heil", "Heilbert"])).toEqual([{ text: "Heilbert", hit: true }]);
        expect(m.splitMentions("Heilbert", [])).toEqual([{ text: "Heilbert", hit: false }]);
        expect(m.mentions("a b c", ["a"])).toBe(false);
        expect(m.splitMentions("", ["Heilbert"])).toEqual([{ text: "", hit: false }]);
        expect(m.splitMentions(null, ["Heilbert"])).toEqual([{ text: "", hit: false }]);
    });
    it("cleanNames drops blanks and doubles", () => {
        expect(m.cleanNames([" Tankwart ", "tankwart", "", "x", null, "Baerchen"])).toEqual(["Tankwart", "Baerchen"]);
    });
});

describe("mentionsInRow", () => {
    it("finds the visitor in the title, the note and a free-text target, not in a named slot or player", () => {
        expect(m.mentionsInRow(row({ title: "Heilbert kickt" }), ["Heilbert"])).toBe(true);
        expect(m.mentionsInRow(row({ note: "wenn Heilbert tot ist: Baerchen" }), ["Heilbert"])).toBe(true);
        expect(m.mentionsInRow(row({ targets: [{ kind: "text", ref: "Fear auf Heilbert" }] }), ["Heilbert"])).toBe(true);
        expect(m.mentionsInRow(row({ targets: [{ kind: "player", ref: "Heilbert" }] }), ["Heilbert"])).toBe(false);
        expect(m.mentionsInRow(row({ title: "Kick" }), ["Heilbert"])).toBe(false);
        expect(m.mentionsInRow(row({ title: "Heilbert" }), [])).toBe(false);
    });
});
