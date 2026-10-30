// Where an own raid stands for the orga — the status model of the Orga-Zentrale
// (services/orgaHub/orgaHub.js, design "A · Liste je Raid", Okt 2026). Derived,
// never stored by hand: one pure function over the stored event and its
// signups, so the hub, a test and any later reader say the same.
//
//   signup     "Anmeldung läuft"         the signup runs (deadline ahead, raid more than 3 days away), nobody placed
//   open       "Setup offen"             deadline passed, signup closed or raid under 3 days away — nobody placed
//   draft      "Setup in Arbeit"         placed, not approved yet
//   approved   "Freigegeben"             approved, not (or not in its latest state) posted to the channel
//   posted     "Gepostet"                approved and posted as it stands
//   changed    "Geändert seit Freigabe"  the draft differs from the approval, or raiders cancelled after it
//   cancelled  "Abgesagt"
//
// Where the setup stands is read once for everybody: setupCore.setupPhase,
// which the raid detail's Freigabe step reads too (web/events/raidDetailSteps.js).
const { setupSummary, setupPhase, approvedSetupOf, confirmationsFor } = require("../setup/setupCore");
const { accountCount } = require("../../utils/signup/capacity");
const { plural } = require("../../utils/text");
const { TIMEZONE } = require("../../config/timezone");

/** The statuses in the order of the summary line. */
const STATUSES = ["signup", "open", "changed", "draft", "approved", "posted", "cancelled"];

const LABELS = {
    signup: "Anmeldung läuft",
    open: "Setup offen",
    draft: "Setup in Arbeit",
    approved: "Freigegeben",
    posted: "Gepostet",
    changed: "Geändert seit Freigabe",
    cancelled: "Abgesagt",
};

/** The summary line's words: "1 Setup offen", "2 geändert" … */
const COUNT_LABELS = {
    signup: ["Anmeldung läuft", "Anmeldungen laufen"],
    open: ["Setup offen", "Setups offen"],
    draft: ["in Arbeit", "in Arbeit"],
    approved: ["freigegeben", "freigegeben"],
    posted: ["gepostet", "gepostet"],
    changed: ["geändert", "geändert"],
    cancelled: ["abgesagt", "abgesagt"],
};

/** The way into the web per status: the button's label and whether it opens the setup tab. */
const LINKS = {
    signup: { label: "Raid", tab: "" },
    open: { label: "Setup bauen", tab: "setup" },
    draft: { label: "Setup", tab: "setup" },
    approved: { label: "Setup posten", tab: "setup" },
    posted: { label: "Setup", tab: "setup" },
    changed: { label: "Setup prüfen", tab: "setup" },
    cancelled: null,
};

/** Without a setup, a raid this close needs one now, deadline or not. */
const SOON_MS = 3 * 24 * 3600 * 1000;

/** "27.10." in the menu's time zone. */
function shortDay(seconds) {
    return new Date(Number(seconds) * 1000).toLocaleDateString("de-DE", { timeZone: TIMEZONE, day: "2-digit", month: "2-digit" });
}

/** The raiders of the approved lineup who cancelled since: signed off, or "Absagen" under the setup message. */
function cancelledAfterApproval(event, signups) {
    const approved = approvedSetupOf(event);
    if (!approved) return 0;
    const placed = new Set((approved.groups || []).flatMap((g) => (g.slots || []).map((s) => String(s.userId))));
    const gone = new Set();
    for (const s of signups || []) {
        if (s && s.status === "absence" && placed.has(String(s.userId))) gone.add(String(s.userId));
    }
    for (const [userId, status] of Object.entries(confirmationsFor(event, approved))) {
        if (status === "declined") gone.add(userId);
    }
    return gone.size;
}

/** "19 von 25" — or just "19" for a raid without a size. */
const ofSize = (n, size) => (size ? `${n} von ${size}` : String(n));

/**
 * The status of one own raid.
 * @param {object} event the stored event (eventStore shape: status, startTime, signupDeadline, signupsClosed, size, setup, setupPost)
 * @param {object[]} [signups] its signups (signupStore)
 * @param {{ now?: number }} [opts]
 * @returns {{ status: string, label: string, detail: string, link: { label: string, tab: string } | null }}
 */
function orgaStatus(event, signups = [], { now = Date.now() } = {}) {
    const ev = event || {};
    const out = (status, detail) => ({ status, label: LABELS[status], detail, link: LINKS[status] });
    if (ev.status === "cancelled") return out("cancelled", (ev.cancel && ev.cancel.reason) || "");

    const signed = plural(accountCount(signups), "Anmeldung", "Anmeldungen");
    const summary = setupSummary(ev);
    const phase = setupPhase(summary, ev.setupPost);
    const size = Number(ev.size) || 0;

    if (phase === "none") {
        const deadline = Number(ev.signupDeadline) || 0;
        const running = !ev.signupsClosed && !(deadline && deadline * 1000 <= now) && (Number(ev.startTime) || 0) * 1000 - now > SOON_MS;
        if (running) return out("signup", deadline ? `${signed} · Anmeldeschluss ${shortDay(deadline)}` : signed);
        return out("open", `${signed} · noch niemand im Setup`);
    }

    const placed = ofSize(summary.placed, size);
    if (phase === "draft") return out("draft", `${signed} · ${placed} im Setup`);

    const gone = cancelledAfterApproval(ev, signups);
    if (phase === "changed" || gone) {
        const parts = [
            phase === "changed" ? "Änderung nicht gepostet" : "",
            gone ? plural(gone, "Absage nach der Freigabe", "Absagen nach der Freigabe") : "",
        ].filter(Boolean);
        return out("changed", parts.join(" · "));
    }
    if (phase === "approved") return out("approved", `${placed} im Setup · nicht gepostet`);
    if (phase === "outdated") return out("approved", `Stand ${summary.version} nicht gepostet`);

    // posted: how many of the posted lineup confirmed
    const approved = approvedSetupOf(ev);
    const lineup = approved ? (approved.groups || []).reduce((n, g) => n + (g.slots || []).length, 0) : summary.placed;
    const confirmed = Object.values(confirmationsFor(ev, approved)).filter((s) => s === "confirmed").length;
    return out("posted", `${ofSize(confirmed, lineup)} bestätigt`);
}

/** How many raids per status, in STATUSES order, only the non-zero ones: `[{ status, count, label }]`. */
function statusCounts(statuses) {
    const counts = new Map();
    for (const s of statuses || []) counts.set(s, (counts.get(s) || 0) + 1);
    return STATUSES.filter((s) => counts.get(s)).map((s) => {
        const n = counts.get(s);
        return { status: s, count: n, label: `${n} ${COUNT_LABELS[s][n === 1 ? 0 : 1]}` };
    });
}

module.exports = { orgaStatus, statusCounts, cancelledAfterApproval, STATUSES, LABELS, SOON_MS };
