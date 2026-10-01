// The questions of one Kader (docs/kaderplaner.md, "Fragen dieses Kaders"):
// asked in the interview of everybody in its Vorauswahl. Wishes and the note are
// fixed parts of every interview, not questions. Pure mutators like kaderModel.js.
//
//   { id, text, type: "single" | "multi" | "text", options: [{ id, label, color? }], required }
//
// An option's colour is one of OPTION_COLORS (kaderModel.js); without one the
// page picks it by position. A colour the palette does not know is a 400; an
// option sent without `color` keeps the one it had, `color: ""` resets it.
//
// Rules the answers depend on:
//   - a new question is simply unanswered (open) for everybody,
//   - deleting a question deletes its answers,
//   - renaming an option keeps its id (answers stay), removing one drops it from the answers,
//   - a type change keeps what still fits (single ↔ multi), a change to or from text drops the answers.
const { newId } = require("../../utils/ids");
const {
    QUESTION_TYPES, OPTION_COLORS, LIMITS, str, isObject, invalid, notFound, conflict,
    withKader, getKader, cleanLabel, normalizeAnswer,
} = require("./kaderModel");

/** An option's colour: one of the palette, "" for none (automatic); anything else is refused. */
function cleanColor(raw) {
    const color = str(raw).trim();
    if (color && !OPTION_COLORS.includes(color)) throw invalid(`Unbekannte Farbe „${color}“.`);
    return color;
}

function cleanOptions(raw, type, previous = []) {
    if (type === "text") return [];
    const list = Array.isArray(raw) ? raw : [];
    if (!list.length) throw invalid("Eine Auswahlfrage braucht mindestens eine Antwort.");
    if (list.length > LIMITS.options) throw invalid(`Höchstens ${LIMITS.options} Antworten je Frage.`);
    const known = new Map(previous.map((o) => [o.id, o]));
    const ids = new Set();
    const labels = new Set();
    return list.map((o) => {
        const label = cleanLabel(isObject(o) ? o.label : o, "Antwort", LIMITS.option);
        const key = label.toLowerCase();
        if (labels.has(key)) throw invalid(`„${label}“ steht doppelt in den Antworten.`);
        labels.add(key);
        let id = isObject(o) && known.has(str(o.id)) ? str(o.id) : "";
        if (!id || ids.has(id)) id = newId(3);
        ids.add(id);
        // renaming or moving an option keeps its colour unless a new one is given
        const before = known.get(id);
        const color = isObject(o) && o.color !== undefined ? cleanColor(o.color) : (before && before.color) || "";
        return color ? { id, label, color } : { id, label };
    });
}

function cleanType(raw) {
    const type = str(raw);
    if (!QUESTION_TYPES.includes(type)) throw invalid("Unbekannte Antwortart.");
    return type;
}

/** Every answer to a question brought in line with it after a change; `keep` = false drops them all. */
function refitAnswers(kader, question, keep) {
    for (const entry of Object.values(kader.players)) {
        const answers = entry.interview.answers;
        if (!(question.id in answers)) continue;
        const next = keep ? normalizeAnswer(question, answers[question.id]) : undefined;
        if (next === undefined) delete answers[question.id];
        else answers[question.id] = next;
    }
}

function getQuestion(kader, questionId) {
    const question = kader.questions.find((q) => q.id === str(questionId));
    if (!question) throw notFound("Frage nicht gefunden.");
    return question;
}

function addQuestion(planner, input) {
    return withKader(planner, input.kaderId, (kader) => {
        if (kader.questions.length >= LIMITS.questions) throw conflict(`Mehr als ${LIMITS.questions} Fragen je Kader sind nicht vorgesehen.`);
        const type = cleanType(input.type);
        const question = {
            id: newId(4),
            text: cleanLabel(input.text, "Frage", LIMITS.question),
            type,
            options: cleanOptions(input.options, type),
            required: input.required === true,
        };
        kader.questions.push(question);
        return { questionId: question.id };
    });
}

/** Changes a question: text, type, options (an option with a known id keeps it), required. */
function updateQuestion(planner, input) {
    return withKader(planner, input.kaderId, (kader) => {
        const question = getQuestion(kader, input.questionId);
        if (input.text !== undefined) question.text = cleanLabel(input.text, "Frage", LIMITS.question);
        if (input.required !== undefined) question.required = input.required === true;
        const oldType = question.type;
        const type = input.type !== undefined ? cleanType(input.type) : oldType;
        if (input.options !== undefined || type !== oldType) {
            const raw = input.options !== undefined ? input.options : question.options;
            question.options = cleanOptions(raw, type, question.options);
        }
        question.type = type;
        const textSwitch = (oldType === "text") !== (type === "text");
        refitAnswers(kader, question, !textSwitch);
    });
}

/** Deletes a question — and every answer to it. */
function deleteQuestion(planner, input) {
    return withKader(planner, input.kaderId, (kader) => {
        const question = getQuestion(kader, input.questionId);
        kader.questions = kader.questions.filter((q) => q.id !== question.id);
        for (const entry of Object.values(kader.players)) delete entry.interview.answers[question.id];
    });
}

/** Puts the questions into the order of `order` (question ids); ids left out keep their place after them. */
function orderQuestions(planner, input) {
    const order = (Array.isArray(input.order) ? input.order : []).map(str);
    return withKader(planner, input.kaderId, (kader) => {
        const byId = new Map(kader.questions.map((q) => [q.id, q]));
        const first = order.filter((id) => byId.has(id)).map((id) => byId.get(id));
        const rest = kader.questions.filter((q) => !order.includes(q.id));
        kader.questions = [...new Set([...first, ...rest])];
    });
}

/** "Fragen aus anderem Kader übernehmen": appends copies of another Kader's questions (new ids, no answers). */
function copyQuestions(planner, input) {
    const from = getKader(planner, str(input.fromKaderId));
    if (str(input.fromKaderId) === str(input.kaderId)) throw invalid("Das ist derselbe Kader.");
    return withKader(planner, input.kaderId, (kader) => {
        if (!from.questions.length) throw conflict("Dieser Kader hat keine Fragen.");
        if (kader.questions.length + from.questions.length > LIMITS.questions) throw conflict(`Mehr als ${LIMITS.questions} Fragen je Kader sind nicht vorgesehen.`);
        for (const q of from.questions) kader.questions.push({ ...q, id: newId(4), options: q.options.map((o) => ({ ...o })) });
        return { copied: from.questions.length };
    });
}

module.exports = { addQuestion, updateQuestion, deleteQuestion, orderQuestions, copyQuestions };
