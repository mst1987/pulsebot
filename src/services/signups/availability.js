// Absences and attendances (availabilityStore): a raider says "I am away from
// … to …" or "I am there from … to … with this character", and the bot signs
// them off from — or up for — the raids of that period, now and whenever a raid
// is created in it later. Every change is told by DM.
//
// The rules, once, for every front end (the panel and /availability in
// Discord, the web's signup page, the orga for another raider):
//   * which raids: own events whose day (server time) lies in the period, not
//     begun, not cancelled, not archived — of the entry's raid category when it
//     has one (an entry made at a category's panel), of the character's game
//     version for an attendance. Raids deselected when entering stay untouched
//     (`skip`), later ones are always included;
//   * an absence signs off — also a raider already signed up (the absence
//     wins); a raid already signed off from is left alone;
//   * an attendance signs up with its character · spec as "Dabei" — never over
//     an existing signup or absence, and never into a raid an absence covers;
//   * each raid is touched once per entry (`applied`): signing up again after
//     the bot signed you off is not undone by the next raid of the period;
//   * every save goes through signupService.submitSignup — deadline, closed
//     signup, raider role and profile rules are the service's. A raider's own
//     entry acts as the raider, one entered by the orga acts as the orga.
// Deleting an entry stops it; the signups it made stay as they are.
const { DateTime } = require("luxon");
const store = require("../../stores/availabilityStore");
const eventStore = require("../../stores/eventStore");
const signupStore = require("../../stores/signupStore");
const profiles = require("../../stores/raiderProfileStore");
const settingsStore = require("../../stores/settingsStore");
const discord = require("../discord/discord");
const linkCheck = require("../discord/linkCheck");
const { submitSignup, signupWindow } = require("./signupService");
const { versionOfEvent } = require("../events/mainVersion");
const { archiveOf } = require("../events/eventArchive");
const { spec: specOf } = require("../../config/gameVersions");
const { TIMEZONE } = require("../../config/timezone");
const { tr, serviceText, specLabel, dateLocale } = require("../../utils/i18n/botText");
const { langOf, eventLang } = require("../discord/botLanguage");
const { buildEmbed } = require("../../utils/discord/reply");
const logger = require("../../logger");
const { shortWhen } = require("../../utils/time");

/** How far ahead an entry may reach. */
const MAX_DAYS = 180;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const str = (v) => String(v === undefined || v === null ? "" : v).trim();

/** "yyyy-MM-dd" of a moment in server time. */
function dayOf(seconds) {
    return DateTime.fromSeconds(Number(seconds) || 0, { zone: TIMEZONE }).toFormat("yyyy-MM-dd");
}

function today(now = Date.now()) {
    return DateTime.fromMillis(Number(now), { zone: TIMEZONE }).toFormat("yyyy-MM-dd");
}

/** Unix seconds of a day's midnight in server time (for Discord's <t:…:D>). */
function dayStart(day) {
    const dt = DateTime.fromISO(str(day), { zone: TIMEZONE });
    return dt.isValid ? Math.floor(dt.toSeconds()) : 0;
}

function daysBetween(from, to) {
    return DateTime.fromISO(to, { zone: TIMEZONE }).diff(DateTime.fromISO(from, { zone: TIMEZONE }), "days").days;
}

/** Whether a raid lies in an entry's period and scope (not whether it can still be changed). */
function covers(entry, event) {
    if (!entry || !event || !event.startTime) return false;
    const day = dayOf(event.startTime);
    if (day < entry.from || day > entry.to) return false;
    if (entry.categoryId && str(event.categoryId) !== entry.categoryId) return false;
    if (entry.kind === "presence" && entry.versionId && versionOfEvent(event) !== entry.versionId) return false;
    return true;
}

/** Whether a raid still takes a change at all: not begun, not cancelled, not archived. */
function openRaid(event, { now = Date.now(), config } = {}) {
    if (!event || event.status === "cancelled") return false;
    if (signupWindow(event, now).started) return false;
    return !archiveOf(event, { config });
}

/**
 * The raids an entry (or the period being entered) covers right now, soonest
 * first: `{ from, to, kind, categoryId?, versionId? }`.
 */
function raidsInRange(scope, { now = Date.now(), config } = {}) {
    const cfg = config || settingsStore.getConfig();
    const cats = Array.isArray(cfg.categoryIds) ? cfg.categoryIds.map(String) : [];
    return eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) })
        .filter((e) => openRaid(e, { now, config: cfg }))
        .filter((e) => !cats.length || cats.includes(str(e.categoryId)))
        .filter((e) => covers(scope, e))
        .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));
}

/**
 * Check what is being entered against the calendar and the profile, and fill
 * in the attendance's game version. Returns `{ value }` or `{ error }` (German,
 * the bot translates through botEnglish).
 */
function checkInput(userId, input = {}, { now = Date.now() } = {}) {
    const value = {
        userId: str(userId),
        kind: input.kind === "presence" ? "presence" : input.kind === "absence" ? "absence" : "",
        from: str(input.from),
        to: str(input.to || input.from),
        categoryId: str(input.categoryId),
        comment: str(input.comment).slice(0, store.COMMENT_MAX),
        character: "", spec: "", versionId: "",
    };
    const problem = store.entryProblem({ ...value, character: "-", spec: "-" });
    if (problem) return { error: problem };
    if (value.to < today(now)) return { error: "Der Zeitraum liegt schon in der Vergangenheit." };
    if (daysBetween(value.from, value.to) > MAX_DAYS) return { error: `Höchstens ${MAX_DAYS} Tage auf einmal.` };
    if (value.kind === "presence") {
        const profile = profiles.getProfile(value.userId);
        const character = (profile.characters || []).find((c) => c.key === str(input.character))
            || (profile.characters || []).find((c) => profiles.nameKey(c.name) === profiles.nameKey(input.character));
        if (!character) return { error: "Dieser Charakter steht nicht in deinem Profil." };
        const spec = (character.specs || []).find((s) => s.key === str(input.spec));
        if (!spec) return { error: "Diese Spec hat der Charakter im Profil nicht." };
        value.character = character.name;
        value.spec = spec.key;
        value.versionId = character.versionId || "";
    }
    return { value };
}

/** Whether an absence of the raider covers this raid (an attendance then stays out of it). */
function absentFor(userId, event) {
    return store.listEntries({ userId }).some((e) => e.kind === "absence" && covers(e, event) && !e.skip.includes(event.id));
}

/**
 * Apply one entry to one raid. Returns `{ eventId, ok, skipped?, error? }`
 * and marks the raid as done for this entry, whatever came out.
 */
async function applyToRaid(entry, event, { now = Date.now(), config } = {}) {
    const result = await applyOutcome(entry, event, { now, config });
    store.markApplied(entry.id, event.id, result, { now });
    return { eventId: event.id, title: event.title || "", startTime: Number(event.startTime) || 0, ...result };
}

async function applyOutcome(entry, event, { now, config }) {
    const previous = signupStore.getSignup(event.id, entry.userId);
    const byOrga = !!entry.createdBy && entry.createdBy !== entry.userId;
    if (entry.kind === "absence") {
        if (previous && previous.status === "absence") return { ok: false, skipped: "already_absent" };
        // the roster and the event message show it: the event's language (its category's)
        const lang = eventLang(event, config);
        const comment = entry.comment || tr(lang, "Away {from}–{to}", { from: shortDay(entry.from, lang), to: shortDay(entry.to, lang) });
        const saved = await submitSignup(event.id, entry.userId, { status: "absence", comment }, { byOrga, now, config });
        return saved.error ? { ok: false, error: saved.error } : { ok: true };
    }
    if (previous) return { ok: false, skipped: previous.status === "absence" ? "absent" : "already_signed" };
    if (absentFor(entry.userId, event)) return { ok: false, skipped: "absent" };
    if (!specOf(entry.spec, event.versionId)) return { ok: false, error: "Klasse passt nicht zu diesem Raid" };
    const saved = await submitSignup(event.id, entry.userId, {
        characters: [{ character: entry.character, spec: entry.spec }],
        status: "signed",
    }, { byOrga, now, config });
    return saved.error ? { ok: false, error: saved.error } : { ok: true };
}

/**
 * Enter an absence or attendance and apply it to the raids of its period at
 * once — `eventIds` are the raids picked from raidsInRange (none given = all),
 * the others are remembered as deselected. The raider gets one DM with what
 * happened.
 * @returns {Promise<{ entry?: object, results?: object[], dm?: boolean, error?: string }>}
 */
async function createEntry(userId, input = {}, { by = "", eventIds, now = Date.now(), config, dm = true } = {}) {
    const checked = checkInput(userId, input, { now });
    if (checked.error) return checked;
    const cfg = config || settingsStore.getConfig();
    const raids = raidsInRange(checked.value, { now, config: cfg });
    const picked = Array.isArray(eventIds) ? new Set(eventIds.map(str)) : null;
    const skip = picked ? raids.filter((e) => !picked.has(e.id)).map((e) => e.id) : [];
    // entries long over go here: nothing else ever needs them
    store.prune(today(now));
    const added = store.addEntry({ ...checked.value, skip, createdBy: str(by) || checked.value.userId }, { now });
    if (added.error) return added;
    const results = [];
    for (const event of raids) {
        if (skip.includes(event.id)) continue;
        results.push(await applyToRaid(added.entry, event, { now, config: cfg }));
    }
    const entry = store.getEntry(added.entry.id) || added.entry;
    const sent = dm ? await sendDm(entry.userId, entryDm(entry, results, langOf(entry.userId, { config: cfg }))) : false;
    return { entry, results, dm: sent };
}

/**
 * A raid was created or moved: apply every entry that covers it and has not
 * touched it yet — absences first, so an attendance never signs up into a
 * raid somebody is away from. One DM per raider and raid. Never throws.
 */
async function applyToEvent(eventId, { now = Date.now(), config } = {}) {
    const out = [];
    try {
        const cfg = config || settingsStore.getConfig();
        const event = eventStore.getEvent(eventId);
        const cats = Array.isArray(cfg.categoryIds) ? cfg.categoryIds.map(String) : [];
        if (!event || !openRaid(event, { now, config: cfg })) return out;
        if (cats.length && !cats.includes(str(event.categoryId))) return out;
        const entries = store.listEntries()
            .filter((e) => covers(e, event) && !e.skip.includes(event.id) && !e.applied[event.id])
            .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "absence" ? -1 : 1));
        for (const entry of entries) {
            const result = await applyToRaid(entry, event, { now, config: cfg });
            out.push({ entry, result });
            if (result.ok) await sendDm(entry.userId, raidDm(entry, event, langOf(entry.userId, { config: cfg })));
        }
    } catch (e) {
        logger.warn(`[availability] ${eventId}: ${(e && e.message) || e}`);
    }
    return out;
}

/** Remove an entry — the raider's own, or anyone's for the orga. Returns `{ entry }` or `{ error, code }`. */
function deleteEntry(id, { userId = "", orga = false } = {}) {
    const entry = store.getEntry(id);
    if (!entry || (!orga && entry.userId !== str(userId))) return { error: "Eintrag nicht gefunden.", code: "not_found" };
    store.removeEntry(entry.id);
    return { entry };
}

/** A raider's entries that are not over yet, earliest first. */
function activeEntries(userId, { now = Date.now() } = {}) {
    const t = today(now);
    return store.listEntries({ userId }).filter((e) => e.to >= t);
}

// --- DMs, in the raider's language (services/discord/botLanguage.js) ---

function shortDay(day, lang = "de") {
    const dt = DateTime.fromISO(str(day), { zone: TIMEZONE });
    return dt.isValid ? dt.setLocale(dateLocale(lang)).toFormat(dateLocale(lang) === "de" ? "d. LLL" : "d LLL") : str(day);
}

/** "<t:…:D> – <t:…:D>" of an entry's period; one day once. */
function periodText(entry) {
    const from = dayStart(entry.from);
    const to = dayStart(entry.to);
    return entry.from === entry.to ? `<t:${from}:D>` : `<t:${from}:D> – <t:${to}:D>`;
}

function specName(key, lang) {
    return specLabel(lang, profiles.specInfo(key), key);
}

function raidLine(r) {
    const event = eventStore.getEvent(r.eventId) || { id: r.eventId, title: r.title, startTime: r.startTime };
    const url = linkCheck.eventLink(event);
    const title = url ? `[${event.title || r.title}](${url})` : `**${event.title || r.title}**`;
    return `${title} · ${shortWhen(event.startTime || r.startTime)}`;
}

const SKIP_TEXT = {
    already_absent: "already signed off",
    already_signed: "already signed up",
    absent: "you are away",
};

/** The DM after entering: the period, what was done per raid, and that later raids follow. */
function entryDm(entry, results, lang = "de") {
    const absence = entry.kind === "absence";
    const lines = [periodText(entry)];
    if (absence && entry.comment) lines.push(tr(lang, "Reason: {reason}", { reason: entry.comment }));
    if (!absence) lines.push(tr(lang, "Character: **{character}** · {spec}", { character: entry.character, spec: specName(entry.spec, lang) }));
    const done = results.filter((r) => r.ok);
    const skipped = results.filter((r) => !r.ok && r.skipped);
    const failed = results.filter((r) => !r.ok && !r.skipped);
    lines.push("");
    if (done.length) {
        lines.push(absence ? tr(lang, "**Signed off from:**") : tr(lang, "**Signed up for:**"));
        for (const r of done) lines.push(`• ${raidLine(r)}`);
    } else {
        lines.push(absence ? tr(lang, "No raid to sign off from yet.") : tr(lang, "No raid to sign up for yet."));
    }
    for (const r of skipped) lines.push(`⏭️ ${raidLine(r)} – ${tr(lang, SKIP_TEXT[r.skipped] || "skipped")}`);
    for (const r of failed) lines.push(`⛔ ${raidLine(r)} – ${serviceText(lang, r.error)}`);
    lines.push("");
    lines.push(absence
        ? tr(lang, "Raids created later in this period sign you off automatically – you get a DM each time.")
        : tr(lang, "Raids created later in this period sign you up automatically – you get a DM each time."));
    return {
        title: absence ? tr(lang, "Absence saved") : tr(lang, "Attendance saved"),
        description: lines.join("\n"),
        footer: entry.createdBy !== entry.userId ? tr(lang, "Entered for you by the raid lead") : "",
    };
}

/** The DM when a raid of the period was signed up / off for the raider later on. */
function raidDm(entry, event, lang = "de") {
    const absence = entry.kind === "absence";
    const lines = [raidLine({ eventId: event.id, title: event.title, startTime: event.startTime })];
    const period = periodText(entry);
    lines.push(absence
        ? (entry.comment
            ? tr(lang, "You are away {period} ({reason}), so you were signed off.", { period, reason: entry.comment })
            : tr(lang, "You are away {period}, so you were signed off.", { period }))
        : tr(lang, "You are available {period}, so you were signed up with **{character}** · {spec}.", { period, character: entry.character, spec: specName(entry.spec, lang) }));
    lines.push(tr(lang, "Changed your mind? Sign up or off again in the raid's message."));
    return {
        title: absence ? tr(lang, "Signed off automatically") : tr(lang, "Signed up automatically"),
        description: lines.join("\n"),
        footer: "",
    };
}

/** Send one of the DMs above as an embed. Never throws; returns whether it went out. */
async function sendDm(userId, { title, description, footer }) {
    try {
        const embed = buildEmbed({ title, description, footer });
        const sent = await discord.sendDirectMessage(userId, { embeds: [embed] });
        return !!(sent && sent.ok);
    } catch (e) {
        logger.warn(`[availability] DM: ${(e && e.message) || e}`);
        return false;
    }
}

module.exports = {
    MAX_DAYS, DAY,
    raidsInRange, checkInput, createEntry, applyToEvent, deleteEntry, activeEntries, covers, today, dayOf, dayStart, shortDay,
    entrySummary: entryDm,
    // only for the tests: not part of the module's API
    _internal: { raidDm, applyToRaid, absentFor },
};
