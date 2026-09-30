// The players of one Kader (docs/kaderplaner.md): who is in it and in which
// state, the interview of the Vorauswahl (wishes, answers, note), the votes and
// comments of the leads and the decision a player goes into the roster with.
// Pure mutators over the planner, like kaderModel.js.
//
// A player entry:
//   { name,                         the Discord name when the player was added (a fallback)
//     state, since, by,             pool | selected | provisional | roster | bench | tentative
//     addedAt, addedBy,
//     history:   [{ at, by, type, from?, to?, vote?, className?, spec? }]   the newest LIMITS.history
//     wishes:    [{ className, spec }]                                     in order, 1 = most wanted
//     interview: { lead, answers: { [questionId]: optionId | optionId[] | text }, note,
//                  startedAt, updatedAt, updatedBy, completedAt, completedBy }
//     votes:     { [userId]: "yes" | "unsure" | "no" }                     leads only
//     comments:  [{ id, by, at, text }]
//     decision:  { className, spec } | null }                              set when moved into the roster
//
// States stay until somebody changes them — every change is an explicit action
// (setState) and is written into the history with who and when.
const { newId } = require("../../utils/ids");
const {
    STATES, VOTES, LIMITS, str, isObject, invalid, notFound, conflict, forbidden,
    withKader, checkUserId, normalizeAnswer, cleanClassSpec,
} = require("./kaderModel");

/** The state changes the planner knows; everything else is refused. Each can be walked back. */
const MOVES = {
    pool: ["selected"],
    selected: ["pool", "provisional"],
    provisional: ["selected", "roster", "bench", "tentative"],
    roster: ["provisional", "bench", "tentative"],
    bench: ["provisional", "roster", "tentative"],
    tentative: ["provisional", "roster", "bench"],
};

const canMove = (from, to) => (MOVES[from] || []).includes(to);

function pushHistory(entry, item) {
    entry.history.push(item);
    if (entry.history.length > LIMITS.history) entry.history.splice(0, entry.history.length - LIMITS.history);
}

function entryOf(kader, userId) {
    const entry = kader.players[str(userId)];
    if (!entry) throw notFound("Dieser Spieler ist nicht in diesem Kader.");
    return entry;
}

/** Whether a question counts as answered. */
function isAnswered(question, value) {
    if (value === undefined || value === null) return false;
    if (question.type === "multi") return Array.isArray(value) && value.length > 0;
    return str(value).trim() !== "";
}

/**
 * How far an interview is: the wishes plus every required question.
 * `{ done, total, started, completed, missing: [questionId] }`
 */
function interviewProgress(entry, questions) {
    const required = questions.filter((q) => q.required);
    const missing = required.filter((q) => !isAnswered(q, entry.interview.answers[q.id])).map((q) => q.id);
    const wishes = entry.wishes.length > 0 ? 1 : 0;
    return {
        done: wishes + required.length - missing.length,
        total: 1 + required.length,
        started: !!entry.interview.startedAt,
        completed: !!entry.interview.completedAt,
        missing,
        wishes: wishes === 1,
    };
}

// ------------------------------------------------------- in and out

/** A new entry in the pool; the wishes start with the account's character (profile, logs or the planner's own). */
function newEntry(userId, name, ctx, planner) {
    const pre = ctx.prefillOf ? ctx.prefillOf(userId, planner) : null;
    let wishes = [];
    if (pre && pre.className && pre.spec) {
        try {
            wishes = [cleanClassSpec(pre, ctx)];
        } catch {
            wishes = [];
        }
    }
    return {
        name: str(name).trim().slice(0, LIMITS.name),
        state: "pool",
        since: ctx.now,
        by: ctx.actor || "",
        addedAt: ctx.now,
        addedBy: ctx.actor || "",
        history: [{ at: ctx.now, by: ctx.actor || "", type: "added", to: "pool" }],
        wishes,
        interview: { lead: "", answers: {}, note: "", startedAt: "", updatedAt: "", updatedBy: "", completedAt: "", completedBy: "" },
        votes: {},
        comments: [],
        decision: null,
    };
}

/**
 * Takes accounts into a Kader's pool: `players: [{ userId, displayName? }]`.
 * Somebody already in the Kader keeps their state. Answers `added` and `already`.
 */
function addPlayers(planner, input, ctx) {
    const list = Array.isArray(input.players) ? input.players : [];
    if (!list.length) throw invalid("Niemand ausgewählt.");
    return withKader(planner, input.kaderId, (kader, next) => {
        let added = 0;
        let already = 0;
        for (const p of list) {
            const userId = checkUserId(p && p.userId, ctx);
            if (kader.players[userId]) {
                already += 1;
                continue;
            }
            if (Object.keys(kader.players).length >= LIMITS.players) throw conflict(`Mehr als ${LIMITS.players} Spieler je Kader sind nicht vorgesehen.`);
            kader.players[userId] = newEntry(userId, p && p.displayName, ctx, next);
            added += 1;
        }
        return { added, already };
    });
}

/** Takes players out of a Kader — with their interview, votes and comments. */
function removePlayers(planner, input) {
    const ids = (Array.isArray(input.userIds) ? input.userIds : []).map(str).filter(Boolean);
    if (!ids.length) throw invalid("Niemand ausgewählt.");
    return withKader(planner, input.kaderId, (kader) => {
        let removed = 0;
        for (const id of ids) {
            if (kader.players[id]) {
                delete kader.players[id];
                removed += 1;
            }
        }
        if (!removed) throw notFound("Niemand davon ist in diesem Kader.");
        return { removed };
    });
}

// ------------------------------------------------------------- states

/**
 * Moves players into another state (`to`), one or many. A move the planner does
 * not know (MOVES) is skipped; when nothing could move, the call is refused.
 * Into the roster a player goes with a decision: the one given, else the one
 * they had, else their first wish.
 */
function setState(planner, input, ctx) {
    const to = str(input.to);
    if (!STATES.includes(to)) throw invalid("Unbekannter Status.");
    const ids = [...new Set((Array.isArray(input.userIds) ? input.userIds : []).map(str).filter(Boolean))];
    if (!ids.length) throw invalid("Niemand ausgewählt.");
    const decision = input.decision ? cleanClassSpec(input.decision, ctx) : null;
    return withKader(planner, input.kaderId, (kader) => {
        let moved = 0;
        const skipped = [];
        for (const id of ids) {
            const entry = kader.players[id];
            if (!entry) {
                skipped.push(id);
                continue;
            }
            const from = entry.state;
            if (from === to && !(to === "roster" && decision)) continue;
            if (from !== to && !canMove(from, to)) {
                skipped.push(id);
                continue;
            }
            if (from !== to) {
                entry.state = to;
                entry.since = ctx.now;
                entry.by = ctx.actor || "";
                pushHistory(entry, { at: ctx.now, by: ctx.actor || "", type: "state", from, to });
            }
            if (to === "roster") {
                const next = decision || entry.decision || entry.wishes[0] || null;
                const changed = !entry.decision || !next || entry.decision.spec !== next.spec || entry.decision.className !== next.className;
                entry.decision = next ? { className: next.className, spec: next.spec } : null;
                if (next && changed) pushHistory(entry, { at: ctx.now, by: ctx.actor || "", type: "decision", className: next.className, spec: next.spec });
            }
            moved += 1;
        }
        if (!moved && skipped.length) throw conflict("Dieser Wechsel ist für diese Spieler nicht vorgesehen.");
        return { moved, skipped: skipped.length };
    });
}

// ---------------------------------------------------------- interview

function cleanWishes(raw, ctx) {
    if (!Array.isArray(raw)) throw invalid("Wünsche fehlen.");
    if (raw.length > LIMITS.wishes) throw invalid(`Höchstens ${LIMITS.wishes} Wünsche.`);
    const out = [];
    for (const w of raw) {
        const clean = cleanClassSpec(w, ctx);
        if (out.some((x) => x.spec === clean.spec)) throw invalid("Ein Spec steht doppelt in den Wünschen.");
        out.push(clean);
    }
    return out;
}

/**
 * Saves (part of) an interview: `wishes`, `answers` (only the questions given,
 * an empty value clears one), `note`, `lead` (one of the Kader's leads or "").
 * Works in every state; a completed interview stays completed. Only content
 * starts it: naming who leads it plans the interview, it does not begin it.
 */
function saveInterview(planner, input, ctx) {
    return withKader(planner, input.kaderId, (kader) => {
        const entry = entryOf(kader, input.userId);
        const iv = entry.interview;
        if (input.wishes !== undefined) entry.wishes = cleanWishes(input.wishes, ctx);
        if (input.answers !== undefined) {
            if (!isObject(input.answers)) throw invalid("Antworten fehlen.");
            for (const [qid, value] of Object.entries(input.answers)) {
                const question = kader.questions.find((q) => q.id === qid);
                if (!question) throw invalid("Diese Frage gibt es in diesem Kader nicht (mehr).");
                const empty = value === null || value === undefined || (Array.isArray(value) ? !value.length : str(value).trim() === "");
                if (empty) {
                    delete iv.answers[qid];
                    continue;
                }
                if (question.type === "text" && str(value).trim().length > LIMITS.answer) throw invalid(`Die Antwort ist zu lang (höchstens ${LIMITS.answer} Zeichen).`);
                const clean = normalizeAnswer(question, value);
                if (clean === undefined) throw invalid(`Ungültige Antwort auf „${question.text}“.`);
                iv.answers[qid] = clean;
            }
        }
        if (input.note !== undefined) {
            const note = str(input.note);
            if (note.length > LIMITS.note) throw invalid(`Die Notiz ist zu lang (höchstens ${LIMITS.note} Zeichen).`);
            iv.note = note;
        }
        if (input.lead !== undefined) {
            const lead = str(input.lead);
            if (lead && !kader.leads.includes(lead)) throw invalid("Das Gespräch führt jemand aus der Leitung.");
            iv.lead = lead;
        }
        const content = input.wishes !== undefined || input.answers !== undefined || input.note !== undefined;
        if (content && !iv.startedAt) iv.startedAt = ctx.now;
        iv.updatedAt = ctx.now;
        iv.updatedBy = ctx.actor || "";
    });
}

/** "Gespräch abschließen": only with wishes and every required question answered. */
function completeInterview(planner, input, ctx) {
    return withKader(planner, input.kaderId, (kader) => {
        const entry = entryOf(kader, input.userId);
        const progress = interviewProgress(entry, kader.questions);
        if (!progress.wishes) throw conflict("Ohne Spielwunsch lässt sich das Gespräch nicht abschließen.");
        if (progress.missing.length) {
            const names = progress.missing.map((id) => kader.questions.find((q) => q.id === id).text);
            throw conflict(`Noch offen: ${names.join(", ")}.`);
        }
        const iv = entry.interview;
        if (!iv.startedAt) iv.startedAt = ctx.now;
        iv.completedAt = ctx.now;
        iv.completedBy = ctx.actor || "";
        iv.updatedAt = ctx.now;
        iv.updatedBy = ctx.actor || "";
        pushHistory(entry, { at: ctx.now, by: ctx.actor || "", type: "interview_completed" });
    });
}

function reopenInterview(planner, input, ctx) {
    return withKader(planner, input.kaderId, (kader) => {
        const entry = entryOf(kader, input.userId);
        if (!entry.interview.completedAt) throw conflict("Das Gespräch ist noch nicht abgeschlossen.");
        entry.interview.completedAt = "";
        entry.interview.completedBy = "";
        pushHistory(entry, { at: ctx.now, by: ctx.actor || "", type: "interview_reopened" });
    });
}

// ------------------------------------------------ votes and comments

/** The own vote of a lead (`vote` "" takes it back). Only the Kader's leads vote. */
function setVote(planner, input, ctx) {
    const vote = str(input.vote);
    if (vote && !VOTES.includes(vote)) throw invalid("Unbekannte Stimme.");
    return withKader(planner, input.kaderId, (kader) => {
        if (!ctx.actor || !kader.leads.includes(ctx.actor)) throw forbidden("Nur die Leitung dieses Kaders stimmt ab.");
        const entry = entryOf(kader, input.userId);
        if (vote) entry.votes[ctx.actor] = vote;
        else delete entry.votes[ctx.actor];
        pushHistory(entry, { at: ctx.now, by: ctx.actor, type: "vote", vote: vote || "none" });
    });
}

function addComment(planner, input, ctx) {
    const text = str(input.text).trim();
    if (!text) throw invalid("Der Kommentar ist leer.");
    if (text.length > LIMITS.comment) throw invalid(`Der Kommentar ist zu lang (höchstens ${LIMITS.comment} Zeichen).`);
    return withKader(planner, input.kaderId, (kader) => {
        const entry = entryOf(kader, input.userId);
        if (entry.comments.length >= LIMITS.comments) throw conflict(`Mehr als ${LIMITS.comments} Kommentare je Spieler sind nicht vorgesehen.`);
        const comment = { id: newId(4), by: ctx.actor || "", at: ctx.now, text };
        entry.comments.push(comment);
        return { commentId: comment.id };
    });
}

/** Deletes an own comment. */
function deleteComment(planner, input, ctx) {
    return withKader(planner, input.kaderId, (kader) => {
        const entry = entryOf(kader, input.userId);
        const comment = entry.comments.find((c) => c.id === str(input.commentId));
        if (!comment) throw notFound("Kommentar nicht gefunden.");
        if (!ctx.actor || comment.by !== ctx.actor) throw forbidden("Nur eigene Kommentare lassen sich löschen.");
        entry.comments = entry.comments.filter((c) => c.id !== comment.id);
    });
}

module.exports = {
    MOVES, canMove, isAnswered, interviewProgress,
    addPlayers, removePlayers, setState,
    saveInterview, completeInterview, reopenInterview,
    setVote, addComment, deleteComment,
};
