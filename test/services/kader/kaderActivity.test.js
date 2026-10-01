// What changed in the Kaderplaner (docs/kaderplaner.md, "Live"): every write
// raises the planner's counter and stamps what it changed — the Kader, an
// interview, a question, an account's characters, the server's side — and
// writes lines into the Kader's activity log: types and ids only, several
// players as one line, repeated edits of one person folded into one line, the
// newest 50 kept.
const model = require("../../../src/services/kader/kaderModel");
const players = require("../../../src/services/kader/kaderPlayers");
const questions = require("../../../src/services/kader/kaderQuestions");
const setups = require("../../../src/services/kader/kaderSetups");
const { recordChanges, changesSince, CHANGES_MAX, COALESCE_MS } = require("../../../src/services/kader/kaderActivity");
const { U, NOW, kaderCtx } = require("../../helpers/kaderFixtures");

const ctx = kaderCtx({ prefillOf: () => ({ className: "Mage", spec: "Mage-Frost" }) });
const at = (minutes) => new Date(Date.parse(NOW) + minutes * 60000).toISOString();

/** A mutator's result written the way the route writes it: normalised, then compared with what was stored. */
function write(before, result, { actor = U.lead, now = NOW } = {}) {
    const next = result && result.planner ? result.planner : result;
    return recordChanges(before, model.normalizePlanner(next), { actor, now });
}

/** A stored Kader with Aldric, Bea and Cara in the pool. */
function stored() {
    const created = model.createKader(model.emptyPlanner(), { name: "K" }, ctx);
    let p = write(model.emptyPlanner(), created);
    p = write(p, players.addPlayers(p, { kaderId: created.kaderId, players: [{ userId: U.a }, { userId: U.b }, { userId: U.c }] }, ctx));
    return { planner: p, kaderId: created.kaderId };
}
const kaderOf = (p) => p.kaders[0];
const lastLine = (p) => kaderOf(p).activity[kaderOf(p).activity.length - 1];

describe("services/kader/kaderActivity", () => {
    describe("revisions", () => {
        it("stamps a new Kader and its creation, and the server's side (the picker lists it)", () => {
            const { planner, kaderId } = stored();
            expect(planner.rev).toBe(2);
            expect(planner.sharedRev).toBe(1);
            expect(kaderOf(planner)).toMatchObject({ id: kaderId, rev: 2 });
            expect(kaderOf(planner).activity.map((a) => a.type)).toEqual(["created", "added"]);
            expect(kaderOf(planner).activity[1]).toEqual({ rev: 2, at: NOW, by: U.lead, type: "added", count: 3 });
            // every new player's interview carries the revision it came in with
            expect(kaderOf(planner).players[U.a].interview.rev).toBe(2);
        });

        it("raises the revision for every kind of write, and only when something changed", () => {
            const start = stored();
            const kaderId = start.kaderId;
            let p = start.planner;
            const kinds = [
                (q) => model.updateKader(q, { kaderId, name: "Neu" }, ctx),
                (q) => model.updateKader(q, { kaderId, leads: [U.lead, U.lead2] }, ctx),
                (q) => model.updateKader(q, { kaderId, attendanceCategories: ["c1"] }, { ...ctx, raidCategoryIds: new Set(["c1"]) }),
                (q) => players.setState(q, { kaderId, userIds: [U.a, U.b], to: "selected" }, ctx),
                (q) => players.saveInterview(q, { kaderId, userId: U.a, note: "x" }, ctx),
                (q) => players.saveInterview(q, { kaderId, userId: U.a, lead: U.lead }, ctx),
                (q) => players.completeInterview(q, { kaderId, userId: U.a }, ctx),
                (q) => players.reopenInterview(q, { kaderId, userId: U.a }, ctx),
                (q) => players.setVote(q, { kaderId, userId: U.a, vote: "yes" }, ctx),
                (q) => players.addComment(q, { kaderId, userId: U.a, text: "gut" }, ctx),
                (q) => players.deleteComment(q, { kaderId, userId: U.a, commentId: kaderOf(q).players[U.a].comments[0].id }, ctx),
                (q) => questions.addQuestion(q, { kaderId, text: "Voice", type: "single", options: ["Ja", "Nein"] }),
                (q) => questions.updateQuestion(q, { kaderId, questionId: kaderOf(q).questions[0].id, text: "Voice?" }),
                (q) => questions.addQuestion(q, { kaderId, text: "Tage", type: "text" }),
                (q) => questions.orderQuestions(q, { kaderId, order: [kaderOf(q).questions[1].id] }),
                (q) => questions.deleteQuestion(q, { kaderId, questionId: kaderOf(q).questions[0].id }),
                (q) => setups.addVariant(q, { kaderId }),
                (q) => setups.deleteVariant(q, { kaderId, variantId: kaderOf(q).setups[1].id }),
                (q) => model.setAssignment(q, U.a, { characters: [{ id: "c1", name: "Aldric Sturmwind", className: "Warrior", specs: [] }] }, ctx),
                (q) => model.resetAssignment(q, U.a),
                (q) => model.addAccount(q, { userId: U.hand, displayName: "Hand" }, ctx),
                (q) => model.removeAccount(q, U.hand),
                (q) => players.removePlayers(q, { kaderId, userIds: [U.c] }),
            ];
            for (const kind of kinds) {
                const next = write(p, kind(p));
                expect(next.rev).toBe(p.rev + 1);
                p = next;
            }
            // a write that changes nothing raises nothing
            const same = write(p, players.setState(p, { kaderId, userIds: [U.a], to: "selected" }, ctx));
            expect(same.rev).toBe(p.rev);
        });

        it("stamps what changed: the Kader, the interview, the question, the account; the server's side only for its own changes", () => {
            const { planner, kaderId } = stored();
            let p = write(planner, players.setState(planner, { kaderId, userIds: [U.a], to: "selected" }, ctx));
            expect(kaderOf(p).rev).toBe(3);
            expect(p.sharedRev).toBe(1);
            // a move is no interview change
            expect(kaderOf(p).players[U.a].interview.rev).toBe(2);
            p = write(p, players.saveInterview(p, { kaderId, userId: U.a, note: "Will heilen" }, ctx));
            expect(kaderOf(p).players[U.a].interview.rev).toBe(4);
            expect(kaderOf(p).players[U.b].interview.rev).toBe(2);
            p = write(p, questions.addQuestion(p, { kaderId, text: "Voice", type: "text" }));
            const q = kaderOf(p).questions[0];
            expect(q.rev).toBe(5);
            p = write(p, model.setAssignment(p, U.a, { characters: [{ id: "c1", name: "Aldric Sturmwind", className: "Warrior", specs: [] }] }, ctx), { actor: U.lead2, now: at(5) });
            expect(p.assignments[U.a]).toMatchObject({ rev: 6, by: U.lead2, at: at(5) });
            expect(p.sharedRev).toBe(6);
            // the player is in this Kader: the Kader says so, too
            expect(lastLine(p)).toEqual({ rev: 6, at: at(5), by: U.lead2, type: "character", playerId: U.a });
            // saved again unchanged: the stamp stays
            const again = write(p, model.setAssignment(p, U.a, { characters: [{ id: "c1", name: "Aldric Sturmwind", className: "Warrior", specs: [] }] }, ctx));
            expect(again.rev).toBe(6);
            expect(again.assignments[U.a].rev).toBe(6);
            // a rename shows in every Kader picker: the server's side
            p = write(p, model.updateKader(p, { kaderId, name: "Mittwoch" }, ctx));
            expect(p.sharedRev).toBe(7);
        });

        it("stamps a Kader deleted as a change of the server's side", () => {
            const { planner, kaderId } = stored();
            const p = write(planner, model.deleteKader(planner, kaderId));
            expect(p).toMatchObject({ rev: 3, sharedRev: 3, kaders: [] });
        });
    });

    describe("the activity log", () => {
        it("writes one line per kind of change, several players as one line with a count", () => {
            const { planner, kaderId } = stored();
            let p = write(planner, players.setState(planner, { kaderId, userIds: [U.a, U.b], to: "selected" }, ctx));
            expect(lastLine(p)).toEqual({ rev: 3, at: NOW, by: U.lead, type: "state", count: 2, to: "selected" });
            p = write(p, players.setState(p, { kaderId, userIds: [U.a], to: "provisional" }, ctx));
            expect(lastLine(p)).toEqual({ rev: 4, at: NOW, by: U.lead, type: "state", playerId: U.a, from: "selected", to: "provisional" });
            p = write(p, players.setState(p, { kaderId, userIds: [U.a], to: "roster", decision: { className: "Mage", spec: "Mage-Fire" } }, ctx));
            p = write(p, players.setState(p, { kaderId, userIds: [U.a], to: "roster", decision: { className: "Mage", spec: "Mage-Frost" } }, ctx));
            expect(lastLine(p)).toMatchObject({ type: "decision", playerId: U.a });
            p = write(p, players.saveInterview(p, { kaderId, userId: U.b, lead: U.lead }, ctx));
            expect(lastLine(p)).toMatchObject({ type: "lead", playerId: U.b, to: U.lead });
            p = write(p, players.removePlayers(p, { kaderId, userIds: [U.c] }));
            expect(lastLine(p)).toMatchObject({ type: "removed", playerId: U.c });
        });

        it("never writes an answer, a note or a comment into the log", () => {
            const { planner, kaderId } = stored();
            let p = write(planner, questions.addQuestion(planner, { kaderId, text: "Frage", type: "text" }));
            const qid = kaderOf(p).questions[0].id;
            p = write(p, players.saveInterview(p, { kaderId, userId: U.a, note: "GEHEIM-NOTIZ", answers: { [qid]: "GEHEIM-ANTWORT" } }, ctx));
            p = write(p, players.addComment(p, { kaderId, userId: U.a, text: "GEHEIM-KOMMENTAR" }, ctx));
            const log = JSON.stringify(kaderOf(p).activity);
            for (const secret of ["GEHEIM-NOTIZ", "GEHEIM-ANTWORT", "GEHEIM-KOMMENTAR"]) expect(log).not.toContain(secret);
            expect(kaderOf(p).activity.slice(-2).map((a) => a.type)).toEqual(["interview", "comment"]);
        });

        it("folds repeated edits of one person into one line, not those of another person or after ten minutes", () => {
            const { planner, kaderId } = stored();
            let p = planner;
            for (let i = 0; i < 5; i++) p = write(p, players.saveInterview(p, { kaderId, userId: U.a, note: `Notiz ${i}` }, ctx), { now: at(i) });
            const interviewLines = () => kaderOf(p).activity.filter((a) => a.type === "interview");
            expect(interviewLines()).toEqual([{ rev: p.rev, at: at(4), by: U.lead, type: "interview", playerId: U.a }]);
            p = write(p, players.saveInterview(p, { kaderId, userId: U.a, note: "von Lena" }, ctx), { actor: U.lead2, now: at(5) });
            expect(interviewLines()).toHaveLength(2);
            p = write(p, players.saveInterview(p, { kaderId, userId: U.a, note: "später" }, ctx), { actor: U.lead2, now: at(5 + COALESCE_MS / 60000) });
            expect(interviewLines()).toHaveLength(3);
            // another player is another line
            p = write(p, players.saveInterview(p, { kaderId, userId: U.b, note: "Bea" }, ctx), { actor: U.lead2, now: at(20) });
            expect(interviewLines()).toHaveLength(4);
        });

        it("folds two people taking turns on one interview into one line each, the newest edit at the end", () => {
            const { planner, kaderId } = stored();
            let p = planner;
            for (let i = 0; i < 6; i++) {
                const actor = i % 2 ? U.lead2 : U.lead;
                p = write(p, players.saveInterview(p, { kaderId, userId: U.a, note: `Runde ${i}` }, ctx), { actor, now: at(i) });
            }
            const lines = kaderOf(p).activity.filter((a) => a.type === "interview");
            expect(lines.map((a) => [a.by, a.at])).toEqual([[U.lead, at(4)], [U.lead2, at(5)]]);
            expect(lastLine(p)).toMatchObject({ by: U.lead2, rev: p.rev });
            // a line of another kind in between stays where it is; the repeated edit moves past it to the end
            p = write(p, players.setVote(p, { kaderId, userId: U.b, vote: "yes" }, ctx), { now: at(6) });
            p = write(p, players.saveInterview(p, { kaderId, userId: U.a, note: "Runde 7" }, ctx), { now: at(7) });
            expect(kaderOf(p).activity.slice(-3).map((a) => [a.type, a.by])).toEqual([["interview", U.lead2], ["vote", U.lead], ["interview", U.lead]]);
        });

        it("keeps the newest 50 lines", () => {
            const start = stored();
            const kaderId = start.kaderId;
            let p = start.planner;
            for (let i = 0; i < 60; i++) p = write(p, players.setVote(p, { kaderId, userId: U.a, vote: i % 2 ? "yes" : "no" }, ctx));
            expect(kaderOf(p).activity).toHaveLength(model.LIMITS.activity);
            expect(lastLine(p).rev).toBe(p.rev);
        });

        it("counts a question edit that refits answers as a question change, not as interviews", () => {
            const { planner, kaderId } = stored();
            let p = write(planner, questions.addQuestion(planner, { kaderId, text: "Voice", type: "single", options: ["Ja", "Nein"] }));
            const q = kaderOf(p).questions[0];
            p = write(p, players.saveInterview(p, { kaderId, userId: U.a, answers: { [q.id]: q.options[1].id } }, ctx));
            const revBefore = kaderOf(p).players[U.a].interview.rev;
            p = write(p, questions.updateQuestion(p, { kaderId, questionId: q.id, options: [{ id: q.options[0].id, label: "Ja" }] }), { now: at(1) });
            expect(lastLine(p)).toMatchObject({ type: "questions", questionId: q.id });
            expect(kaderOf(p).activity.filter((a) => a.type === "interview")).toHaveLength(1);
            // the answer it took moved the interview's revision: an open editor must not overwrite it
            expect(kaderOf(p).players[U.a].interview.rev).toBeGreaterThan(revBefore);
        });
    });

    describe("changesSince", () => {
        const log = (revs) => revs.map((rev) => ({ rev, at: NOW, by: U.lead, type: "vote", playerId: U.a }));

        it("answers the lines after a revision, the newest at most", () => {
            expect(changesSince(log([1, 2, 3]), 1)).toEqual({ changes: log([2, 3]), more: false });
            expect(changesSince(log([1, 2, 3]), 3)).toEqual({ changes: [], more: false });
            const many = log(Array.from({ length: 30 }, (_, i) => i + 1));
            const out = changesSince(many, 0);
            expect(out.changes).toHaveLength(CHANGES_MAX);
            expect(out.changes[CHANGES_MAX - 1].rev).toBe(30);
            expect(out.more).toBe(true);
        });

        it("says `more` when the log no longer reaches back to the page's revision", () => {
            const full = log(Array.from({ length: 50 }, (_, i) => i + 11));
            expect(changesSince(full, 58).more).toBe(false);
            expect(changesSince(full, 3).more).toBe(true);
            expect(changesSince(full, Number.NaN)).toEqual({ changes: [], more: false });
        });
    });
});
