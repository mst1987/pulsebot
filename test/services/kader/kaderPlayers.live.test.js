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
