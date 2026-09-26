// The tactic in the client (lib/raidplan/steps.ts), run for real: editing and sorting the steps, the timing words, the sentence with its targets,
// the "du" form, the @ mentions, the resolution of a step, the library, the starters.
import { describe, expect, it } from "vitest";
import * as st from "./steps";
import { inLang } from "../../test/i18n";

const S = (id, over = {}) => ({ id, action: "tank", participants: [], sentence: `s${id}`, targets: [], timing: { kind: "", from: null, to: null, text: "" }, ...over });
const board = (steps) => ({ steps, notes: "", profileId: "" });
const ids = (b) => b.steps.map((s) => s.id);

describe("editing the steps", () => {
    it("moves by one (Alt + arrows) and to a place (the grip), clamped", () => {
        const b = board([S("a"), S("b"), S("c")]);
        expect(ids(st.moveStep(b, "c", -1))).toEqual(["a", "c", "b"]);
        expect(ids(st.moveStep(b, "a", -1))).toEqual(["a", "b", "c"]);
        expect(ids(st.moveStepTo(b, "a", 2))).toEqual(["b", "c", "a"]);
        expect(ids(st.moveStepTo(b, "c", -5))).toEqual(["c", "a", "b"]);
        expect(st.moveStepTo(b, "x", 1)).toBe(b);
    });
    it("duplicates under the step, removes, replaces, appends with fresh ids and at most 30", () => {
        const b = board([S("a"), S("b")]);
        const d = st.duplicateStep(b, "a");
        expect(d.steps.map((s) => s.sentence)).toEqual(["sa", "sa", "sb"]);
        expect(d.steps[1].id).not.toBe("a");
        expect(ids(st.removeStep(b, "a"))).toEqual(["b"]);
        expect(st.putStep(b, S("b", { sentence: "neu" })).steps[1].sentence).toBe("neu");
        expect(ids(st.putStep(b, S("z")))).toEqual(["a", "b", "z"]);
        const full = board(Array.from({ length: 29 }, (_, i) => S(`x${i}`)));
        expect(st.appendSteps(full, [S("n1"), S("n2")]).steps).toHaveLength(30);
        expect(st.appendSteps(board([]), [S("a")]).steps[0].id).not.toBe("a");
        expect(st.stepsOf({})).toEqual([]);
    });
    it("a library tactic is added under the steps, the old note only fills an empty note", () => {
        const p = { id: "p1", name: "Kiten", category: "Kiten", bossKey: "", steps: [S("k", { action: "kite" })], targets: [], notes: "alt", updatedAt: 1 };
        const out = st.applyTactic(board([S("a")]), p);
        expect(out.steps.map((s) => s.action)).toEqual(["tank", "kite"]);
        expect(out).toMatchObject({ profileId: "p1", notes: "alt" });
        expect(st.applyTactic({ ...board([]), notes: "eigene" }, p).notes).toBe("eigene");
    });
});

describe("timing, sentence, du form", () => {
    it("names the timing", async () => {
        const tm = (kind, from = null, to = null, text = "") => st.timingLabel({ kind, from, to, text });
        expect([tm("pull"), tm("now"), tm("phase", 2), tm("hp", 30), tm("hp", 50, 30), tm("hp", 100, 30), tm("interval", 30), tm("text", null, null, "nach Inferno"), tm("")]).toEqual(["Pull", "sofort", "Phase 2", "bei 30 %", "50 → 30 %", "Pull → 30 %", "alle 30 s", "nach Inferno", ""]);
        expect(await inLang("en", () => st.timingLabel({ kind: "interval", from: 20, to: null, text: "" }))).toBe("every 20 s");
    });
    it("cuts the sentence at the names of its targets; targets it does not name come after", () => {
        const r = st.sentenceParts("kitet Naj'entus um die Arena", ["Naj'entus", "Stern", "Arena"]);
        expect(r.parts).toEqual([{ text: "kitet ", target: -1 }, { text: "Naj'entus", target: 0 }, { text: " um die ", target: -1 }, { text: "Arena", target: 2 }]);
        expect(r.rest).toEqual([1]);
        expect(st.targetWord({ kind: "group", ref: "3" })).toBe("Gruppe 3");
        expect(st.targetWord({ kind: "mark", ref: "star" })).toBe("Stern");
    });
    it("puts the viewer's own verb in the du form (German and English), leaves other sentences alone", () => {
        expect(st.duForm("tankt Zerevor", "de")).toBe("tankst Zerevor");
        expect(st.duForm("kitet den Boss", "de")).toBe("kitest den Boss");
        expect(st.duForm("hält Malande", "de")).toBe("hältst Malande");
        expect(st.duForm("halten beide", "de")).toBe("halten beide");
        expect(st.duForm("tanks Zerevor", "en")).toBe("tank Zerevor");
        expect(st.duForm("pushes on", "en")).toBe("push on");
        expect(st.duForm("", "de")).toBe("");
    });
    it("fills a suggestion's gap with the target", () => {
        expect(st.fillSuggestion("kitet … um die Arena", "Naj'entus")).toBe("kitet Naj'entus um die Arena");
        expect(st.suggestionsFor("kite")[0]).toBe("kitet … um die Arena");
        expect(st.suggestionsFor("note")).toEqual([]);
    });
});

describe("@ mentions", () => {
    const entries = [{ key: "user:1", kind: "player", label: "Heilbert", ref: "user:1", icon: "" }, { key: "mob:z", kind: "mob", label: "High Nethermancer Zerevor", ref: "d:z", icon: "" }, { key: "user:2", kind: "player", label: "Zerstoerer", ref: "user:2", icon: "" }];
    it("finds the @ at the caret, matches starts first, puts the name in", () => {
        expect(st.mentionAt("zieht @He", 9)).toEqual({ start: 6, query: "He" });
        expect(st.mentionAt("mail@home", 9)).toBe(null);
        expect(st.mentionAt("zieht He", 8)).toBe(null);
        expect(st.mentionMatches("zer", entries, 5).map((e) => e.label)).toEqual(["Zerstoerer", "High Nethermancer Zerevor"]);
        expect(st.mentionMatches("", entries, 2)).toHaveLength(2);
        expect(st.applyMention("zieht @He zur Wand", 6, 9, "Heilbert")).toBe("zieht Heilbert zur Wand");
    });
});

describe("resolving a step and the viewer's steps", () => {
    const roster = [{ userId: "war", classId: "Warrior", role: "tank", group: 1 }, { userId: "mage", classId: "Mage", role: "ranged", group: 2 }];
    it("a mage tank by any spec, a group stays, a missing class stays its reference", () => {
        expect(st.resolveParticipants(S("a", { participants: ["class:Mage:1:any", "group:2", "class:Priest:1"] }), [], roster, {})).toEqual(["user:mage", "group:2", "class:Priest:1"]);
        expect(st.resolveParticipants(S("a", { participants: ["class:Mage:1"] }), [], roster, {})).toEqual(["class:Mage:1"]);
    });
    it("a step is the viewer's by his player or his group", () => {
        expect(st.isMyStep(["user:mage"], ["mage"], [2])).toBe(true);
        expect(st.isMyStep(["group:2"], ["x"], [2])).toBe(true);
        expect(st.isMyStep(["user:war", "group:1"], ["mage"], [2])).toBe(false);
    });
});

describe("the library and the starters", () => {
    const P = (id, category, when, sentences) => ({ id, name: id, category, bossKey: "", steps: sentences.map((s, i) => S(`${id}${i}`, { sentence: s })), targets: [], notes: "", updatedAt: when });
    const list = [P("a", "Kiten", 1, ["kitet"]), P("b", "Adds", 3, ["Adds"]), P("c", "Kiten", 2, ["zieht an die Wand"]), P("d", "Eigene", 4, [])];
    it("filters by category and search (also in the sentences), newest first, at most the tiles shown", () => {
        expect(st.libraryView(list, "Kiten", "", 6).shown.map((p) => p.id)).toEqual(["c", "a"]);
        expect(st.libraryView(list, "", "wand", 6).shown.map((p) => p.id)).toEqual(["c"]);
        expect(st.libraryView(list, "", "", 2)).toMatchObject({ more: 2 });
        expect(st.libraryCategories(list)).toEqual(["Kiten", "Tanktausch", "Adds", "Dispel", "Phase 2", "Eigene"]);
    });
    it("three starters with slots and texts of the language, nothing of later game versions", () => {
        const s = st.starterTactics();
        expect(s.map((x) => x.key)).toEqual(["kite", "swap", "adds"]);
        expect(s[0].steps[0]).toMatchObject({ action: "kite", participants: ["slot:tank:2"], sentence: "kitet den Boss um die Arena" });
        const words = JSON.stringify(s).toLowerCase();
        expect(words).not.toMatch(/tricks|death knight|todesritter/);
        expect(st.ACTIONS).toHaveLength(13);
        for (const a of st.ACTIONS) expect(st.ACTION_PATH[a] && st.ACTION_GROUP[a]).toBeTruthy();
    });
});
