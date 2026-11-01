// Live editing of an interview (docs/kaderplaner.md, "Live" and "Verlauf"):
// a save that content changed is one "Gespräch gespeichert" line per person per
// ten minutes, a new interviewer one "Gespräch führt" line; a save that started
// from an older revision is refused (409 stale) unless it is forced.
const model = require("../../../src/services/kader/kaderModel");
const players = require("../../../src/services/kader/kaderPlayers");
const questions = require("../../../src/services/kader/kaderQuestions");
const { recordChanges } = require("../../../src/services/kader/kaderActivity");
const { U, NOW, kaderCtx, refusal } = require("../../helpers/kaderFixtures");

const ctx = kaderCtx();
const at = (minutes, over = {}) => ({ ...ctx, now: new Date(Date.parse(NOW) + minutes * 60000).toISOString(), ...over });

function setup() {
    const { planner, kaderId } = model.createKader(model.emptyPlanner(), { name: "K" }, ctx);
    const withLeads = model.updateKader(planner, { kaderId, leads: [U.lead, U.lead2] }, ctx);
    const added = players.addPlayers(withLeads, { kaderId, players: [{ userId: U.a }] }, ctx);
    return { planner: added.planner, kaderId };
}
const history = (p) => p.kaders[0].players[U.a].history;
const save = (p, kaderId, input, c = ctx) => players.saveInterview(p, { kaderId, userId: U.a, ...input }, c);

describe("services/kader/kaderPlayers · live", () => {
    describe("only the wishes, from outside the interview", () => {
        const WISHES = [{ className: "Mage", spec: "Mage-Frost" }, { className: "Mage", spec: "Mage-Fire" }];
        const wishes = (p, kaderId, list, c = ctx, over = {}) => players.saveWishes(p, { kaderId, userId: U.a, wishes: list, ...over }, c);

        it("leaves an interview nobody began open and says what happened", () => {
            const { planner, kaderId } = setup();
            const p = wishes(planner, kaderId, WISHES, at(1));
            const e = p.kaders[0].players[U.a];
            expect(e.wishes).toEqual(WISHES);
            expect(e.interview.startedAt).toBe("");
            expect(e.interview.updatedBy).toBe(U.lead);
            expect(history(p)[history(p).length - 1]).toEqual({ at: at(1).now, by: U.lead, type: "wishes" });
            expect(history(p).some((h) => h.type === "interview_saved")).toBe(false);
        });

        it("notes nothing when nothing changed", () => {
            const { planner, kaderId } = setup();
            const p = wishes(planner, kaderId, WISHES, at(1));
            const again = wishes(p, kaderId, WISHES, at(30));
            expect(history(again).filter((h) => h.type === "wishes")).toHaveLength(1);
        });

        it("checks like the interview: other classes, doubles and an older revision are refused", () => {
            const { planner, kaderId } = setup();
            expect(refusal(() => wishes(planner, kaderId, [{ className: "Mage", spec: "Priest-Holy" }])).status).toBe(400);
            expect(refusal(() => wishes(planner, kaderId, [WISHES[0], WISHES[0]])).status).toBe(400);
            expect(refusal(() => wishes(planner, kaderId, undefined)).status).toBe(400);
            const stored = model.normalizePlanner(wishes(planner, kaderId, WISHES));
            stored.kaders[0].players[U.a].interview.rev = 5;
            expect(refusal(() => wishes(stored, kaderId, [WISHES[0]], ctx, { baseRev: 4 }))).toMatchObject({ status: 409, code: "stale" });
            const forced = wishes(stored, kaderId, [WISHES[0]], ctx, { baseRev: 4, force: true });
            expect(forced.kaders[0].players[U.a].wishes).toEqual([WISHES[0]]);
        });

        it("moves a setup slot off a removed spec at once and drops the planned spec, the decision stays", () => {
            const { planner, kaderId } = setup();
            let p = wishes(planner, kaderId, WISHES);
            p = players.setState(p, { kaderId, userIds: [U.a], to: "selected" }, ctx).planner;
            p = players.setState(p, { kaderId, userIds: [U.a], to: "provisional" }, ctx).planner;
            p = model.normalizePlanner(p);
            p.kaders[0].setups = [{ id: "v1", name: "A", size: 10, groups: model.emptyGroups() }];
            p.kaders[0].setups[0].groups[0][0] = { userId: U.a, spec: "Mage-Fire" };
            p.kaders[0].plan = { specs: { [U.a]: { className: "Mage", spec: "Mage-Fire" } }, excluded: [], by: U.lead, at: NOW };
            const after = model.normalizePlanner(wishes(p, kaderId, [WISHES[0]]));
            expect(after.kaders[0].setups[0].groups[0][0]).toEqual({ userId: U.a, spec: "Mage-Frost" });
            expect(after.kaders[0].plan.specs[U.a]).toBeUndefined();
        });

        it("does the same for a slot when the interview itself drops the wish", () => {
            const { planner, kaderId } = setup();
            let p = wishes(planner, kaderId, WISHES);
            p = players.setState(p, { kaderId, userIds: [U.a], to: "selected" }, ctx).planner;
            p = model.normalizePlanner(players.setState(p, { kaderId, userIds: [U.a], to: "provisional" }, ctx).planner);
            p.kaders[0].setups = [{ id: "v1", name: "A", size: 10, groups: model.emptyGroups() }];
            p.kaders[0].setups[0].groups[0][0] = { userId: U.a, spec: "Mage-Fire" };
            const after = save(p, kaderId, { wishes: [WISHES[0]] });
            expect(after.kaders[0].setups[0].groups[0][0].spec).toBe("Mage-Frost");
        });
    });

    describe("the history of an interview", () => {
        it("notes a save that changed content, one line per person per ten minutes", () => {
            const { planner, kaderId } = setup();
            let p = save(planner, kaderId, { note: "a" }, at(0));
            p = save(p, kaderId, { note: "ab" }, at(1));
            p = save(p, kaderId, { wishes: [{ className: "Mage", spec: "Mage-Frost" }] }, at(9));
            expect(history(p).map((h) => h.type)).toEqual(["added", "interview_saved"]);
            expect(history(p)[1]).toEqual({ at: at(9).now, by: U.lead, type: "interview_saved" });
            // another person, or the same one after ten minutes: a line of its own
            p = save(p, kaderId, { note: "abc" }, at(10, { actor: U.lead2 }));
            p = save(p, kaderId, { note: "abcd" }, at(30, { actor: U.lead2 }));
            expect(history(p).map((h) => [h.type, h.by])).toEqual([
                ["added", U.lead], ["interview_saved", U.lead], ["interview_saved", U.lead2], ["interview_saved", U.lead2],
            ]);
        });

        it("keeps one line per person when two leads take turns within ten minutes, the newest at the end", () => {
            const { planner, kaderId } = setup();
            let p = planner;
            for (let i = 0; i < 6; i++) p = save(p, kaderId, { note: `Runde ${i}` }, at(i, { actor: i % 2 ? U.lead2 : U.lead }));
            expect(history(p).slice(1)).toEqual([
                { at: at(4).now, by: U.lead, type: "interview_saved" },
                { at: at(5).now, by: U.lead2, type: "interview_saved" },
            ]);
            // after ten minutes it is a new line again
            p = save(p, kaderId, { note: "später" }, at(16));
            expect(history(p).filter((h) => h.type === "interview_saved" && h.by === U.lead)).toHaveLength(2);
        });

        it("notes nothing for a save that changed nothing", () => {
            const { planner, kaderId } = setup();
            const p = save(save(planner, kaderId, { note: "x" }), kaderId, { note: "x" }, at(20));
            expect(history(p).filter((h) => h.type === "interview_saved")).toHaveLength(1);
        });

        it("notes who leads the interview, the newest pick of a person within ten minutes", () => {
            const { planner, kaderId } = setup();
            let p = save(planner, kaderId, { lead: U.lead }, at(0));
            p = save(p, kaderId, { lead: U.lead2 }, at(2));
            expect(history(p).slice(1)).toEqual([{ at: at(2).now, by: U.lead, type: "lead", to: U.lead2 }]);
            p = save(p, kaderId, { lead: "" }, at(3, { actor: U.lead2 }));
            expect(history(p)[2]).toEqual({ at: at(3).now, by: U.lead2, type: "lead", to: "" });
            // naming the interviewer alone does not start the interview
            expect(p.kaders[0].players[U.a].interview.startedAt).toBe("");
        });
    });

    describe("a save over somebody else's change", () => {
        /** The planner as the route stores it: with revisions. */
        const stamp = (before, after, actor = U.lead) => recordChanges(before, model.normalizePlanner(after.planner || after), { actor, now: NOW });

        it("is refused with who changed it, and goes through when forced", () => {
            const { planner, kaderId } = setup();
            const base = stamp(model.emptyPlanner(), planner);
            const seen = base.kaders[0].players[U.a].interview.rev;
            // Lena saves first
            const lena = stamp(base, save(base, kaderId, { note: "Lena war hier" }, at(1, { actor: U.lead2 })), U.lead2);
            const e = refusal(() => save(lena, kaderId, { note: "Kurt", baseRev: seen }));
            expect(e).toMatchObject({ status: 409, code: "stale" });
            expect(e.details).toEqual({ rev: lena.kaders[0].players[U.a].interview.rev, by: U.lead2, at: at(1).now });
            // the current revision passes, and so does "Trotzdem speichern"
            expect(save(lena, kaderId, { note: "Kurt", baseRev: lena.kaders[0].players[U.a].interview.rev }).kaders[0].players[U.a].interview.note).toBe("Kurt");
            expect(save(lena, kaderId, { note: "Kurt", baseRev: seen, force: true }).kaders[0].players[U.a].interview.note).toBe("Kurt");
            // a save without a revision (an older page) is not checked
            expect(save(lena, kaderId, { note: "alt" }).kaders[0].players[U.a].interview.note).toBe("alt");
        });

        it("is refused for a question edited in between, naming who changed it", () => {
            const { planner, kaderId } = setup();
            let p = stamp(model.emptyPlanner(), planner);
            p = stamp(p, questions.addQuestion(p, { kaderId, text: "Voice", type: "text" }));
            const q = p.kaders[0].questions[0];
            p = stamp(p, questions.updateQuestion(p, { kaderId, questionId: q.id, text: "Voice?", baseRev: q.rev }), U.lead2);
            const e = refusal(() => questions.updateQuestion(p, { kaderId, questionId: q.id, text: "Voice!", baseRev: q.rev }));
            expect(e).toMatchObject({ status: 409, code: "stale" });
            expect(e.details).toMatchObject({ by: U.lead2, rev: p.kaders[0].questions[0].rev });
            expect(questions.updateQuestion(p, { kaderId, questionId: q.id, text: "Voice!", baseRev: q.rev, force: true }).kaders[0].questions[0].text).toBe("Voice!");
        });

        it("is refused for an account's characters changed in between", () => {
            const { planner } = setup();
            const chars = (name) => ({ characters: [{ id: "c1", name, className: "Warrior", specs: [] }] });
            let p = stamp(model.emptyPlanner(), planner);
            p = stamp(p, model.setAssignment(p, U.a, { ...chars("Aldric Sturmwind"), baseRev: 0 }, ctx), U.lead2);
            const e = refusal(() => model.setAssignment(p, U.a, { ...chars("Aldric Eisen"), baseRev: 0 }, ctx));
            expect(e).toMatchObject({ status: 409, code: "stale" });
            expect(e.details).toEqual({ rev: p.assignments[U.a].rev, by: U.lead2, at: NOW });
            expect(model.setAssignment(p, U.a, { ...chars("Aldric Eisen"), baseRev: p.assignments[U.a].rev }, ctx).assignments[U.a].characters[0].name).toBe("Aldric Eisen");
        });
    });
});
