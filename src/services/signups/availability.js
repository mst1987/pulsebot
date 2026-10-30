// Absences and attendances (availabilityStore): a raider says "I am away from
// … to …" or "I am there from … to … with this character", and the bot signs
// them off from — or up for — the raids of that period, now and whenever a raid
// is created in it later. Every change is told by DM.
//
// The rules, once, for every front end (the panel and /availability in
// Discord, the web's signup page, the orga for another raider):
//   * which raids: own events whose day (server time) lies in the period, not
//     begun, not cancelled, not archived — of the entry's scope (`scope: [{
//     guildId, categoryIds }]` - a raid of another server is never covered;
//     availabilityScope.js reads older entries too), of a game version one of
//     the attendance's characters plays. Raids deselected when entering stay
//     untouched (`skip`), later ones are always included;
//   * an attendance signs up with its characters of the raid's version
//     (versionOfEvent), in their order, at most as many as the raid takes
//     (maxCharactersFor - the rest is left out);
//   * an entry can be changed (changeEntry): the raids it already touched stay
//     as they are (`applied`), newly covered ones are applied at once;
//   * an absence signs off — also a raider already signed up (the absence
//     wins); a raid already signed off from is left alone;
//   * an attendance signs up as "Dabei" — never over
//     an existing signup or absence, and never into a raid an absence covers;
//   * each raid is touched once per entry (`applied`): signing up again after
//     the bot signed you off is not undone by the next raid of the period;
//   * every save goes through signupService.submitSignup — deadline, closed
//     signup, raider role and profile rules are the service's. A raider's own
//     entry acts as the raider, one entered by the orga acts as the orga.
// Deleting an entry stops it; the signups it made stay as they are.
const { DateTime } = require("luxon");
const store = require("../../stores/events/availabilityStore");
const eventStore = require("../../stores/events/eventStore");
const signupStore = require("../../stores/events/signupStore");
const profiles = require("../../stores/roster/raiderProfileStore");
const settingsStore = require("../../stores/settings/settingsStore");
const discord = require("../discord/discord");
const linkCheck = require("../discord/linkCheck");
const { submitSignup, signupWindow, checkRaiderRole, maxCharactersFor } = require("./signupService");
const { covers: coversEntry, charactersFor, charactersOf, scopeOf } = require("./availabilityScope");
const { categoryContext, displayServerOf } = require("../categories/categoryGuild");
const { eventGuildIds } = require("../discord/roles/guildRoles");
const { firstServerId } = require("../discord/servers/serverOf");
const { membershipByServer, isOpenRaid, serverOf } = require("./pugMembership");
const { versionOfEvent, mainVersionFor, isVersionVisible } = require("../versions/mainVersion");
const { archiveOf } = require("../events/eventArchive");
const { spec: specOf, rulesFor, LEGACY_VERSION } = require("../../config/gameVersions");
const { TIMEZONE } = require("../../config/timezone");
const { tr, serviceText, specLabel, dateLocale } = require("../../utils/i18n/botText");
const { langOf, eventLang } = require("../discord/botLanguage");
const { buildEmbed } = require("../../utils/discord/reply");
const logger = require("../../logger");
const { shortWhen } = require("../../utils/time");

/** How far ahead an entry may reach. */
const MAX_DAYS = 180;
/** How long an absence entry is kept after its last day (rosterAttendance reads it as "Urlaub"). */
const KEEP_DAYS = 120;
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
function covers(entry, event, { config } = {}) {
    return coversEntry(entry, event, { config });
}

/** Whether a raid still takes a change at all: not begun, not cancelled, not archived. */
function openRaid(event, { now = Date.now(), config } = {}) {
    if (!event || event.status === "cancelled") return false;
    if (signupWindow(event, now).started) return false;
    return !archiveOf(event, { config });
}

/**
 * The raids an entry (or the period being entered) covers right now, soonest
 * first: `{ from, to, kind, scope?, categoryId?, characters? }`.
 */
function raidsInRange(scope, { now = Date.now(), config } = {}) {
    const cfg = config || settingsStore.getConfig();
    const cats = Array.isArray(cfg.categoryIds) ? cfg.categoryIds.map(String) : [];
    return eventStore.listEvents("", { sinceSeconds: Math.floor(now / 1000) })
        .filter((e) => openRaid(e, { now, config: cfg }))
        .filter((e) => !cats.length || cats.includes(str(e.categoryId)))
        .filter((e) => covers(scope, e, { config: cfg }))
        .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));
}

/**
 * Why a character cannot stand for an attendance entry: it belongs to another
 * version than the category plays, or to a version hidden in the settings
 * (#741/#563) - the entry would cover no raid. "" when it fits. The sentence is
 * the signup's (botEnglish knows it).
 */
function presenceVersionProblem(character, categoryId, { config } = {}) {
    const cfg = config || settingsStore.getConfig();
    const own = character.versionId || LEGACY_VERSION;
    const wanted = categoryId ? mainVersionFor({ categoryId, config: cfg }) : (isVersionVisible(own, cfg) ? own : mainVersionFor({ config: cfg }));
    if (own === wanted) return "";
    const label = (id) => (rulesFor(id) && rulesFor(id).label) || id;
    return `${character.name} gehört zu ${label(own)} – lege einen ${label(wanted)}-Charakter im Profil an.`;
}

/**
 * Check what is being entered against the calendar and the profile, and fill
 * in the attendance's game version. Returns `{ value }` or `{ error }` (German,
 * the bot translates through botEnglish).
 */
function checkInput(userId, input = {}, { now = Date.now(), config } = {}) {
    const cfg = config || settingsStore.getConfig();
    const value = {
        userId: str(userId),
        kind: input.kind === "presence" ? "presence" : input.kind === "absence" ? "absence" : "",
        from: str(input.from),
        to: str(input.to || input.from),
        categoryId: "",
        scope: [],
        comment: str(input.comment).slice(0, store.COMMENT_MAX),
        characters: [],
    };
    const problem = store.entryProblem({ ...value, character: "-", spec: "-" });
    if (problem) return { error: problem };
    if (value.to < today(now)) return { error: "Der Zeitraum liegt schon in der Vergangenheit." };
    if (daysBetween(value.from, value.to) > MAX_DAYS) return { error: `Höchstens ${MAX_DAYS} Tage auf einmal.` };
    const scope = scopeInput(input, cfg);
    if (scope.error) return scope;
    Object.assign(value, scope.value);
    if (value.kind === "presence") {
        const chars = charactersInput(value, input, cfg);
        if (chars.error) return chars;
        value.characters = chars.value;
    }
    return { value };
}

const NO_SCOPE = "Bitte mindestens einen Server oder eine Kategorie wählen.";

/**
 * Where an entry counts: `scope: [{ guildId, categoryIds }]` (empty categoryIds =
 * every category of that server). Every server must be one of the list, every
 * category one of its server (categoryGuild.displayServerOf - asked only when a
 * category is named). An older caller's bare `categoryId` stays as it was: that
 * category, wherever it is (the route checks that it exists).
 */
function scopeInput(input, cfg) {
    const parts = Array.isArray(input.scope) ? input.scope.filter(Boolean) : [];
    const legacy = str(input.categoryId);
    if (!parts.length) return legacy ? { value: { categoryId: legacy, scope: [] } } : { error: NO_SCOPE };
    const servers = eventGuildIds(cfg);
    let ctx = null;
    const merged = new Map();
    for (const part of parts) {
        const guildId = str(part.guildId);
        if (!guildId || !servers.includes(guildId)) return { error: "Diesen Server gibt es hier nicht." };
        const cats = [...new Set((Array.isArray(part.categoryIds) ? part.categoryIds : []).map(str).filter(Boolean))];
        if (cats.length) ctx = ctx || categoryContext(cfg);
        if (cats.some((c) => displayServerOf(c, ctx) !== guildId)) return { error: "Die Kategorie gehört nicht zu diesem Server." };
        // the same server twice: one part, "every category" wins
        const before = merged.get(guildId);
        merged.set(guildId, before === undefined ? cats : (!before.length || !cats.length ? [] : [...new Set([...before, ...cats])]));
    }
    return { value: { categoryId: "", scope: [...merged].map(([guildId, categoryIds]) => ({ guildId, categoryIds })) } };
}

/**
 * An attendance's characters `[{ character, spec }]` (an older caller's single
 * `character`/`spec` as one): each from the profile, of a shown version, with a
 * spec it has there. Limited to categories only, each must play the version of
 * one of them - else it would sign up nowhere.
 */
function charactersInput(value, input, cfg) {
    const asked = Array.isArray(input.characters) && input.characters.length
        ? input.characters.filter(Boolean)
        : [{ character: input.character, spec: input.spec }];
    if (asked.length > store.MAX_CHARACTERS) return { error: `Höchstens ${store.MAX_CHARACTERS} Charaktere.` };
    const profile = profiles.getProfile(value.userId);
    const own = profile.characters || [];
    const cats = value.categoryId ? [value.categoryId]
        : value.scope.every((s) => s.categoryIds.length) ? value.scope.flatMap((s) => s.categoryIds) : [];
    const out = [];
    for (const want of asked) {
        if (!str(want.character) || !str(want.spec)) return { error: "Für eine Anwesenheit bitte Charakter und Spec wählen." };
        const character = own.find((c) => c.key === str(want.character))
            || own.find((c) => profiles.nameKey(c.name) === profiles.nameKey(want.character));
        if (!character) return { error: "Dieser Charakter steht nicht in deinem Profil." };
        // The character's version is the attendance's (#741): a category plays one
        // version, and a version hidden in the settings takes no new entry.
        const fits = cats.length
            ? cats.some((c) => !presenceVersionProblem(character, c, { config: cfg }))
            : !presenceVersionProblem(character, "", { config: cfg });
        if (!fits) return { error: presenceVersionProblem(character, cats[0] || "", { config: cfg }) };
        const spec = (character.specs || []).find((s) => s.key === str(want.spec));
        if (!spec) return { error: "Diese Spec hat der Charakter im Profil nicht." };
        out.push({ character: character.name, spec: spec.key, versionId: character.versionId || "" });
    }
    return { value: out };
}

/**
 * The raids of a period entered for every category (/availability) that are not
 * the raider's: a category with raider roles the raider holds none of, and no
 * signup there yet. The picker leaves them out. One role lookup per server.
 * @returns {Promise<string[]>} event ids
 */
async function foreignRaids(userId, scope, { now = Date.now(), config } = {}) {
    const cfg = config || settingsStore.getConfig();
    const roleIds = new Map();
    const out = [];
    for (const event of raidsInRange(scope, { now, config: cfg })) {
        if (signupStore.getSignup(event.id, userId)) continue;
        const guild = event.guildId || firstServerId(cfg) || "";
        if (!roleIds.has(guild)) roleIds.set(guild, await discord.memberRoleIds(guild, userId));
        const access = await checkRaiderRole(event, userId, { previous: null, roleIds: roleIds.get(guild), config: cfg });
        if (access.error) out.push(event.id);
    }
    return out;
}

/** Whether an absence of the raider covers this raid (an attendance then stays out of it). */
function absentFor(userId, event, { excludeId = "", config } = {}) {
    return store.listEntries({ userId })
        .some((e) => e.id !== excludeId && e.kind === "absence" && covers(e, event, { config }) && !e.skip.includes(event.id));
}

/**
 * Whether an entry was made at one category's panel: a single category, not
 * from the web (anybody can pick any category there). Such an absence signs
 * off whatever the raider roles say - the panel sits where only that
 * category's raiders are.
 */
function fromPanel(entry) {
    if (entry.via === "web") return false;
    const scope = scopeOf(entry);
    return !!scope && scope.length === 1 && scope[0].categoryIds.length === 1;
}

/**
 * Apply one entry to one raid. Returns `{ eventId, ok, skipped?, error? }`
 * and marks the raid as done for this entry, whatever came out.
 */
async function applyToRaid(entry, event, { now = Date.now(), config, members } = {}) {
    const result = await applyOutcome(entry, event, { now, config, members });
    store.markApplied(entry.id, event.id, result, { now });
    return { eventId: event.id, title: event.title || "", startTime: Number(event.startTime) || 0, ...result };
}

async function applyOutcome(entry, event, { now, config, members }) {
    const previous = signupStore.getSignup(event.id, entry.userId);
    const byOrga = !!entry.createdBy && entry.createdBy !== entry.userId;
    if (entry.kind === "absence") {
        if (previous && previous.status === "absence") return { ok: false, skipped: "already_absent" };
        // Saying "I am away" needs no raider role: an entry made at a category's panel signs off from its raids
        // whatever the roles say (the panel sits where only that category's raiders are). One for every
        // category (/availability) leaves the raids of categories the raider is no raider of alone — quietly,
        // they were never theirs. So does one from the web dialog, category or not: anybody can pick any
        // category there. Entries without `via` predate the web dialog and come from Discord.
        if (!fromPanel(entry) && !previous && !byOrga) {
            const access = await checkRaiderRole(event, entry.userId, { previous: null, config });
            if (access.error) return { ok: false, skipped: "not_raider" };
        }
        // the roster and the event message show it: the event's language (its category's)
        const lang = eventLang(event, config);
        const comment = entry.comment || tr(lang, "Away {from}–{to}", { from: shortDay(entry.from, lang), to: shortDay(entry.to, lang) });
        const saved = await submitSignup(event.id, entry.userId, { status: "absence", comment }, { byOrga, actorId: entry.createdBy, now, config, roleCheck: false });
        return saved.error ? { ok: false, error: saved.error } : { ok: true };
    }
    if (previous) return { ok: false, skipped: previous.status === "absence" ? "absent" : "already_signed" };
    if (absentFor(entry.userId, event, { config })) return { ok: false, skipped: "absent" };
    // the characters of the raid's version, in order, as many as it takes - the rest is left out
    const version = versionOfEvent(event, { config });
    const chars = charactersFor(entry, event, { max: maxCharactersFor(event, config), config })
        .filter((c) => specOf(c.spec, version));
    if (!chars.length) return { ok: false, error: "Klasse passt nicht zu diesem Raid" };
    const saved = await submitSignup(event.id, entry.userId, {
        characters: chars.map((c) => ({ character: c.character, spec: c.spec })),
        status: "signed",
    // an attendance from the web signs up like the web signup does: a PuG raid only for members of its server (#907)
    // `members` (createEntry): the membership asked once per server up front; a server missing there asks itself
    }, { byOrga, actorId: entry.createdBy, now, config, memberOnly: entry.via === "web", membership: members ? members.get(serverOf(event, config)) : undefined });
    return saved.error ? { ok: false, error: saved.error } : { ok: true };
}

/**
 * A web attendance's membership on the servers of its open (PuG) raids, all
 * asked at once and each server once (#907) - null when no lookup is needed
 * (not from the web, an absence, entered by the orga).
 */
async function membersFor(entry, raids, cfg) {
    if (entry.via !== "web" || entry.kind === "absence") return null;
    if (entry.createdBy && entry.createdBy !== entry.userId) return null;
    const open = raids.filter((e) => !signupStore.getSignup(e.id, entry.userId) && isOpenRaid(e, cfg));
    return open.length ? membershipByServer(open, entry.userId, { config: cfg }) : null;
}

/**
 * Enter an absence or attendance and apply it to the raids of its period at
 * once — `eventIds` are the raids picked from raidsInRange (none given = all),
 * the others are remembered as deselected. The raider gets one DM with what
 * happened.
 * @returns {Promise<{ entry?: object, results?: object[], dm?: boolean, error?: string }>}
 */
async function createEntry(userId, input = {}, { by = "", via = "", eventIds, now = Date.now(), config, dm = true } = {}) {
    const cfg = config || settingsStore.getConfig();
    const checked = checkInput(userId, input, { now, config: cfg });
    if (checked.error) return checked;
    const raids = raidsInRange(checked.value, { now, config: cfg });
    const picked = Array.isArray(eventIds) ? new Set(eventIds.map(str)) : null;
    const skip = picked ? raids.filter((e) => !picked.has(e.id)).map((e) => e.id) : [];
    // entries long over go here - after KEEP_DAYS: the attendance (#677) still tells "Urlaub" from a plain
    // sign-off by them, over its longest window (16 raids of a weekly category)
    store.prune(today(now), KEEP_DAYS);
    const added = store.addEntry({ ...checked.value, skip, createdBy: str(by) || checked.value.userId, via }, { now });
    if (added.error) return added;
    const targets = raids.filter((e) => !skip.includes(e.id));
    const members = await membersFor(added.entry, targets, cfg);
    const results = [];
    for (const event of targets) results.push(await applyToRaid(added.entry, event, { now, config: cfg, members }));
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
            .filter((e) => covers(e, event, { config: cfg }) && !e.skip.includes(event.id) && !e.applied[event.id])
            .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "absence" ? -1 : 1));
        for (const entry of entries) {
            const result = await applyToRaid(entry, event, { now, config: cfg });
            out.push({ entry, result });
            if (result.ok) await sendDm(entry.userId, raidDm(entry, event, langOf(entry.userId, { config: cfg }), { config: cfg }));
        }
    } catch (e) {
        logger.warn(`[availability] ${eventId}: ${(e && e.message) || e}`);
    }
    return out;
}

/**
 * Change an entry - the raider's own, or anyone's for the orga: its period,
 * reason, scope and (attendance) characters; the kind stays. The raids it
 * already touched stay as they are (`applied`, nothing is undone); raids it
 * newly covers are applied at once like createEntry does - `eventIds` are the
 * ones picked (none given = all), the others are remembered as deselected. One
 * DM "Absence changed" / "Attendance changed".
 * @returns {Promise<{ entry?: object, results?: object[], dm?: boolean, error?: string, code?: string }>}
 */
async function changeEntry(id, input = {}, { userId = "", orga = false, eventIds, now = Date.now(), config, dm = true } = {}) {
    const old = store.getEntry(id);
    if (!old || (!orga && old.userId !== str(userId))) return { error: "Eintrag nicht gefunden.", code: "not_found" };
    const cfg = config || settingsStore.getConfig();
    const checked = checkInput(old.userId, { ...input, kind: old.kind }, { now, config: cfg });
    if (checked.error) return checked;
    const raids = raidsInRange(checked.value, { now, config: cfg });
    const fresh = raids.filter((e) => !old.applied[e.id]);
    const picked = Array.isArray(eventIds) ? new Set(eventIds.map(str)) : null;
    // deselected now, plus what was deselected before and is not in today's list (a raid gone past, out of scope)
    const skip = picked
        ? [...new Set([...fresh.filter((e) => !picked.has(e.id)).map((e) => e.id), ...old.skip.filter((s) => !raids.some((e) => e.id === s))])]
        : old.skip;
    const patch = { from: checked.value.from, to: checked.value.to, comment: checked.value.comment, skip };
    if (checked.value.scope.length) patch.scope = checked.value.scope;
    else { patch.scope = []; patch.categoryId = checked.value.categoryId; }
    if (old.kind === "presence") patch.characters = checked.value.characters;
    const updated = store.updateEntry(old.id, patch);
    if (updated.error) return updated;
    const targets = fresh.filter((e) => !skip.includes(e.id));
    const members = await membersFor(updated.entry, targets, cfg);
    const results = [];
    for (const event of targets) results.push(await applyToRaid(updated.entry, event, { now, config: cfg, members }));
    const entry = store.getEntry(old.id) || updated.entry;
    const sent = dm ? await sendDm(entry.userId, entryDm(entry, results, langOf(entry.userId, { config: cfg }), { changed: true })) : false;
    return { entry, results, dm: sent };
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
// not shown at all: a raid of a category the raider is no raider of (an absence for every category)
const QUIET_SKIPS = ["not_raider"];

/** "**A** · Spec, **B** · Spec" of an attendance's characters. */
function charactersText(chars, lang) {
    return chars.map((c) => `**${c.character}** · ${specName(c.spec, lang)}`).join(", ");
}

/** The DM after entering (or changing): the period, what was done per raid, and that later raids follow. */
function entryDm(entry, results, lang = "de", { changed = false } = {}) {
    const absence = entry.kind === "absence";
    const lines = [periodText(entry)];
    if (absence && entry.comment) lines.push(tr(lang, "Reason: {reason}", { reason: entry.comment }));
    if (!absence) {
        const chars = charactersOf(entry);
        lines.push(chars.length === 1
            ? tr(lang, "Character: **{character}** · {spec}", { character: chars[0].character, spec: specName(chars[0].spec, lang) })
            : tr(lang, "Characters: {characters}", { characters: charactersText(chars, lang) }));
    }
    const done = results.filter((r) => r.ok);
    const skipped = results.filter((r) => !r.ok && r.skipped && !QUIET_SKIPS.includes(r.skipped));
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
        title: changed
            ? (absence ? tr(lang, "Absence changed") : tr(lang, "Attendance changed"))
            : (absence ? tr(lang, "Absence saved") : tr(lang, "Attendance saved")),
        description: lines.join("\n"),
        footer: entry.createdBy !== entry.userId ? tr(lang, "Entered for you by the raid lead") : "",
    };
}

/** The DM when a raid of the period was signed up / off for the raider later on. */
function raidDm(entry, event, lang = "de", { config } = {}) {
    const absence = entry.kind === "absence";
    const lines = [raidLine({ eventId: event.id, title: event.title, startTime: event.startTime })];
    const period = periodText(entry);
    const chars = absence ? [] : charactersFor(entry, event, { max: maxCharactersFor(event, config), config });
    lines.push(absence
        ? (entry.comment
            ? tr(lang, "You are away {period} ({reason}), so you were signed off.", { period, reason: entry.comment })
            : tr(lang, "You are away {period}, so you were signed off.", { period }))
        : chars.length === 1
            ? tr(lang, "You are available {period}, so you were signed up with **{character}** · {spec}.", { period, character: chars[0].character, spec: specName(chars[0].spec, lang) })
            : tr(lang, "You are available {period}, so you were signed up with {characters}.", { period, characters: charactersText(chars, lang) }));
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
    raidsInRange, foreignRaids, checkInput, createEntry, changeEntry, applyToEvent, deleteEntry, activeEntries, covers, absentFor, today, dayOf, dayStart, shortDay,
    entrySummary: entryDm,
    // only for the tests: not part of the module's API
    _internal: { raidDm, applyToRaid, absentFor },
};
