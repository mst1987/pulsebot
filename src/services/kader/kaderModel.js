// The Kaderplaner's own data (docs/kaderplaner.md): the shape of one server's
// planner, its repair on read, the character data of the accounts and the
// Kader themselves. Pure: every mutator takes the planner and returns a new one
// (or `{ planner, ...extra }`), or throws an AppError the router answers with
// its status. The players of a Kader, its questions and its example setups have
// their own modules (kaderPlayers.js, kaderQuestions.js, kaderSetups.js).
//
//   { v: 2,
//     accounts:    [{ userId, displayName, addedAt }]          known by hand (no profile)
//     assignments: { [userId]: { characters: [...], activeCharacterId } }   per server, not per Kader
//     kaders:      [{ id, name, leads: [userId], createdAt, createdBy,
//                     attendanceCategories: [categoryId],   the raid categories attendance counts in
//                     questions: [{ id, text, type, options: [{ id, label }], required }],
//                     players:   { [userId]: entry },
//                     setups:    [{ id, name, size: 10|20, groups: [[{ userId, spec }|null x5] x4] }] }] }
//
// A player entry: { state, since, by, addedAt, addedBy, history, wishes, interview,
// votes, comments, decision } — see kaderPlayers.js. A state stays until somebody
// changes it; nothing moves by itself.
//
// A character: { id, name, nameStyle, className, specs: [{ spec, main, gear }],
// canTank, canHeal, onlineKey? } — nameStyle "forever" (Vorname Nachname) or
// "nick" (one free nickname), keys in the code's own vocabulary ("Warrior",
// "Warrior-Protection"). The planner's character data wins inside the planner
// and is never written back to a raider profile.
const { AppError } = require("../../web/http/apiResult");
const { isProfane, validateCharacterName } = require("../../utils/signup/characterNames");
const { newId } = require("../../utils/ids");
const { migrateLegacyPlanner, charOfAssignments } = require("./kaderMigration");

const FORMAT = 2;
const ROLES = ["tank", "healer", "melee", "ranged"];
const STATES = ["pool", "selected", "provisional", "roster", "bench", "tentative"];
/** The states whose players an example setup may hold. */
const SETUP_STATES = ["roster", "provisional", "bench", "tentative"];
const QUESTION_TYPES = ["single", "multi", "text"];
/**
 * The colours an answer option may carry (tokens --opt-<name> of the web
 * client, tokens.css), in the order "automatic" hands them out; an option
 * without one gets the next free colour by position (lib/kader/colors.ts).
 */
const OPTION_COLORS = ["blue", "amber", "rose", "teal", "violet", "lime", "orange", "slate"];
const VOTES = ["yes", "unsure", "no"];
const NAME_STYLES = ["forever", "nick"];
const GEAR_LEVELS = ["none", "usable", "ready"];
const SETUP_SIZES = [10, 20];
const GROUP_COUNT = 4;
const GROUP_SIZE = 5;
// A nickname: letters (umlauts too), digits, space, hyphen, apostrophe.
const NICK = /^[\p{L}\p{N}' -]+$/u;
const NICK_MIN = 2;
const NICK_MAX = 24;
const LIMITS = {
    accounts: 500, characters: 8, name: 40, kaders: 30, leads: 10, players: 500,
    questions: 30, question: 200, options: 20, option: 60, answer: 1000, note: 2000,
    comment: 1000, comments: 200, history: 50, wishes: 6, variants: 6, attendanceCategories: 20,
};
// An id typed by hand must look like a real Discord user id; one from the member list is taken as it is.
const DISCORD_ID = /^\d{17,20}$/;

const clone = (v) => JSON.parse(JSON.stringify(v));
const str = (v) => (v === null || v === undefined ? "" : String(v));
const invalid = (message) => new AppError("invalid", 400, message);
const notFound = (message) => new AppError("not_found", 404, message);
const conflict = (message) => new AppError("conflict", 409, message);
const forbidden = (message) => new AppError("forbidden", 403, message);
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function emptyPlanner() {
    return { v: FORMAT, accounts: [], assignments: {}, kaders: [] };
}

/** Four groups of five empty slots — a 10er shows the first two of them. */
const emptyGroups = () => Array.from({ length: GROUP_COUNT }, () => Array(GROUP_SIZE).fill(null));

// ------------------------------------------------------------- normalise

/** The stored style, else what the name looks like: two parts are a Forever name, anything else a nickname. */
function nameStyleOf(c) {
    if (NAME_STYLES.includes(c.nameStyle)) return c.nameStyle;
    return str(c.name).trim().split(/\s+/).length === 2 ? "forever" : "nick";
}

function normalizeCharacter(c) {
    if (!isObject(c) || !c.id || !c.name) return null;
    const specs = (Array.isArray(c.specs) ? c.specs : [])
        .filter((s) => s && typeof s.spec === "string" && s.spec)
        .map((s) => ({ spec: s.spec, main: s.main === true, gear: GEAR_LEVELS.includes(s.gear) ? s.gear : "none" }));
    return {
        id: str(c.id),
        name: str(c.name),
        nameStyle: nameStyleOf(c),
        className: str(c.className),
        specs,
        canTank: c.canTank === true,
        canHeal: c.canHeal === true,
        ...(c.onlineKey ? { onlineKey: str(c.onlineKey) } : {}),
    };
}

function normalizeOption(o) {
    if (!isObject(o) || !o.id) return null;
    const label = str(o.label).trim().slice(0, LIMITS.option);
    if (!label) return null;
    // a colour of the palette, else none (the page picks one by position)
    return OPTION_COLORS.includes(o.color) ? { id: str(o.id), label, color: o.color } : { id: str(o.id), label };
}

function normalizeQuestion(q) {
    if (!isObject(q) || !q.id) return null;
    const type = QUESTION_TYPES.includes(q.type) ? q.type : "text";
    const seen = new Set();
    const options = type === "text" ? [] : (Array.isArray(q.options) ? q.options : [])
        .map(normalizeOption)
        .filter((o) => o && !seen.has(o.id) && seen.add(o.id))
        .slice(0, LIMITS.options);
    return { id: str(q.id), text: str(q.text).trim().slice(0, LIMITS.question) || "?", type, options, required: q.required === true };
}

/** An answer as its question wants it, or undefined when there is none (unknown option ids are dropped). */
function normalizeAnswer(question, value) {
    if (question.type === "text") {
        const text = str(value).trim().slice(0, LIMITS.answer);
        return text || undefined;
    }
    const ids = new Set(question.options.map((o) => o.id));
    if (question.type === "single") {
        const id = Array.isArray(value) ? str(value[0]) : str(value);
        return ids.has(id) ? id : undefined;
    }
    const list = (Array.isArray(value) ? value : [value]).map(str);
    const picked = question.options.map((o) => o.id).filter((id) => list.includes(id));
    return picked.length ? picked : undefined;
}

function normalizeAnswers(raw, questions) {
    const out = {};
    if (!isObject(raw)) return out;
    for (const q of questions) {
        const a = normalizeAnswer(q, raw[q.id]);
        if (a !== undefined) out[q.id] = a;
    }
    return out;
}

function normalizeWish(w) {
    if (!isObject(w)) return null;
    const className = str(w.className);
    const spec = str(w.spec);
    return className && spec ? { className, spec } : null;
}

function normalizeWishes(raw) {
    const seen = new Set();
    return (Array.isArray(raw) ? raw : [])
        .map(normalizeWish)
        .filter((w) => w && !seen.has(w.spec) && seen.add(w.spec))
        .slice(0, LIMITS.wishes);
}

function normalizeInterview(raw, questions) {
    const i = isObject(raw) ? raw : {};
    return {
        lead: str(i.lead),
        answers: normalizeAnswers(i.answers, questions),
        note: str(i.note).slice(0, LIMITS.note),
        startedAt: str(i.startedAt),
        updatedAt: str(i.updatedAt),
        updatedBy: str(i.updatedBy),
        completedAt: str(i.completedAt),
        completedBy: str(i.completedBy),
    };
}

function normalizeHistory(raw) {
    return (Array.isArray(raw) ? raw : [])
        .filter((h) => isObject(h) && h.type)
        .map((h) => {
            const out = { at: str(h.at), by: str(h.by), type: str(h.type) };
            for (const k of ["from", "to", "vote", "className", "spec"]) if (h[k] !== undefined && h[k] !== null) out[k] = str(h[k]);
            return out;
        })
        .slice(-LIMITS.history);
}

function normalizeEntry(raw, questions) {
    const e = isObject(raw) ? raw : {};
    const votes = {};
    if (isObject(e.votes)) for (const [uid, v] of Object.entries(e.votes)) if (VOTES.includes(v)) votes[uid] = v;
    const seen = new Set();
    const comments = (Array.isArray(e.comments) ? e.comments : [])
        .filter((c) => isObject(c) && c.id && str(c.text).trim() && !seen.has(c.id) && seen.add(c.id))
        .map((c) => ({ id: str(c.id), by: str(c.by), at: str(c.at), text: str(c.text).slice(0, LIMITS.comment) }))
        .slice(-LIMITS.comments);
    return {
        name: str(e.name).slice(0, LIMITS.name),
        state: STATES.includes(e.state) ? e.state : "pool",
        since: str(e.since),
        by: str(e.by),
        addedAt: str(e.addedAt),
        addedBy: str(e.addedBy),
        history: normalizeHistory(e.history),
        wishes: normalizeWishes(e.wishes),
        interview: normalizeInterview(e.interview, questions),
        votes,
        comments,
        decision: normalizeWish(e.decision),
    };
}

/** A slot of an example setup: a player who may stand in a setup, each at most once. */
function normalizeSlot(raw, players, used) {
    if (!isObject(raw)) return null;
    const userId = str(raw.userId);
    const entry = players[userId];
    if (!entry || !SETUP_STATES.includes(entry.state) || used.has(userId)) return null;
    used.add(userId);
    return { userId, spec: str(raw.spec) };
}

function normalizeGroups(raw, players) {
    const used = new Set();
    return Array.from({ length: GROUP_COUNT }, (_, gi) => Array.from({ length: GROUP_SIZE }, (_, si) => {
        const g = Array.isArray(raw) && Array.isArray(raw[gi]) ? raw[gi] : [];
        return normalizeSlot(g[si], players, used);
    }));
}

function normalizeVariant(v, players) {
    if (!isObject(v) || !v.id) return null;
    return {
        id: str(v.id),
        name: str(v.name).trim().slice(0, LIMITS.name) || "Variante",
        size: SETUP_SIZES.includes(Number(v.size)) ? Number(v.size) : 20,
        groups: normalizeGroups(v.groups, players),
    };
}

/** Category ids as strings, each once, at most LIMITS.attendanceCategories. */
function categoryIds(raw) {
    return [...new Set((Array.isArray(raw) ? raw : []).map((id) => str(id).trim()).filter(Boolean))].slice(0, LIMITS.attendanceCategories);
}

function normalizeKader(k) {
    if (!isObject(k) || !k.id) return null;
    const qSeen = new Set();
    const questions = (Array.isArray(k.questions) ? k.questions : [])
        .map(normalizeQuestion)
        .filter((q) => q && !qSeen.has(q.id) && qSeen.add(q.id))
        .slice(0, LIMITS.questions);
    const players = {};
    if (isObject(k.players)) {
        for (const [userId, raw] of Object.entries(k.players)) {
            if (userId) players[userId] = normalizeEntry(raw, questions);
        }
    }
    const vSeen = new Set();
    const setups = (Array.isArray(k.setups) ? k.setups : [])
        .map((v) => normalizeVariant(v, players))
        .filter((v) => v && !vSeen.has(v.id) && vSeen.add(v.id))
        .slice(0, LIMITS.variants);
    return {
        id: str(k.id),
        name: str(k.name).trim().slice(0, LIMITS.name) || "Kader",
        leads: [...new Set((Array.isArray(k.leads) ? k.leads : []).map(str).filter(Boolean))].slice(0, LIMITS.leads),
        createdAt: str(k.createdAt),
        createdBy: str(k.createdBy),
        // A Kader stored before the setting existed counts in no category: the
        // page says "—" and asks for a pick instead of guessing (docs/kaderplaner.md).
        attendanceCategories: categoryIds(k.attendanceCategories),
        questions,
        players,
        setups,
    };
}

/**
 * Repairs whatever was read from disk into a valid planner (never throws). An
 * old planner (#566: rosters with sizes, members and bench) is taken over the
 * way settingsMigration.js does it at start — here with the planner's own
 * character data only, as a safety net for a file the start did not migrate.
 */
function normalizePlanner(raw) {
    const out = emptyPlanner();
    if (!isObject(raw)) return out;
    const src = !Array.isArray(raw.kaders) && Array.isArray(raw.rosters)
        ? migrateLegacyPlanner(raw, { charOf: charOfAssignments(raw) })
        : raw;
    if (Array.isArray(src.accounts)) {
        const seen = new Set();
        out.accounts = src.accounts
            .filter((a) => a && typeof a.userId === "string" && a.userId && !seen.has(a.userId) && seen.add(a.userId))
            .map((a) => ({ userId: a.userId, displayName: str(a.displayName || a.userId).slice(0, LIMITS.name), addedAt: str(a.addedAt) }));
    }
    if (isObject(src.assignments)) {
        for (const [userId, a] of Object.entries(src.assignments)) {
            if (!a || !Array.isArray(a.characters)) continue;
            const characters = a.characters.map(normalizeCharacter).filter(Boolean);
            out.assignments[userId] = {
                characters,
                activeCharacterId: characters.some((c) => c.id === a.activeCharacterId) ? a.activeCharacterId : (characters[0] ? characters[0].id : null),
            };
        }
    }
    const seen = new Set();
    out.kaders = (Array.isArray(src.kaders) ? src.kaders : [])
        .map(normalizeKader)
        .filter((k) => k && !seen.has(k.id) && seen.add(k.id))
        .slice(0, LIMITS.kaders);
    return out;
}

// --------------------------------------------------------------- helpers

function cleanLabel(name, what, max = LIMITS.name) {
    const text = str(name).trim().replace(/\s+/g, " ");
    if (!text || text.length > max) throw invalid(`${what} fehlt oder ist zu lang (höchstens ${max} Zeichen).`);
    return text;
}

function getKader(planner, kaderId) {
    const kader = planner.kaders.find((k) => k.id === kaderId);
    if (!kader) throw notFound("Kader nicht gefunden.");
    return kader;
}

/** A mutation on one Kader: the planner copied, the Kader found, `fn(kader, next)` changes it in place. */
function withKader(planner, kaderId, fn) {
    const next = clone(planner);
    const kader = getKader(next, str(kaderId));
    const extra = fn(kader, next);
    return extra && typeof extra === "object" ? { planner: next, ...extra } : next;
}

/** Whether a user id may be taken: from the member list as it is, typed by hand only when it looks like a Discord id. */
function checkUserId(raw, ctx) {
    const userId = str(raw).trim();
    if (!userId) throw invalid("Discord-ID fehlt.");
    if (!(ctx.memberIds && ctx.memberIds.has(userId)) && !(ctx.knownIds && ctx.knownIds.has(userId)) && !DISCORD_ID.test(userId)) {
        throw invalid("Das ist keine Discord-ID (17 bis 20 Ziffern).");
    }
    return userId;
}

/** Whether the planner may keep character data for an account: known to the bot or to the planner. */
function isKnown(planner, ctx, userId) {
    return (ctx.knownIds && ctx.knownIds.has(userId))
        || planner.accounts.some((a) => a.userId === userId)
        || planner.kaders.some((k) => !!k.players[userId]);
}

// ------------------------------------------------------ class & spec keys

function classOf(ctx, key) {
    const c = ctx.classes.get(str(key));
    if (!c) throw invalid(`Unbekannte Klasse: ${key || "keine"}.`);
    return c;
}

/** A class + spec pair of the rule set (a wish, a decision, a setup slot). */
function cleanClassSpec(input, ctx) {
    const cls = classOf(ctx, input && input.className);
    const spec = str(input && input.spec);
    if (!cls.specs.some((s) => s.key === spec)) throw invalid(`Unbekannter Spec: ${spec || "keiner"}.`);
    return { className: cls.key, spec };
}

// ---------------------------------------------------------- characters

/** A Forever name is "Vorname Nachname", each 2 to 12 letters (utils/signup/characterNames.js); a nickname is freer. */
function cleanName(raw, style = "forever") {
    const text = str(raw).trim().replace(/\s+/g, " ");
    if (style === "nick") {
        const length = [...text].length;
        if (length < NICK_MIN || length > NICK_MAX) throw invalid(`Der Nickname braucht ${NICK_MIN} bis ${NICK_MAX} Zeichen.`);
        if (!NICK.test(text)) throw invalid("Der Nickname darf nur Buchstaben, Ziffern, Leerzeichen, Bindestrich und Apostroph haben.");
        if (isProfane(text)) throw invalid("Dieser Name ist nicht erlaubt – bitte einen anderen wählen.");
        return text;
    }
    if (text.split(" ").length !== 2) throw invalid("Der Name besteht aus Vorname und Nachname, je höchstens 12 Buchstaben.");
    const checked = validateCharacterName(text, { lastName: true });
    if (checked.error) throw invalid(checked.error);
    return checked.name;
}

function cleanCharacter(input, ctx) {
    const nameStyle = input.nameStyle === "nick" ? "nick" : "forever";
    const name = cleanName(input.name, nameStyle);
    const cls = classOf(ctx, input.className);
    const seen = new Set();
    let specs = (Array.isArray(input.specs) ? input.specs : []).map((s) => ({
        spec: str(s && s.spec),
        main: !!s && s.main === true,
        gear: s && GEAR_LEVELS.includes(s.gear) ? s.gear : "none",
    })).filter((s) => {
        if (!s.spec || seen.has(s.spec)) return false;
        seen.add(s.spec);
        return true;
    });
    const unknown = specs.find((s) => !cls.specs.some((cs) => cs.key === s.spec));
    if (unknown) throw invalid(`Unbekannter Spec: ${unknown.spec}.`);
    const mainIndex = Math.max(0, specs.findIndex((s) => s.main));
    specs = specs.map((s, i) => ({ ...s, main: i === mainIndex }));
    return {
        id: str(input.id || newId()).slice(0, 40),
        name,
        nameStyle,
        className: cls.key,
        specs,
        canTank: input.canTank === true && !!cls.canTank,
        canHeal: input.canHeal === true && !!cls.canHeal,
        ...(input.onlineKey ? { onlineKey: str(input.onlineKey).slice(0, 80) } : {}),
    };
}

/** Replaces the planner's characters of one account; the profile is never touched. */
function setAssignment(planner, userId, input, ctx) {
    if (!isKnown(planner, ctx, userId)) throw notFound("Account unbekannt.");
    const list = Array.isArray(input.characters) ? input.characters : [];
    if (list.length > LIMITS.characters) throw invalid(`Höchstens ${LIMITS.characters} Charaktere je Account.`);
    const characters = list.map((c) => cleanCharacter(c || {}, ctx));
    const ids = new Set(characters.map((c) => c.id));
    if (ids.size !== characters.length) throw invalid("Doppelte Charakter-ID.");
    const next = clone(planner);
    next.assignments[userId] = {
        characters,
        activeCharacterId: ids.has(input.activeCharacterId) ? input.activeCharacterId : (characters[0] ? characters[0].id : null),
    };
    return next;
}

/** Drops the planner's characters of an account: the profile shows again. */
function resetAssignment(planner, userId) {
    if (!planner.assignments[userId]) throw notFound("Für diesen Account gibt es keine eigene Zuweisung.");
    const next = clone(planner);
    delete next.assignments[userId];
    return next;
}

// ------------------------------------------------------------ accounts

/**
 * Makes an account known to the planner by hand (no profile, maybe not on the
 * server): a Discord id and a display name, optionally a first character.
 * Knowing it twice is no error — the name is refreshed.
 */
function addAccount(planner, input, ctx) {
    const userId = checkUserId(input.userId, ctx);
    const displayName = cleanLabel(input.displayName, "Name");
    const next = clone(planner);
    const known = next.accounts.find((a) => a.userId === userId);
    if (known) known.displayName = displayName;
    else {
        if (next.accounts.length >= LIMITS.accounts) throw conflict(`Mehr als ${LIMITS.accounts} Accounts sind nicht vorgesehen.`);
        next.accounts.push({ userId, displayName, addedAt: ctx.now });
    }
    const c = input.character;
    if (c && (c.firstName || c.lastName || c.nickname || c.className)) {
        const nick = c.nameStyle === "nick";
        const name = nick ? c.nickname : `${c.firstName || ""} ${c.lastName || ""}`;
        const character = cleanCharacter({ name, nameStyle: nick ? "nick" : "forever", className: c.className, specs: [] }, ctx);
        next.assignments[userId] = { characters: [character], activeCharacterId: character.id };
    }
    return next;
}

/** Forgets an account added by hand: its character data and its place in every Kader go with it. */
function removeAccount(planner, userId) {
    if (!planner.accounts.some((a) => a.userId === userId)) throw notFound("Nur selbst hinzugefügte Accounts lassen sich entfernen.");
    const next = clone(planner);
    next.accounts = next.accounts.filter((a) => a.userId !== userId);
    delete next.assignments[userId];
    for (const k of next.kaders) delete k.players[userId];
    return normalizePlanner(next);
}

// --------------------------------------------------------------- Kader

function createKader(planner, input, ctx) {
    if (planner.kaders.length >= LIMITS.kaders) throw conflict(`Mehr als ${LIMITS.kaders} Kader sind nicht vorgesehen.`);
    const kader = {
        id: newId(),
        name: cleanLabel(input.name, "Name"),
        leads: ctx.actor ? [ctx.actor] : [],
        createdAt: ctx.now,
        createdBy: ctx.actor || "",
        attendanceCategories: [],
        questions: [],
        players: {},
        setups: [{ id: newId(), name: "Variante A", size: 20, groups: emptyGroups() }],
    };
    const next = clone(planner);
    next.kaders.push(kader);
    return { planner: next, kaderId: kader.id };
}

/**
 * Name, leads and the raid categories attendance counts in. A category id the
 * server does not know as a raid category (`ctx.raidCategoryIds`, see
 * kaderSource.listRaidCategories) is left out without an error; an empty list
 * is a valid pick ("no category yet").
 */
function updateKader(planner, input, ctx) {
    return withKader(planner, input.kaderId, (kader) => {
        if (input.name !== undefined) kader.name = cleanLabel(input.name, "Name");
        if (input.leads !== undefined) {
            const leads = [...new Set((Array.isArray(input.leads) ? input.leads : []).map((id) => checkUserId(id, ctx)))];
            if (!leads.length) throw invalid("Ein Kader braucht mindestens eine Leitung.");
            if (leads.length > LIMITS.leads) throw invalid(`Höchstens ${LIMITS.leads} Personen in der Leitung.`);
            kader.leads = leads;
        }
        if (input.attendanceCategories !== undefined) {
            if (!Array.isArray(input.attendanceCategories)) throw invalid("Die Raid-Kategorien kommen als Liste.");
            const known = ctx.raidCategoryIds instanceof Set ? ctx.raidCategoryIds : new Set();
            kader.attendanceCategories = categoryIds(input.attendanceCategories.filter((id) => known.has(str(id).trim())));
        }
    });
}

function deleteKader(planner, kaderId) {
    getKader(planner, str(kaderId));
    const next = clone(planner);
    next.kaders = next.kaders.filter((k) => k.id !== kaderId);
    return next;
}

module.exports = {
    FORMAT, ROLES, STATES, SETUP_STATES, QUESTION_TYPES, OPTION_COLORS, VOTES, NAME_STYLES, GEAR_LEVELS, SETUP_SIZES,
    GROUP_COUNT, GROUP_SIZE, LIMITS,
    clone, str, isObject, invalid, notFound, conflict, forbidden,
    emptyPlanner, emptyGroups, normalizePlanner, normalizeQuestion, normalizeAnswer, normalizeKader,
    cleanLabel, getKader, withKader, checkUserId, isKnown, classOf, cleanClassSpec,
    cleanCharacter, setAssignment, resetAssignment, addAccount, removeAccount,
    createKader, updateKader, deleteKader,
};
