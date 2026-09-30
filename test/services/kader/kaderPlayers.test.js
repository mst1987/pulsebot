// The players of a Kader (docs/kaderplaner.md): in and out, the persistent
// states and their allowed changes, the interview, votes, comments and the
// decision — every change with who and when.
const model = require("../../../src/services/kader/kaderModel");
const players = require("../../../src/services/kader/kaderPlayers");
const questions = require("../../../src/services/kader/kaderQuestions");
const { U, NOW, kaderCtx, refusal } = require("../../helpers/kaderFixtures");

const prefill = { [U.a]: { className: "Mage", spec: "Mage-Frost" }, [U.b]: { className: "Mage", spec: "Nope" } };
const ctx = kaderCtx({ prefillOf: (id) => prefill[id] || null });
const later = (over = {}) => ({ ...ctx, now: "2026-10-05T20:00:00.000Z", ...over });

function setup() {
    const { planner, kaderId } = model.createKader(model.emptyPlanner(), { name: "K" }, ctx);
    const added = players.addPlayers(planner, { kaderId, players: [{ userId: U.a, displayName: "Aldric" }, { userId: U.b }, { userId: U.c }] }, ctx);
    return { planner: added.planner, kaderId };
}
const entry = (planner, id) => planner.kaders[0].players[id];
const move = (planner, kaderId, ids, to, over = {}) => players.setState(planner, { kaderId, userIds: ids, to, ...over }, ctx).planner;

describe("services/kader/kaderPlayers", () => {
    describe("in and out", () => {
        it("takes accounts into the pool with their prefilled character as the first wish", () => {
            const { planner, kaderId } = setup();
            expect(entry(planner, U.a)).toMatchObject({
                name: "Aldric", state: "pool", since: NOW, by: U.lead, addedBy: U.lead,
                wishes: [{ className: "Mage", spec: "Mage-Frost" }],
                history: [{ at: NOW, by: U.lead, type: "added", to: "pool" }],
                decision: null,
            });
            // an unknown spec from the prefill is no wish
            expect(entry(planner, U.b).wishes).toEqual([]);
            const again = players.addPlayers(planner, { kaderId, players: [{ userId: U.a }, { userId: U.d }] }, ctx);
            expect(again).toMatchObject({ added: 1, already: 1 });
            expect(refusal(() => players.addPlayers(planner, { kaderId, players: [{ userId: "12" }] }, ctx)).status).toBe(400);
            expect(refusal(() => players.addPlayers(planner, { kaderId, players: [] }, ctx)).status).toBe(400);
        });

        it("takes players out again, with everything they had", () => {
            const { planner, kaderId } = setup();
            const out = players.removePlayers(planner, { kaderId, userIds: [U.a, "nobody"] });
            expect(out.removed).toBe(1);
            expect(entry(out.planner, U.a)).toBeUndefined();
            expect(refusal(() => players.removePlayers(out.planner, { kaderId, userIds: [U.a] })).status).toBe(404);
        });
    });

    describe("states", () => {
        it("walks the pipeline forward and back, each step with who and when", () => {
            const { planner, kaderId } = setup();
            let p = move(planner, kaderId, [U.a], "selected");
            p = move(p, kaderId, [U.a], "provisional");
            p = players.setState(p, { kaderId, userIds: [U.a], to: "roster" }, later()).planner;
            const e = entry(p, U.a);
            expect(e).toMatchObject({ state: "roster", since: "2026-10-05T20:00:00.000Z", by: U.lead, decision: { className: "Mage", spec: "Mage-Frost" } });
            expect(e.history.map((h) => h.type)).toEqual(["added", "state", "state", "state", "decision"]);
            expect(e.history[3]).toEqual({ at: "2026-10-05T20:00:00.000Z", by: U.lead, type: "state", from: "provisional", to: "roster" });
            // and back: roster → provisional → selected → pool
            p = move(p, kaderId, [U.a], "provisional");
            p = move(p, kaderId, [U.a], "selected");
            p = move(p, kaderId, [U.a], "pool");
            expect(entry(p, U.a).state).toBe("pool");
            // the decision is kept for later
            expect(entry(p, U.a).decision).toEqual({ className: "Mage", spec: "Mage-Frost" });
        });

        it("refuses a jump the pipeline does not know, and skips such players in a batch", () => {
            const { planner, kaderId } = setup();
            expect(refusal(() => move(planner, kaderId, [U.a], "roster")).status).toBe(409);
            expect(refusal(() => move(planner, kaderId, [U.a], "nowhere")).status).toBe(400);
            let p = move(planner, kaderId, [U.a], "selected");
            const batch = players.setState(p, { kaderId, userIds: [U.a, U.b], to: "provisional" }, ctx);
            expect(batch).toMatchObject({ moved: 1, skipped: 1 });
            expect(entry(batch.planner, U.b).state).toBe("pool");
            // staying where one is is no move and no refusal
            p = players.setState(p, { kaderId, userIds: [U.a], to: "selected" }, ctx);
            expect(p).toMatchObject({ moved: 0, skipped: 0 });
        });

        it("moves bench, tentative and roster among each other and takes a chosen decision", () => {
            const { planner, kaderId } = setup();
            let p = move(move(planner, kaderId, [U.c], "selected"), kaderId, [U.c], "provisional");
            p = move(p, kaderId, [U.c], "bench");
            p = move(p, kaderId, [U.c], "tentative");
            p = move(p, kaderId, [U.c], "roster", { decision: { className: "Priest", spec: "Priest-Holy" } });
            expect(entry(p, U.c)).toMatchObject({ state: "roster", decision: { className: "Priest", spec: "Priest-Holy" } });
            p = move(p, kaderId, [U.c], "roster", { decision: { className: "Priest", spec: "Priest-Shadow" } });
            expect(entry(p, U.c).decision.spec).toBe("Priest-Shadow");
            expect(entry(p, U.c).history.filter((h) => h.type === "decision").map((h) => h.spec)).toEqual(["Priest-Holy", "Priest-Shadow"]);
            expect(refusal(() => move(p, kaderId, [U.c], "roster", { decision: { className: "Priest", spec: "Mage-Fire" } })).status).toBe(400);
        });

        it("keeps the history bounded to the newest entries", () => {
            const { planner, kaderId } = setup();
            let p = planner;
            for (let i = 0; i < 40; i++) p = move(move(p, kaderId, [U.a], "selected"), kaderId, [U.a], "pool");
            const history = entry(p, U.a).history;
            expect(history).toHaveLength(50);
            expect(history[0].type).toBe("state");
        });
    });

    describe("interview", () => {
        function withQuestions() {
            const { planner, kaderId } = setup();
            let p = questions.addQuestion(planner, { kaderId, text: "Raidtage", type: "multi", options: ["Mo", "Di", "Mi"], required: true }).planner;
            p = questions.addQuestion(p, { kaderId, text: "Voice", type: "single", options: ["Immer", "Selten"] }).planner;
            p = questions.addQuestion(p, { kaderId, text: "Sonst", type: "text" }).planner;
            const [days, voice, other] = p.kaders[0].questions;
            return { planner: move(p, kaderId, [U.a], "selected"), kaderId, days, voice, other };
        }

        it("saves wishes, answers, note and lead; the first save starts it", () => {
            const { planner, kaderId, days, voice, other } = withQuestions();
            let p = model.updateKader(planner, { kaderId, leads: [U.lead, U.lead2] }, ctx);
            p = players.saveInterview(p, {
                kaderId, userId: U.a,
                wishes: [{ className: "Warrior", spec: "Warrior-Fury" }, { className: "Mage", spec: "Mage-Fire" }],
                answers: { [days.id]: [days.options[2].id, days.options[0].id], [voice.id]: voice.options[1].id, [other.id]: " hat Twink " },
                note: "Will Furor lernen",
                lead: U.lead2,
            }, later());
            const iv = entry(p, U.a).interview;
            expect(entry(p, U.a).wishes.map((w) => w.spec)).toEqual(["Warrior-Fury", "Mage-Fire"]);
            // multi answers follow the option order
            expect(iv.answers).toEqual({ [days.id]: [days.options[0].id, days.options[2].id], [voice.id]: voice.options[1].id, [other.id]: "hat Twink" });
            expect(iv).toMatchObject({ note: "Will Furor lernen", lead: U.lead2, startedAt: "2026-10-05T20:00:00.000Z", updatedBy: U.lead });
            // an empty value clears one answer, the others stay
            p = players.saveInterview(p, { kaderId, userId: U.a, answers: { [voice.id]: "" } }, ctx);
            expect(Object.keys(entry(p, U.a).interview.answers)).toEqual([days.id, other.id]);
            expect(entry(p, U.a).interview.startedAt).toBe("2026-10-05T20:00:00.000Z");
        });

        it("refuses what does not fit: unknown questions and options, a lead from outside, too long texts, doubled wishes", () => {
            const { planner, kaderId, voice } = withQuestions();
            const bad = (input) => refusal(() => players.saveInterview(planner, { kaderId, userId: U.a, ...input }, ctx));
            expect(bad({ answers: { nope: "x" } }).message).toMatch(/Frage/);
            expect(bad({ answers: { [voice.id]: "zz" } }).message).toMatch(/Ungültige Antwort/);
            expect(bad({ lead: U.b }).message).toMatch(/Leitung/);
            expect(bad({ note: "x".repeat(2001) }).message).toMatch(/2000/);
            expect(bad({ wishes: [{ className: "Mage", spec: "Mage-Fire" }, { className: "Mage", spec: "Mage-Fire" }] }).message).toMatch(/doppelt/);
            expect(bad({ wishes: [{ className: "Mage", spec: "Priest-Holy" }] }).status).toBe(400);
            expect(refusal(() => players.saveInterview(planner, { kaderId, userId: U.d, note: "x" }, ctx)).status).toBe(404);
        });

        it("completes only with a wish and every required answer, and reopens", () => {
            const { planner, kaderId, days } = withQuestions();
            expect(players.interviewProgress(entry(planner, U.a), planner.kaders[0].questions)).toMatchObject({ done: 1, total: 2, started: false, completed: false, missing: [days.id] });
            expect(refusal(() => players.completeInterview(planner, { kaderId, userId: U.a }, ctx)).message).toMatch(/Raidtage/);
            let p = players.saveInterview(planner, { kaderId, userId: U.a, answers: { [days.id]: [days.options[0].id] } }, ctx);
            p = players.completeInterview(p, { kaderId, userId: U.a }, later());
            expect(entry(p, U.a).interview).toMatchObject({ completedAt: "2026-10-05T20:00:00.000Z", completedBy: U.lead });
            expect(players.interviewProgress(entry(p, U.a), p.kaders[0].questions)).toMatchObject({ done: 2, total: 2, completed: true });
            p = players.reopenInterview(p, { kaderId, userId: U.a }, ctx);
            expect(entry(p, U.a).interview.completedAt).toBe("");
            expect(entry(p, U.a).history.map((h) => h.type).slice(-2)).toEqual(["interview_completed", "interview_reopened"]);
            expect(refusal(() => players.reopenInterview(p, { kaderId, userId: U.a }, ctx)).status).toBe(409);
            const noWish = players.saveInterview(planner, { kaderId, userId: U.a, wishes: [], answers: { [days.id]: [days.options[0].id] } }, ctx);
            expect(refusal(() => players.completeInterview(noWish, { kaderId, userId: U.a }, ctx)).message).toMatch(/Spielwunsch/);
        });
    });

    describe("votes and comments", () => {
        it("lets only the Kader's leads vote, one vote each, taken back with an empty one", () => {
            const { planner, kaderId } = setup();
            let p = players.setVote(planner, { kaderId, userId: U.a, vote: "yes" }, ctx);
            p = players.setVote(p, { kaderId, userId: U.a, vote: "unsure" }, ctx);
            expect(entry(p, U.a).votes).toEqual({ [U.lead]: "unsure" });
            expect(refusal(() => players.setVote(p, { kaderId, userId: U.a, vote: "yes" }, later({ actor: U.b }))).status).toBe(403);
            expect(refusal(() => players.setVote(p, { kaderId, userId: U.a, vote: "maybe" }, ctx)).status).toBe(400);
            p = players.setVote(p, { kaderId, userId: U.a, vote: "" }, ctx);
            expect(entry(p, U.a).votes).toEqual({});
            expect(entry(p, U.a).history.filter((h) => h.type === "vote").map((h) => h.vote)).toEqual(["yes", "unsure", "none"]);
        });

        it("adds comments by anybody who may write, and deletes only one's own", () => {
            const { planner, kaderId } = setup();
            const first = players.addComment(planner, { kaderId, userId: U.a, text: "  zuverlässig  " }, ctx);
            expect(entry(first.planner, U.a).comments).toEqual([{ id: first.commentId, by: U.lead, at: NOW, text: "zuverlässig" }]);
            const second = players.addComment(first.planner, { kaderId, userId: U.a, text: "zu viele Pala" }, later({ actor: U.b }));
            expect(refusal(() => players.deleteComment(second.planner, { kaderId, userId: U.a, commentId: first.commentId }, later({ actor: U.b }))).status).toBe(403);
            const p = players.deleteComment(second.planner, { kaderId, userId: U.a, commentId: first.commentId }, ctx);
            expect(entry(p, U.a).comments.map((c) => c.text)).toEqual(["zu viele Pala"]);
            expect(refusal(() => players.addComment(p, { kaderId, userId: U.a, text: "  " }, ctx)).status).toBe(400);
            expect(refusal(() => players.addComment(p, { kaderId, userId: U.a, text: "x".repeat(1001) }, ctx)).status).toBe(400);
            expect(refusal(() => players.deleteComment(p, { kaderId, userId: U.a, commentId: "gone" }, ctx)).status).toBe(404);
        });
    });
});
