// Recurring events per raid category (#289).
//
// A series says "every Wednesday (and Saturday) at 19:30, the raid template
// SSC + TK 25er, created 6 days before". A sweep every few minutes creates each
// date's event once its window opens, through the one way in there is —
// eventCreate.createEvent() — so the event gets everything a hand-made one
// gets: a channel named and designed like the category's previous event channel
// (#285), the signup message, the talk overview refresh.
//
// Rules that make the sweep safe to run as often as it likes:
//
//   - only categories whose new events are EventHelper events
//     (`categorySignupSource`); a series in a Raid-Helper category rests;
//   - a date is claimed in eventSeriesStore *before* its event is created, so
//     neither two sweeps nor a restart ever create it twice. A failed attempt
//     is retried a few times (MAX_ATTEMPTS, RETRY_AFTER_MS apart), then stays
//     failed — shown on the page and as a dashboard task — until the orga asks
//     for another try. An interrupted one ("creating" and no result) is never
//     retried on its own: nobody can tell whether its channel exists;
//   - a date that already has an event in the category (any source, any
//     status — a cancelled one included, #288) is only marked, never created;
//   - a date whose event was deleted (eventManage.deleteEvent) keeps a
//     "deleted" mark and is never created again;
//   - a skipped date (holiday) is left alone; nothing happens once the raid
//     would have started.
//
// All dates are Berlin wall-clock dates: "19:30" stays 19:30 across the
// daylight-saving switch, and "6 days before" means six calendar days at the
// same clock time.

const { DateTime } = require("luxon");
const discord = require("../services/discord/discord");
const store = require("../stores/eventSeriesStore");
const eventStore = require("../stores/eventStore");
const guildRoles = require("../services/discord/guildRoles");
const channelNaming = require("../services/discord/channelNaming");
const { signupSourceFor, ownUpcomingRaw } = require("./eventSources");
const { loadEventGroups } = require("./raidEventGroups");
const { getConfig, getRaidTemplate } = require("../stores/settingsStore");
const { parseClockTime } = require("../utils/time");

const { TIMEZONE } = require("../config/timezone");
const { createEvent } = require("./eventCreate");
const WEEKDAY_SHORT = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MIN_DAYS_BEFORE = 1;
const MAX_DAYS_BEFORE = 28;
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 10 * 60 * 1000;
// A "creating" mark this old was interrupted (restart, crash) — shown as such.
const STALE_CREATING_MS = 15 * 60 * 1000;
const MAX_TITLE = 100;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function todayIn(now) {
    return DateTime.fromMillis(Number(now), { zone: TIMEZONE }).toISODate();
}

/**
 * Validate a series as the page sends it.
 * @param {object} input { categoryId, enabled, weekdays, time, raidTemplateId, daysBefore, title, skipDates }
 * @param {{ now?: number, categoryTemplateId?: string }} opts
 * @returns {{ value?: object, error?: string }}
 */
function normalizeSeries(input = {}, { now = Date.now(), categoryTemplateId = "" } = {}) {
    const categoryId = String(input.categoryId || "").trim();
    if (!categoryId) return { error: "Keine Kategorie angegeben." };
    const weekdays = [...new Set((Array.isArray(input.weekdays) ? input.weekdays : [])
        .map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
    if (!weekdays.length) return { error: "Bitte mindestens einen Wochentag wählen." };
    const time = parseClockTime(input.time);
    if (!time) return { error: "Ungültige Uhrzeit." };
    const daysBefore = Math.floor(Number(input.daysBefore));
    if (!Number.isFinite(daysBefore) || daysBefore < MIN_DAYS_BEFORE || daysBefore > MAX_DAYS_BEFORE) {
        return { error: `„Tage vorher“ muss zwischen ${MIN_DAYS_BEFORE} und ${MAX_DAYS_BEFORE} liegen.` };
    }
    const raidTemplateId = String(input.raidTemplateId || "").trim();
    if (raidTemplateId && !getRaidTemplate(raidTemplateId)) return { error: "Die Raid-Vorlage gibt es nicht mehr." };
    if (!raidTemplateId && !categoryTemplateId) {
        return { error: "Bitte eine Raid-Vorlage wählen — die Kategorie hat keine Standard-Vorlage." };
    }
    const today = todayIn(now);
    const skipDates = [...new Set((Array.isArray(input.skipDates) ? input.skipDates : [])
        .map((d) => String(d || "").trim()).filter((d) => ISO_DAY.test(d) && DateTime.fromISO(d).isValid && d >= today))].sort();
    return {
        value: {
            categoryId,
            enabled: input.enabled !== false,
            weekdays,
            time,
            raidTemplateId,
            daysBefore,
            title: String(input.title || "").trim().slice(0, MAX_TITLE),
            skipDates,
        },
    };
}

/**
 * The series' coming dates, soonest first: `{ date, startTime (s), createAt (ms), skipped }`.
 * Only dates whose start is still ahead. Pure.
 */
function occurrences(series, { now = Date.now(), count = 4, horizonDays = 120 } = {}) {
    const out = [];
    if (!series || !Array.isArray(series.weekdays) || !series.weekdays.length || !series.time) return out;
    const days = new Set(series.weekdays.map(Number));
    const skip = new Set(series.skipDates || []);
    const first = DateTime.fromMillis(Number(now), { zone: TIMEZONE }).startOf("day");
    for (let i = 0; i <= horizonDays && out.length < count; i++) {
        const day = first.plus({ days: i });
        if (!days.has(day.weekday)) continue;
        const date = day.toISODate();
        const start = DateTime.fromISO(`${date}T${series.time}`, { zone: TIMEZONE });
        if (!start.isValid || start.toMillis() <= now) continue;
        out.push({
            date,
            startTime: Math.floor(start.toSeconds()),
            createAt: start.minus({ days: Number(series.daysBefore) || 0 }).toMillis(),
            skipped: skip.has(date),
        });
    }
    return out;
}

/** Whether a failed date may be tried again now. */
function retryable(mark, now = Date.now()) {
    return !!mark && mark.status === "failed" && (mark.attempts || 0) < MAX_ATTEMPTS && now - (Number(mark.at) || 0) >= RETRY_AFTER_MS;
}

/** An event row's Berlin day. */
function dayOf(ev) {
    return ev && ev.startTime ? DateTime.fromSeconds(Number(ev.startTime), { zone: TIMEZONE }).toISODate() : "";
}

/**
 * The dates the sweep has to act on now: window open, start ahead, not skipped,
 * no mark (or a failed one that may be retried). Pure.
 */
function dueDates(series, runs = {}, now = Date.now()) {
    if (!series || !series.enabled) return [];
    const horizon = (Number(series.daysBefore) || 0) + 8;
    return occurrences(series, { now, count: 50, horizonDays: horizon })
        .filter((o) => !o.skipped && o.createAt <= now)
        .filter((o) => !runs[o.date] || retryable(runs[o.date], now));
}

/**
 * What the page shows per coming date: `state` is one of
 * planned | due | creating | interrupted | created | existing | cancelled | deleted | failed | skipped,
 * with the mark's details. `events` are the category's events (any source) with
 * `{ id, startTime, status, channelName }`. Pure.
 */
function planSeries(series, runs = {}, { now = Date.now(), count = 4, events = [] } = {}) {
    const byDay = new Map();
    for (const ev of events || []) {
        const day = dayOf(ev);
        if (day && !byDay.has(day)) byDay.set(day, ev);
    }
    return occurrences(series, { now, count }).map((o) => {
        const mark = runs[o.date] || null;
        const ev = byDay.get(o.date) || null;
        const base = { ...o, eventId: "", channelName: "", error: "", at: 0, attempts: 0 };
        if (mark) {
            Object.assign(base, {
                eventId: mark.eventId || (ev && ev.id) || "",
                channelName: mark.channelName || (ev && ev.channelName) || "",
                error: mark.error || "",
                at: Number(mark.at) || 0,
                attempts: mark.attempts || 0,
                messageError: mark.messageError || "",
            });
        } else if (ev) {
            Object.assign(base, { eventId: ev.id, channelName: ev.channelName || "" });
        }
        let state;
        if (ev && ev.status === "cancelled") state = "cancelled";
        else if (mark && mark.status === "created") state = "created";
        else if (mark && mark.status === "existing") state = "existing";
        else if (mark && mark.status === "creating") state = now - base.at > STALE_CREATING_MS ? "interrupted" : "creating";
        else if (ev) state = "existing";
        else if (mark && mark.status === "deleted") state = "deleted";
        else if (mark && mark.status === "failed") state = "failed";
        else if (o.skipped) state = "skipped";
        else if (!series.enabled) state = "off";
        else state = o.createAt <= now ? "due" : "planned";
        return { ...base, state, willRetry: state === "failed" && (mark.attempts || 0) < MAX_ATTEMPTS };
    });
}

/** "SSC + TK 25er" — the template a series uses: its own, else the category's default. */
function templateFor(series, config = getConfig()) {
    const id = (series && series.raidTemplateId) || (config.categoryRaidTemplate || {})[series && series.categoryId] || "";
    const t = id ? getRaidTemplate(id) : null;
    return t ? { id: t.id, name: t.name || "", instanceIds: t.instanceIds || [], size: t.size || null, isDefault: !series.raidTemplateId } : null;
}

/** "Mi + Sa 19:30 · SSC + TK 25er · 6 Tage vorher". Pure. */
function summaryLine(series, templateName = "") {
    if (!series) return "";
    const days = (series.weekdays || []).map((d) => WEEKDAY_SHORT[d]).filter(Boolean).join(" + ");
    const before = Number(series.daysBefore) === 1 ? "1 Tag vorher" : `${series.daysBefore} Tage vorher`;
    return [`${days} ${series.time}`, templateName || "ohne Vorlage", before].join(" · ");
}

/** The category's events of both sources, for "is there one on that day already". Best-effort. */
async function categoryEvents(guildId, categoryId, now = Date.now()) {
    const out = [];
    try {
        for (const ev of ownUpcomingRaw(guildId, { now, categoryId })) out.push(ev);
    } catch {
        // an unreadable store leaves the Raid-Helper half
    }
    try {
        const { groups } = await loadEventGroups(guildId);
        for (const g of groups || []) {
            if (g.categoryId !== categoryId) continue;
            for (const ev of g.events || []) {
                if (!out.some((o) => o.id === ev.id)) out.push(ev);
            }
        }
    } catch {
        // Raid-Helper down: the own events above still count
    }
    return out;
}

function categoryName(guildId, categoryId) {
    try {
        const hit = (discord.listCategories(guildId) || []).find((c) => c.id === categoryId);
        return hit ? hit.name : "";
    } catch {
        return "";
    }
}

function discordReady() {
    const client = discord.getClient();
    if (!client) return false;
    return typeof client.isReady === "function" ? client.isReady() : true;
}

let running = false;

/**
 * One sweep over every enabled series.
 * @param {{ now?: number, config?: object, createEvent?: Function, onlyCategoryId?: string }} opts
 * @returns {Promise<{ created: number, failed: number, existing: number, ignored: number, error: string|null, results: object[] }>}
 */
async function runSeries({ now = Date.now(), config = getConfig(), onlyCategoryId = "" } = {}) {
    const summary = { created: 0, failed: 0, existing: 0, ignored: 0, error: null, results: [] };
    const all = Object.values(store.listSeries()).filter((s) => s && s.enabled && (!onlyCategoryId || s.categoryId === onlyCategoryId));
    if (!all.length) return summary;
    if (running) return { ...summary, error: "läuft bereits" };
    running = true;
    try {
        if (!discordReady()) {
            summary.error = "Discord ist nicht verbunden — Serien warten auf den Bot.";
            return summary;
        }
        for (const series of all) {
            const categoryId = series.categoryId;
            if (signupSourceFor(categoryId) !== "eventhelper") { summary.ignored += 1; continue; }
            const guildId = series.guildId || guildRoles.eventGuildId(config);
            if (!guildId) { summary.error = "Kein Event-Discord eingestellt."; continue; }
            const due = dueDates(series, store.getRuns(categoryId), now);
            if (!due.length) continue;
            const events = await categoryEvents(guildId, categoryId, now);
            const template = templateFor(series, config);
            const title = series.title || (template && template.name) || categoryName(guildId, categoryId) || "Raid";
            for (const occ of due) {
                const existing = events.find((ev) => dayOf(ev) === occ.date);
                if (existing) {
                    const runs = store.getRuns(categoryId);
                    if (!runs[occ.date] || runs[occ.date].status === "failed") {
                        store.setRun(categoryId, occ.date, {
                            status: "existing", at: now, eventId: existing.id, channelName: existing.channelName || "", error: "",
                        });
                        summary.existing += 1;
                    }
                    continue;
                }
                if (!store.claimDate(categoryId, occ.date, { at: now, retry: (mark) => retryable(mark, now) })) continue;
                const leader = series.leaderId || series.updatedBy || "";
                let result;
                try {
                    result = await createEvent({
                        guildId,
                        user: leader ? { id: leader } : null,
                        body: {
                            title,
                            date: occ.date,
                            time: series.time,
                            newChannel: { name: "", categoryId },
                            signupSource: "eventhelper",
                            ...(series.raidTemplateId ? { raidTemplateId: series.raidTemplateId } : {}),
                        },
                    });
                } catch (e) {
                    result = { error: { message: e.message || "Event konnte nicht angelegt werden." } };
                }
                if (result && result.error) {
                    const message = result.error.message || "Event konnte nicht angelegt werden.";
                    store.setRun(categoryId, occ.date, { status: "failed", at: now, error: message });
                    summary.failed += 1;
                    summary.results.push({ categoryId, date: occ.date, error: message });
                    console.error(`[eventSeries] ${title} ${occ.date}:`, message);
                    continue;
                }
                const body = (result && result.body) || {};
                const event = body.event || {};
                const channelName = (body.channelNaming && body.channelNaming.name) || event.channelName || "";
                store.setRun(categoryId, occ.date, {
                    status: "created", at: now, eventId: body.id || event.id || "", channelId: event.channelId || "",
                    channelName, error: "", messageError: body.messageError || "",
                });
                if (body.id) {
                    try {
                        eventStore.appendEventLog(body.id, { at: now, action: "series", detail: summaryLine(series, template && template.name) });
                    } catch {
                        // the log is a courtesy
                    }
                }
                summary.created += 1;
                summary.results.push({ categoryId, date: occ.date, eventId: body.id || "", channelName });
                // The next date's channel is named after this one.
                events.push({ id: body.id, startTime: occ.startTime, channelName });
            }
        }
        store.pruneRuns(todayIn(now));
        return summary;
    } finally {
        running = false;
        const { results, ...rest } = summary;
        try {
            store.setLastRun({ at: now, ...rest, count: results.length });
        } catch {
            // nothing to do about a full disk here
        }
    }
}

/**
 * The page's rows: one per event category (plus any category that still has a
 * series), each with its series, template, summary line and the next dates with
 * the channel name each would get.
 */
async function seriesOverview({ guildId, config = getConfig(), now = Date.now(), count = 4 } = {}) {
    const stored = store.listSeries();
    const ids = [...new Set([...(config.categoryIds || []), ...Object.keys(stored)])];
    let names = {};
    try {
        names = Object.fromEntries((discord.listCategories(guildId) || []).map((c) => [c.id, c.name]));
    } catch {
        names = {};
    }
    const inputs = await channelNaming.loadNamingInputs(guildId);
    const categories = [];
    for (const id of ids) {
        const series = stored[id] || null;
        const source = signupSourceFor(id);
        const row = { id, name: names[id] || "", source, series: null, template: null, summary: "", upcoming: [], lastCreated: null };
        if (series) {
            const view = await describeSeries(series, { guildId, config, now, count, inputs });
            Object.assign(row, view, { series });
        } else {
            const template = templateFor({ categoryId: id, raidTemplateId: "" }, config);
            row.template = template;
        }
        categories.push(row);
    }
    return { categories, lastRun: store.getLastRun() };
}

/** Summary line, upcoming dates with naming, and the newest creation of one series. */
async function describeSeries(series, { guildId, config = getConfig(), now = Date.now(), count = 4, inputs = null } = {}) {
    const template = templateFor(series, config);
    const runs = store.getRuns(series.categoryId);
    const events = inputs
        ? inputs.events.filter((ev) => ev.categoryId === series.categoryId)
        : await categoryEvents(guildId, series.categoryId, now);
    const naming = inputs || await channelNaming.loadNamingInputs(guildId);
    const raid = template ? channelNaming.raidTagFor(template.instanceIds) : "";
    const ctx = channelNaming.namingContext({ ...naming, categoryId: series.categoryId, raid });
    const upcoming = planSeries(series, runs, { now, count, events }).map((o) => {
        if (o.channelName) return o;
        const result = channelNaming.describeResult(ctx, o.date, raid);
        return {
            ...o,
            previewName: result.name,
            naming: { source: result.source, label: result.label, detail: result.detail, design: result.design },
        };
    });
    const created = Object.entries(runs)
        .filter(([, m]) => m.status === "created")
        .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))[0];
    return {
        template,
        summary: summaryLine(series, template ? template.name : ""),
        upcoming,
        lastCreated: created ? { date: created[0], at: created[1].at, channelName: created[1].channelName || "", eventId: created[1].eventId || "" } : null,
    };
}

/**
 * The failures the dashboard reports: failed dates (and interrupted creations)
 * whose raid is still ahead.
 */
function seriesFailures({ now = Date.now() } = {}) {
    const today = todayIn(now);
    const stored = store.listSeries();
    const out = [];
    for (const [categoryId, runs] of Object.entries(store.listRuns())) {
        for (const [date, mark] of Object.entries(runs || {})) {
            if (date < today) continue;
            const interrupted = mark.status === "creating" && now - (Number(mark.at) || 0) > STALE_CREATING_MS;
            if (mark.status !== "failed" && !interrupted) continue;
            out.push({
                categoryId,
                date,
                at: Number(mark.at) || 0,
                attempts: mark.attempts || 0,
                error: interrupted ? "Anlage wurde unterbrochen — bitte prüfen, ob Kanal und Event existieren." : (mark.error || "unbekannter Fehler"),
                hasSeries: !!stored[categoryId],
            });
        }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
}

const RAIDHELPER_HINT = "Neue Events dieser Kategorie laufen über Raid-Helper — Serien gibt es nur für Kategorien mit „Neue Events: EventHelper“ (Einstellungen → Kategorien).";

/**
 * The page's live preview of an unsaved series: its summary line and next dates
 * (with states and channel names), or the validation error.
 */
async function previewSeries({ guildId, input = {}, config = getConfig(), now = Date.now(), count = 4 } = {}) {
    const categoryTemplateId = (config.categoryRaidTemplate || {})[String(input.categoryId || "")] || "";
    const checked = normalizeSeries(input, { now, categoryTemplateId });
    if (checked.error) return { error: checked.error, summary: "", upcoming: [], template: null, lastCreated: null };
    const series = { ...(store.getSeries(checked.value.categoryId) || {}), ...checked.value };
    const view = await describeSeries(series, { guildId, config, now, count });
    return { error: "", ...view };
}

/**
 * Save a category's series. A Raid-Helper category takes no new series (an
 * existing one may still be edited or switched off).
 * @returns {{ series?: object, error?: { status: number, code: string, message: string } }}
 */
function saveSeriesFor({ guildId, input = {}, user = null, config = getConfig(), now = Date.now() } = {}) {
    const categoryId = String(input.categoryId || "").trim();
    const current = categoryId ? store.getSeries(categoryId) : null;
    if (categoryId && !current && signupSourceFor(categoryId) !== "eventhelper") {
        return { error: { status: 409, code: "raidhelper_category", message: RAIDHELPER_HINT } };
    }
    const checked = normalizeSeries(input, { now, categoryTemplateId: (config.categoryRaidTemplate || {})[categoryId] || "" });
    if (checked.error) return { error: { status: 400, code: "invalid", message: checked.error } };
    const series = store.saveSeries({
        ...checked.value,
        guildId: (current && current.guildId) || guildId || guildRoles.eventGuildId(config),
        leaderId: (current && current.leaderId) || (user && user.id) || "",
        updatedAt: now,
        updatedBy: (user && user.id) || "",
        updatedByName: (user && (user.name || user.username)) || "",
    });
    return { series };
}

let timer = null;
let firstTimer = null;

/** Start the periodic sweep (idempotent, unref'd). The first run waits for the bot to log in. */
function startEventSeries({ intervalMs = 5 * 60 * 1000, firstDelayMs = 60 * 1000 } = {}) {
    if (timer) return timer;
    const run = () => runSeries().catch((e) => console.error("[eventSeries]", e.message));
    firstTimer = setTimeout(run, firstDelayMs);
    if (firstTimer.unref) firstTimer.unref();
    timer = setInterval(run, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

/** Stop the periodic sweep, the first run included (idempotent). */
function stopEventSeries() {
    if (timer) clearInterval(timer);
    if (firstTimer) clearTimeout(firstTimer);
    timer = null;
    firstTimer = null;
}

/** Test-only. */
function _resetForTests() {
    stopEventSeries();
    running = false;
}

module.exports = {
    MIN_DAYS_BEFORE, MAX_DAYS_BEFORE, STALE_CREATING_MS, runSeries, seriesOverview, previewSeries, saveSeriesFor, seriesFailures,
    startEventSeries, stopEventSeries, _resetForTests,
    // only for the tests (#424): not part of the module's API
    _internal: {
        ZONE: TIMEZONE, MAX_ATTEMPTS, normalizeSeries, occurrences, dueDates, planSeries, summaryLine,
    },
};
