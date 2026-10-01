// What changed in the Kaderplaner, and when (docs/kaderplaner.md, "Live"):
// after every write the planner as stored before is compared with the planner
// about to be stored, and the difference is written down as revisions and as
// lines of each Kader's activity log. The page polls the revisions
// (GET /api/kader/live) to see that somebody else changed something; the
// conflict checks of a save compare them (kaderModel.assertFresh). Pure.
//
// Revisions are stamps of one counter per server, `planner.rev`, raised by one
// for every write that changed anything:
//
//   planner.rev           the counter itself
//   planner.sharedRev     the server's side changed (accounts, character data, a Kader created, renamed or deleted)
//   kader.rev             something in this Kader changed
//   entry.interview.rev   wishes, answers, note, interviewer or completion of this interview
//   question.rev          this question
//   assignment.rev/by/at  the planner's characters of this account
//
// Being stamps of one counter they only grow, so "the stored revision is not
// the one I started from" always means a change in between, also after an
// item was deleted and made again.
//
// An activity line is `{ rev, at, by, type, playerId?, count?, from?, to?,
// questionId? }` — types and ids only, never an answer, a note or a comment.
// Several players moved by one write are one line with a count. Repeated
// edits of the same thing by the same person within COALESCE_MS are one line
// (an interview typed and autosaved every second stays one line), also when
// other people's lines stand in between (two leads taking turns on one
// interview): the earlier line goes, the new one is the newest. The log keeps
// the newest LIMITS.activity lines.
const { LIMITS } = require("./kaderModel");

/** The line types an edit can repeat quickly; the same one again within COALESCE_MS replaces the older line. */
const COALESCE = new Set(["interview", "lead", "questions", "setups", "settings", "character"]);
const COALESCE_MS = 10 * 60 * 1000;
/** At most this many lines answer one poll (the page shows one toast for them anyway). */
const CHANGES_MAX = 20;

/** JSON of a value without its revision fields and logs: what a change is compared by. */
const plain = (v) => JSON.stringify(v === undefined ? null : v, (k, x) => (k === "rev" || k === "activity" ? undefined : x));
const same = (a, b) => plain(a) === plain(b);

/** The content of an account's character data (the stamp fields left out). */
const assignmentKey = (a) => (a ? plain({ characters: a.characters, activeCharacterId: a.activeCharacterId }) : "null");

/** Wishes, answers and note of an interview: what "Gespräch gespeichert" means. */
const interviewContent = (e) => plain([e.wishes, e.interview.answers, e.interview.note]);

function within(a, b, ms) {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(tb - ta) < ms;
}

/** Several players of one kind of change as one line: the player when there is one, else the count. */
function grouped(type, ids, extra = {}) {
    if (!ids.length) return null;
    return ids.length === 1 ? { type, playerId: ids[0], ...extra } : { type, count: ids.length, ...extra };
}

/** The question lines of a change, and the revision stamp on every question that is new or changed. */
function questionLines(prev, next, rev) {
    const before = new Map(prev.questions.map((q) => [q.id, q]));
    const touched = [];
    for (const q of next.questions) {
        const was = before.get(q.id);
        if (!was || !same(was, q)) {
            q.rev = rev;
            touched.push(q.id);
        }
    }
    const kept = new Set(next.questions.map((q) => q.id));
    const removed = prev.questions.filter((q) => !kept.has(q.id)).map((q) => q.id);
    const orderBefore = prev.questions.map((q) => q.id).filter((id) => kept.has(id));
    const orderAfter = next.questions.map((q) => q.id).filter((id) => before.has(id));
    const all = [...touched, ...removed];
    if (!all.length && same(orderBefore, orderAfter)) return [];
    return [all.length === 1 ? { type: "questions", questionId: all[0] } : { type: "questions" }];
}

/** The lines of one player who was in the Kader before and after; stamps the interview's revision when it changed. */
function playerLines(id, was, now, rev, questionsChanged) {
    const out = [];
    const ivContent = interviewContent(was) !== interviewContent(now);
    const lead = was.interview.lead !== now.interview.lead;
    const completed = !was.interview.completedAt && !!now.interview.completedAt;
    const reopened = !!was.interview.completedAt && !now.interview.completedAt;
    if (ivContent || lead || completed || reopened) now.interview.rev = rev;
    if (was.state === now.state && now.state === "roster" && !same(was.decision, now.decision)) out.push({ type: "decision", playerId: id });
    if (completed) out.push({ type: "interview_completed", playerId: id });
    if (reopened) out.push({ type: "interview_reopened", playerId: id });
    // a question edited or deleted refits the answers of many: that is one "questions" line, not one per player
    if (ivContent && !questionsChanged) out.push({ type: "interview", playerId: id });
    if (lead) out.push({ type: "lead", playerId: id, to: now.interview.lead });
    if (!same(was.votes, now.votes)) out.push({ type: "vote", playerId: id });
    const wasComments = new Set(was.comments.map((c) => c.id));
    const nowComments = new Set(now.comments.map((c) => c.id));
    if (now.comments.some((c) => !wasComments.has(c.id))) out.push({ type: "comment", playerId: id });
    if (was.comments.some((c) => !nowComments.has(c.id))) out.push({ type: "comment_deleted", playerId: id });
    return out;
}

/**
 * The lines of one Kader that was there before and after (without who and
 * when), stamping the revisions of what changed in it.
 */
function kaderLines(prev, next, rev) {
    const lines = [];
    if (prev.name !== next.name || !same(prev.leads, next.leads) || !same(prev.attendanceCategories, next.attendanceCategories)) {
        lines.push({ type: "settings" });
    }
    const questions = questionLines(prev, next, rev);
    lines.push(...questions);

    const added = [];
    const removed = Object.keys(prev.players).filter((id) => !next.players[id]);
    const moves = new Map();
    const per = [];
    for (const [id, now] of Object.entries(next.players)) {
        const was = prev.players[id];
        if (!was) {
            added.push(id);
            now.interview.rev = rev;
            continue;
        }
        if (was.state !== now.state) {
            if (!moves.has(now.state)) moves.set(now.state, []);
            moves.get(now.state).push({ id, from: was.state });
        }
        per.push(...playerLines(id, was, now, rev, questions.length > 0));
    }
    lines.push(...[grouped("added", added), grouped("removed", removed)].filter(Boolean));
    for (const [to, list] of moves) {
        lines.push(list.length === 1 ? { type: "state", playerId: list[0].id, from: list[0].from, to } : { type: "state", count: list.length, to });
    }
    lines.push(...per);
    // a move out of the setup states drops the player's slots by itself: that is the move, not a setup change
    if (!same(prev.setups, next.setups) && !moves.size && !removed.length) lines.push({ type: "setups" });
    return lines;
}

/**
 * The index of the line a repeated edit folds into: the same person, kind and thing (player, question) within
 * COALESCE_MS — also with other people's lines in between (two people taking turns on one interview). -1 = none.
 */
function repeatOf(log, line) {
    if (!COALESCE.has(line.type)) return -1;
    for (let i = log.length - 1; i >= 0; i--) {
        const a = log[i];
        // the log is oldest first: once a line is out of the window, every older one is too
        if (!within(a.at, line.at, COALESCE_MS)) return -1;
        if (a.type === line.type && a.by === line.by && (a.playerId || "") === (line.playerId || "") && (a.questionId || "") === (line.questionId || "")) return i;
    }
    return -1;
}

/** Appends lines to a Kader's log; a repeated edit replaces its earlier line and moves to the end (the newest). */
function appendActivity(kader, lines) {
    const log = Array.isArray(kader.activity) ? kader.activity : [];
    for (const line of lines) {
        const i = repeatOf(log, line);
        if (i >= 0) log.splice(i, 1);
        log.push(line);
    }
    kader.activity = log.slice(-LIMITS.activity);
}

/** Character data of accounts: stamps what changed (or keeps the stamp of what did not), answers the changed user ids. */
function assignmentChanges(before, after, { rev, actor, now }) {
    const changed = [];
    for (const id of new Set([...Object.keys(before.assignments), ...Object.keys(after.assignments)])) {
        const was = before.assignments[id];
        const is = after.assignments[id];
        if (assignmentKey(was) === assignmentKey(is)) {
            // saved again unchanged: the new object keeps the old stamp
            if (was && is && was.rev && !is.rev) Object.assign(is, { rev: was.rev, by: was.by, at: was.at });
            continue;
        }
        changed.push(id);
        if (is) Object.assign(is, { rev, by: actor, at: now });
    }
    return changed;
}

/**
 * Compares the planner as stored (`before`, normalised) with the one about to
 * be stored (`after`, normalised; changed in place and returned): raises the
 * counter when anything changed and stamps every Kader, interview, question
 * and account that changed with it, writes the activity lines. Nothing changed
 * = `after` as it is.
 */
function recordChanges(before, after, { actor = "", now = new Date().toISOString() } = {}) {
    const rev = (before.rev || 0) + 1;
    const stamp = { rev, actor, now };
    let changed = false;
    let shared = false;

    const characters = assignmentChanges(before, after, stamp);
    if (characters.length || !same(before.accounts, after.accounts)) changed = shared = true;

    const prevById = new Map(before.kaders.map((k) => [k.id, k]));
    const ids = new Set(after.kaders.map((k) => k.id));
    if (before.kaders.some((k) => !ids.has(k.id))) changed = shared = true;

    for (const kader of after.kaders) {
        const prev = prevById.get(kader.id);
        if (!prev) {
            kader.rev = rev;
            for (const entry of Object.values(kader.players)) entry.interview.rev = rev;
            appendActivity(kader, [{ rev, at: now, by: actor, type: "created" }]);
            changed = shared = true;
            continue;
        }
        const lines = kaderLines(prev, kader, rev);
        for (const id of characters) if (prev.players[id] && kader.players[id]) lines.push({ type: "character", playerId: id });
        if (!lines.length && same(prev, kader)) continue;
        kader.rev = rev;
        appendActivity(kader, lines.map((line) => ({ rev, at: now, by: actor, ...line })));
        if (prev.name !== kader.name) shared = true;
        changed = true;
    }

    if (!changed) return after;
    after.rev = rev;
    if (shared) after.sharedRev = rev;
    return after;
}

/**
 * The activity lines after revision `since` (oldest first, at most CHANGES_MAX,
 * the newest), and `more` when there may have been more than these (cut here,
 * or older than the log reaches back).
 */
function changesSince(activity, since) {
    const from = Number(since);
    const log = Array.isArray(activity) ? activity : [];
    if (!Number.isFinite(from) || from < 0) return { changes: [], more: false };
    const newer = log.filter((a) => a.rev > from);
    const reachesBack = log.length < LIMITS.activity || log[0].rev <= from;
    return { changes: newer.slice(-CHANGES_MAX), more: newer.length > CHANGES_MAX || (newer.length > 0 && !reachesBack) };
}

module.exports = { COALESCE, COALESCE_MS, CHANGES_MAX, recordChanges, changesSince };
