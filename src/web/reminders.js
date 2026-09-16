// Automatic reminders per raid category (#264).
//
// Two kinds, both configured in Einstellungen → Verbindungen → Discord-Server
// (`config.categoryReminders[categoryId]`):
//
//   missing — `missingHours` before the sign-up deadline to the members holding
//             the category's raider roles who have not reacted yet. Raid-Helper
//             events have no deadline, so there the raid start stands in; an
//             event that carries `signupDeadline` (EventHelper's own events,
//             #254) is measured against that.
//   signed  — `signedHours` before the raid to everyone signed up (signed/late).
//
// Rules that make this safe to run every few minutes:
//
//   - nothing is ever sent once the raid has started (and a "missing" reminder
//     not after the deadline either);
//   - every reminder is marked in reminderStore *before* it is sent, so two
//     overlapping sweeps or a restart never send it twice; a send that fails
//     takes its mark back, so the next sweep retries it;
//   - a window that opened while the bot was down still sends on the next sweep,
//     as long as the raid has not started.
const guildRoles = require("./guildRoles");
const discord = require("./discord");
const reminderStore = require("./reminderStore");
const { deliverUserPing } = require("./pingDelivery");
const { loadEventGroups } = require("./raidEventGroups");
const { getConfig } = require("./settingsStore");
const { computeAttendance, signupStatus, isRosterKnown } = require("../utils/attendance");

const HOUR_MS = 60 * 60 * 1000;
const KINDS = ["missing", "signed"];

/**
 * A point in time as ms: unix seconds (Raid-Helper), ms, a numeric string or an
 * ISO date. 0 when it cannot be read — a missing deadline is no deadline.
 */
function toMs(value) {
    if (value === null || value === undefined || value === "") return 0;
    const n = Number(value);
    if (Number.isFinite(n)) {
        if (n <= 0) return 0;
        return n < 1e12 ? n * 1000 : n;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Which reminders of one event are due now and not yet sent.
 * @param {{ startTime, signupDeadline? }} event
 * @param {{ missingHours, signedHours }} rule
 * @param {{ [kind]: number }} sent marks from reminderStore
 * @returns {string[]} subset of KINDS
 */
function dueReminders(event, rule, sent = {}, now = Date.now()) {
    const startMs = toMs(event && event.startTime);
    if (!startMs || !rule || now >= startMs) return [];
    const due = [];
    const missingHours = Number(rule.missingHours) || 0;
    if (missingHours > 0 && !sent.missing) {
        const deadlineMs = toMs(event.signupDeadline);
        // A deadline after the start is no deadline at all.
        const anchor = deadlineMs && deadlineMs < startMs ? deadlineMs : startMs;
        if (now < anchor && now >= anchor - missingHours * HOUR_MS) due.push("missing");
    }
    const signedHours = Number(rule.signedHours) || 0;
    if (signedHours > 0 && !sent.signed && now >= startMs - signedHours * HOUR_MS) due.push("signed");
    return due;
}

/** The text of a reminder; the start as a Discord timestamp, so everyone reads it in their own time zone. */
function reminderText(kind, event) {
    const start = Math.floor(toMs(event.startTime) / 1000);
    const title = event.title ? `**${event.title}**` : "den Raid";
    if (kind === "signed") return `Erinnerung: ${title} beginnt <t:${start}:R>. Bis gleich!`;
    const deadline = Math.floor(toMs(event.signupDeadline) / 1000);
    const until = deadline && deadline < start ? `Anmeldeschluss <t:${deadline}:R>` : `Raidbeginn <t:${start}:F>`;
    return `Erinnerung: Bitte meldet euch für ${title} an oder ab (${until}).`;
}

/** Who a reminder goes to; `null` = cannot be known right now (try again next sweep). */
async function recipients(kind, event, categoryId, guildId, config) {
    if (kind === "signed") {
        return (event.signUps || [])
            .filter((s) => s && s.userId && ["signed", "late"].includes(signupStatus(s)))
            .map((s) => String(s.userId));
    }
    const roleIds = (config.categoryRoles || {})[categoryId] || [];
    if (!roleIds.length || !isRosterKnown(event)) return null;
    const { members, error } = await discord.listMembersWithRoles(guildId, roleIds);
    if (error) return null;
    return computeAttendance(members, event.signUps || []).missing.map((m) => String(m.id));
}

let running = false;
let lastRun = null;

/**
 * One sweep over the event server's upcoming events.
 * @returns {Promise<{ sent: number, failed: number, skipped: number, error: string|null }>}
 */
async function runReminders({ now = Date.now(), config = getConfig() } = {}) {
    const rules = config.categoryReminders || {};
    const summary = { sent: 0, failed: 0, skipped: 0, error: null };
    if (!Object.keys(rules).length) return summary;
    if (running) return { ...summary, error: "läuft bereits" };
    running = true;
    try {
        const guildId = guildRoles.eventGuildId(config);
        if (!guildId) return { ...summary, error: "Kein Event-Discord eingestellt." };
        const { groups, error } = await loadEventGroups(guildId);
        if (error && !(groups || []).length) return { ...summary, error };
        for (const group of groups || []) {
            const rule = rules[group.categoryId];
            if (!rule) continue;
            for (const event of group.events || []) {
                for (const kind of dueReminders(event, rule, reminderStore.getSent(event.id), now)) {
                    const userIds = await recipients(kind, event, group.categoryId, guildId, config);
                    if (userIds === null) { summary.skipped += 1; continue; }
                    // Marked first: a second sweep running into this one sends nothing.
                    if (!reminderStore.markSent(event.id, kind, now)) continue;
                    if (!userIds.length) continue; // nobody to remind — done for good
                    try {
                        await deliverUserPing({
                            target: rule.target, event, userIds, text: reminderText(kind, event), guildId, config,
                        });
                        summary.sent += 1;
                    } catch (e) {
                        reminderStore.clearSent(event.id, kind);
                        summary.failed += 1;
                        console.error(`[reminders] ${event.title || event.id} (${kind}):`, e.message);
                    }
                }
            }
        }
        reminderStore.prune();
        return summary;
    } finally {
        running = false;
        lastRun = { at: now, ...summary };
    }
}

/** The last sweep's outcome for the settings page; null before the first one. */
function lastReminderRun() {
    return lastRun;
}

let timer = null;

/** Start the periodic reminder sweep (idempotent, unref'd), like logAutoLink. */
function startReminders({ intervalMs = 5 * 60 * 1000 } = {}) {
    if (timer) return timer;
    const run = () => runReminders().catch((e) => console.error("[reminders]", e.message));
    run();
    timer = setInterval(run, intervalMs);
    if (timer.unref) timer.unref();
    return timer;
}

/** Test-only: forget the running timer and the last run. */
function _resetForTests() {
    if (timer) clearInterval(timer);
    timer = null;
    running = false;
    lastRun = null;
}

module.exports = {
    KINDS, toMs, dueReminders, reminderText, runReminders, lastReminderRun, startReminders, _resetForTests,
};
