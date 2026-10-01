// The questions of a Kader (docs/kaderplaner.md): what happens to the answers
// when a question is added, changed, reordered, copied or deleted.
const model = require("../../../src/services/kader/kaderModel");
const players = require("../../../src/services/kader/kaderPlayers");
const questions = require("../../../src/services/kader/kaderQuestions");
const { U, kaderCtx, refusal } = require("../../helpers/kaderFixtures");

const ctx = kaderCtx();

function setup() {
    const { planner, kaderId } = model.createKader(model.emptyPlanner(), { name: "K" }, ctx);
    let p = players.addPlayers(planner, { kaderId, players: [{ userId: U.a }, { userId: U.b }] }, ctx).planner;
    const days = questions.addQuestion(p, { kaderId, text: "Raidtage", type: "multi", options: ["Mo", "Di", "Mi"], required: true });
    p = days.planner;
    const voice = questions.addQuestion(p, { kaderId, text: "Voice", type: "single", options: [{ label: "Immer" }, { label: "Selten" }] });
    p = voice.planner;
    const [dq, vq] = p.kaders[0].questions;
    p = players.saveInterview(p, { kaderId, userId: U.a, answers: { [dq.id]: [dq.options[0].id, dq.options[1].id], [vq.id]: vq.options[0].id } }, ctx);
    return { planner: p, kaderId, dq, vq };
}
const answers = (p, id = U.a) => p.kaders[0].players[id].interview.answers;

describe("services/kader/kaderQuestions", () => {
    it("adds questions with ids for them and their options; a new one is simply open for everybody", () => {
        const { planner, kaderId, dq } = setup();
        expect(dq).toMatchObject({ text: "Raidtage", type: "multi", required: true });
        expect(dq.options.map((o) => o.label)).toEqual(["Mo", "Di", "Mi"]);
        expect(new Set(dq.options.map((o) => o.id)).size).toBe(3);
        const added = questions.addQuestion(planner, { kaderId, text: "Erfahrung", type: "text" });
        expect(added.questionId).toEqual(expect.any(String));
        expect(Object.keys(answers(added.planner))).toHaveLength(2);
        const bad = (input) => refusal(() => questions.addQuestion(planner, { kaderId, ...input }));
        expect(bad({ text: "", type: "text" }).status).toBe(400);
        expect(bad({ text: "x".repeat(201), type: "text" }).message).toMatch(/200/);
        expect(bad({ text: "Wahl", type: "single", options: [] }).message).toMatch(/mindestens eine/);
        expect(bad({ text: "Wahl", type: "single", options: ["a", "A"] }).message).toMatch(/doppelt/);
        expect(bad({ text: "Wahl", type: "single", options: ["x".repeat(61)] }).message).toMatch(/60/);
        expect(bad({ text: "Wahl", type: "poll" }).status).toBe(400);
    });

    it("keeps an option's id (and its answers) when it is renamed, drops answers of a removed one", () => {
        const { planner, kaderId, dq } = setup();
        const [mo, di] = dq.options;
        const p = questions.updateQuestion(planner, { kaderId, questionId: dq.id, text: "Tage", options: [{ id: mo.id, label: "Montag" }, { label: "Freitag" }] });
        const q = p.kaders[0].questions[0];
        expect(q.text).toBe("Tage");
        expect(q.options.map((o) => [o.id === mo.id, o.label])).toEqual([[true, "Montag"], [false, "Freitag"]]);
        expect(answers(p)[dq.id]).toEqual([mo.id]);
        expect(q.options.some((o) => o.id === di.id)).toBe(false);
    });

    it("keeps what fits on a type change and drops answers when text is involved", () => {
        const { planner, kaderId, dq, vq } = setup();
        const single = questions.updateQuestion(planner, { kaderId, questionId: dq.id, type: "single" });
        expect(answers(single)[dq.id]).toBe(dq.options[0].id);
        const multi = questions.updateQuestion(planner, { kaderId, questionId: vq.id, type: "multi" });
        expect(answers(multi)[vq.id]).toEqual([vq.options[0].id]);
        const text = questions.updateQuestion(planner, { kaderId, questionId: vq.id, type: "text" });
        expect(answers(text)[vq.id]).toBeUndefined();
        expect(text.kaders[0].questions[1].options).toEqual([]);
        expect(refusal(() => questions.updateQuestion(text, { kaderId, questionId: vq.id, type: "single" })).message).toMatch(/mindestens eine/);
    });

    it("keeps an option's colour from the palette through renaming and reordering, refuses an unknown one", () => {
        const { planner, kaderId, vq } = setup();
        const [immer, selten] = vq.options;
        // no colour yet: the page picks one by position
        expect(immer.color).toBeUndefined();
        let p = questions.updateQuestion(planner, { kaderId, questionId: vq.id, options: [{ id: immer.id, label: "Immer", color: "teal" }, { id: selten.id, label: "Selten" }] });
        expect(p.kaders[0].questions[1].options.map((o) => o.color)).toEqual(["teal", undefined]);
        // renamed and moved, sent without a colour: the colour stays
        p = questions.updateQuestion(p, { kaderId, questionId: vq.id, options: [{ id: selten.id, label: "Selten" }, { id: immer.id, label: "Fast immer" }] });
        expect(p.kaders[0].questions[1].options.map((o) => [o.label, o.color])).toEqual([["Selten", undefined], ["Fast immer", "teal"]]);
        // "" resets to automatic
        p = questions.updateQuestion(p, { kaderId, questionId: vq.id, options: [{ id: selten.id, label: "Selten" }, { id: immer.id, label: "Fast immer", color: "" }] });
        expect(p.kaders[0].questions[1].options[1].color).toBeUndefined();
        // every colour of the palette goes, anything else is a 400
        for (const color of model.OPTION_COLORS) {
            const q = questions.addQuestion(planner, { kaderId, text: `F ${color}`, type: "single", options: [{ label: "a", color }] });
            expect(q.planner.kaders[0].questions[2].options[0].color).toBe(color);
        }
        const bad = refusal(() => questions.addQuestion(planner, { kaderId, text: "Bunt", type: "single", options: [{ label: "a", color: "#ff0000" }] }));
        expect(bad.status).toBe(400);
        expect(bad.message).toMatch(/Farbe/);
        // a stored colour the palette no longer knows is dropped on read
        expect(model.normalizeQuestion({ id: "q", text: "x", type: "single", options: [{ id: "o", label: "a", color: "pink" }] }).options[0]).toEqual({ id: "o", label: "a" });
        // copies carry the colours
        const other = model.createKader(p, { name: "Zweiter" }, ctx);
        const copied = questions.copyQuestions(other.planner, { kaderId: other.kaderId, fromKaderId: kaderId });
        const target = copied.planner.kaders.find((k) => k.id === other.kaderId);
        expect(target.questions[1].options.map((o) => o.label)).toEqual(["Selten", "Fast immer"]);
    });

    it("deletes a question with its answers", () => {
        const { planner, kaderId, dq, vq } = setup();
        const p = questions.deleteQuestion(planner, { kaderId, questionId: dq.id });
        expect(p.kaders[0].questions.map((q) => q.id)).toEqual([vq.id]);
        expect(Object.keys(answers(p))).toEqual([vq.id]);
        expect(refusal(() => questions.deleteQuestion(p, { kaderId, questionId: dq.id })).status).toBe(404);
    });

    it("orders the questions; ids left out keep their place after the named ones", () => {
        const { planner, kaderId, dq, vq } = setup();
        const third = questions.addQuestion(planner, { kaderId, text: "Sonst", type: "text" });
        const p = questions.orderQuestions(third.planner, { kaderId, order: [vq.id, "nope"] });
        expect(p.kaders[0].questions.map((q) => q.id)).toEqual([vq.id, dq.id, third.questionId]);
    });

    it("copies another Kader's questions with new ids and no answers", () => {
        const { planner, kaderId, dq } = setup();
        const other = model.createKader(planner, { name: "Zweiter" }, ctx);
        const copied = questions.copyQuestions(other.planner, { kaderId: other.kaderId, fromKaderId: kaderId });
        expect(copied.copied).toBe(2);
        const target = copied.planner.kaders.find((k) => k.id === other.kaderId);
        expect(target.questions.map((q) => q.text)).toEqual(["Raidtage", "Voice"]);
        expect(target.questions[0].id).not.toBe(dq.id);
        expect(target.questions[0].options.map((o) => o.id)).toEqual(dq.options.map((o) => o.id));
        expect(refusal(() => questions.copyQuestions(planner, { kaderId, fromKaderId: kaderId })).status).toBe(400);
        expect(refusal(() => questions.copyQuestions(copied.planner, { kaderId, fromKaderId: "nope" })).status).toBe(404);
        const empty = model.createKader(copied.planner, { name: "Leer" }, ctx);
        expect(refusal(() => questions.copyQuestions(empty.planner, { kaderId, fromKaderId: empty.kaderId })).status).toBe(409);
    });
});
