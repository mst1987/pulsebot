// The public page of an own event (#308): `GET /e/<eventId>`, server-rendered
// like the report pages and reachable **without a login** — the link the bot
// puts under every signup message, so anyone can look up when the raid is, who
// signed up and what the approved setup is without being let into the menu.
//
// ⚠️ The line this module holds: nothing personal leaves it. `publicEventView()`
// is the only thing the page renders from, and it carries exactly the fields of
// `VIEW_KEYS` — character name, spec and status, nothing else. Not in it, on
// purpose and guarded by test/web/pages/eventPublicPage.test.js:
//   · Discord user ids (and no Discord links at all — a visitor may not even be
//     on the server, and a link is an id)
//   · comments, wishes and wish partners, "kann auch mit"
//   · anything from the raider profile (availability, gear, notes)
//   · a setup **draft** — only setupEditor.approvedSetupOf() is ever read, and
//     the approved snapshot's userIds and reasons are dropped here too
// Whoever adds a field adds it to VIEW_KEYS as well, or the test fails.
//
// The roster grouping is the signup message's (eventMessage.rosterEntries /
// classesOf / rosterCounts / messagePhase), so the page and the channel can
// never disagree about who stands where.
const { rosterEntries, classesOf, rosterCounts, messagePhase } = require("../eventMessage");
const { approvedSetupOf } = require("../setupCore");
const { getEvent } = require("../../stores/eventStore");
const { listSignups } = require("../../stores/signupStore");
const { instance } = require("../../config/gameVersions");
const { clampDuration, eventEndTime } = require("../../utils/time");
const { wowIconUrl } = require("../../config/menu");
const { layout, esc } = require("../report/render");
// The page is for raiders, so it is in English like the bot's Discord texts;
// times are written out in server time (a web page cannot render a Discord timestamp).
const { serverDateTime } = require("../../utils/time");
const { ROLE_LABELS_EN } = require("../../config/gameVersions/classes");
const { str, clip } = require("../../utils/text");

// Every key the public payload may carry, at every level. The test walks the
// view against this list — a new personal field cannot slip in unnoticed.
const VIEW_KEYS = [
    "id", "title", "description", "startTime", "endTime", "durationMinutes",
    "signupDeadline", "size", "status", "phase", "cancelReason", "signupsClosed",
    "icsUrl", "signupUrl",
    "raids", "counts", "classes", "other", "setup",
    // raids[]
    "label", "icon",
    // counts
    "attending", "tank", "healer", "dps", "tentative", "bench", "absence",
    // classes[] / other[] / setup groups
    "color", "members", "index", "groups", "approvedAt",
    // a member
    "character", "spec", "specLabel", "specIcon", "role",
];

// The statuses below the class blocks, in the order the message uses.
const OTHER_LINES = [["late", "Late"], ["tentative", "Tentative"], ["bench", "Bench"], ["absence", "Absence"]];
const ROLE_LABEL = ROLE_LABELS_EN;
const PHASE_BADGE = {
    cancelled: { label: "Cancelled", tone: "high" },
    started: { label: "Raid in progress", tone: "muted" },
    closed: { label: "Signups closed", tone: "medium" },
    deadline: { label: "Signup deadline passed", tone: "medium" },
};


/** A spec table of the event's rule set: key → { spec, class }. */
function specTable(event) {
    const table = new Map();
    for (const cls of classesOf(event)) {
        for (const spec of cls.specs) table.set(spec.key || `${cls.id}-${spec.id}`, { spec, cls });
    }
    return table;
}

/** One roster line, stripped to what the public may see. */
function member(entry, table) {
    const hit = table.get(entry.spec) || null;
    return {
        character: str(entry.character) || "?",
        spec: str(entry.spec),
        specLabel: (hit && (hit.spec.labelEn || hit.spec.label)) || "",
        specIcon: (hit && hit.spec.icon) || "",
        role: str(entry.role),
    };
}

/**
 * What the public page shows — pure and deliberately narrow (see VIEW_KEYS).
 * @param {object} event   an eventStore event
 * @param {object[]} signups signupStore signups of that event
 * @param {{ now?: number }} [opts]
 * @returns {object|null} null without an event
 */
function publicEventView(event, signups, { now = Date.now() } = {}) {
    if (!event || !event.id) return null;
    const list = (signups || []).filter((s) => s && s.userId);
    const entries = rosterEntries(list);
    const table = specTable(event);
    const counts = rosterCounts(list);
    const phase = messagePhase(event, now);

    // The signed-up characters, one block per class of the rule set — the
    // message's order, so the page reads like the channel.
    const signed = entries.filter((e) => e.status === "signed").map((e) => member(e, table));
    const classes = classesOf(event).map((cls) => {
        const keys = new Set(cls.specs.map((s) => s.key || `${cls.id}-${s.id}`));
        const members = signed.filter((m) => keys.has(m.spec)).sort((a, b) => a.character.localeCompare(b.character, "en"));
        return { id: cls.id, label: cls.labelEn || cls.label, color: cls.color || "", icon: cls.icon || "", members };
    }).filter((c) => c.members.length);
    // A spec the rule set does not know (a version changed under a stored
    // signup) would fall out of every class block — it gets its own.
    const placed = new Set(classes.flatMap((c) => c.members.map((m) => `${m.character}|${m.spec}`)));
    const rest = signed.filter((m) => !placed.has(`${m.character}|${m.spec}`));
    if (rest.length) classes.push({ id: "", label: "Other", color: "", icon: "", members: rest });

    const other = OTHER_LINES.map(([status, label]) => ({
        id: status,
        label,
        color: "",
        icon: "",
        members: entries.filter((e) => e.status === status).map((e) => member(e, table)),
    })).filter((o) => o.members.length);

    const approved = approvedSetupOf(event);
    const setup = approved ? {
        approvedAt: Number(approved.approvedAt) || 0,
        groups: (approved.groups || [])
            .filter((g) => (g.slots || []).length)
            .map((g) => ({ index: Number(g.index) || 0, members: (g.slots || []).map((s) => member(s, table)) })),
        bench: (approved.bench || []).map((b) => member(b, table)),
    } : null;

    return {
        id: str(event.id),
        title: str(event.title) || "Raid",
        description: clip(str(event.description), 1500),
        startTime: Number(event.startTime) || 0,
        endTime: eventEndTime(event),
        durationMinutes: clampDuration(event.durationMinutes),
        signupDeadline: Number(event.signupDeadline) || 0,
        size: Number(event.size) || 0,
        status: event.status === "cancelled" ? "cancelled" : "active",
        signupsClosed: !!event.signupsClosed,
        cancelReason: clip(str(event.cancel && event.cancel.reason), 300),
        phase,
        icsUrl: `/r/cal/${encodeURIComponent(event.id)}.ics`,
        signupUrl: `/signups?event=${encodeURIComponent(event.id)}`,
        raids: (event.instanceIds || []).map((id) => {
            const inst = instance(event.versionId, id);
            return { id: str(id), label: (inst && (inst.short || inst.name)) || str(id), icon: (inst && inst.icon) || "" };
        }),
        counts: {
            attending: counts.attending,
            tank: counts.tank,
            healer: counts.healer,
            dps: counts.dps,
            tentative: counts.tentative,
            bench: counts.bench,
            absence: counts.absence,
        },
        classes,
        other,
        setup,
    };
}

// ---- rendering --------------------------------------------------------------

const PAGE_STYLE = `
  .ev-head { margin:22px 0 18px; }
  .ev-kicker { font-family:var(--font-mono); font-size:11px; text-transform:uppercase; letter-spacing:1.3px; color:var(--muted); }
  .ev-title { font-size:30px; font-weight:800; letter-spacing:-.4px; margin:6px 0 10px; }
  .ev-badges { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .ev-badge { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line); border-radius:20px;
    padding:3px 11px; font-size:13px; font-weight:600; background:var(--panel2); color:var(--muted); }
  .ev-badge.high { color:var(--high); border-color:rgba(224,82,79,.45); background:var(--high-bg); }
  .ev-badge.medium { color:var(--medium); border-color:rgba(224,162,58,.45); background:var(--medium-bg); }
  .ev-badge img { width:18px; height:18px; border-radius:4px; }
  .ev-facts { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin:18px 0; }
  .ev-fact { background:var(--panel); border:1px solid var(--line); padding:12px 14px;
    clip-path:polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%); }
  .ev-fact .kicker { display:block; margin-bottom:4px; }
  .ev-fact b { font-size:19px; font-weight:800; display:block; line-height:1.25; }
  .ev-fact span { color:var(--muted); font-size:12.5px; }
  .ev-desc { background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--accent);
    padding:12px 14px; margin:0 0 18px; white-space:pre-wrap; font-size:14.5px; }
  .ev-actions { display:flex; flex-wrap:wrap; gap:10px; margin:0 0 22px; }
  .ev-btn { display:inline-flex; align-items:center; gap:8px; padding:8px 14px; border-radius:8px; font-size:14px;
    font-weight:700; text-decoration:none; border:1px solid var(--line); background:var(--panel2); color:var(--text); }
  .ev-btn.primary { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
  .ev-btn:hover { border-color:var(--accent); }
  .ev-sec { font-size:16px; font-weight:800; margin:24px 0 10px; }
  .ev-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:12px; }
  .ev-block { background:var(--panel); border:1px solid var(--line); border-top:3px solid var(--cc,var(--line)); padding:10px 12px; }
  .ev-block h3 { margin:0 0 8px; font-size:14px; display:flex; align-items:center; gap:8px; }
  .ev-block h3 img { width:20px; height:20px; border-radius:4px; }
  .ev-block h3 .n { margin-left:auto; color:var(--muted); font-family:var(--font-mono); font-size:12.5px; }
  .ev-list { list-style:none; margin:0; padding:0; }
  .ev-list li { display:flex; align-items:center; gap:8px; padding:4px 0; font-size:14px; }
  .ev-list li img { width:18px; height:18px; border-radius:3px; flex:0 0 auto; }
  .ev-list li b { font-weight:700; }
  .ev-list li span { color:var(--muted); font-size:12.5px; margin-left:auto; }
  .ev-foot { color:var(--muted); font-size:12.5px; margin:28px 0 0; }`;

// "Wed 24 Sep 2026, 19:30" — English, in server time (Europe/Berlin), 24 h.
const fmtDate = (seconds) => {
    const dt = serverDateTime(seconds);
    return dt ? dt.toFormat("ccc d LLL yyyy, HH:mm") : "–";
};
const fmtTime = (seconds) => {
    const dt = serverDateTime(seconds);
    return dt ? dt.toFormat("HH:mm") : "–";
};

function icon(name, size = 20) {
    return name ? `<img src="${esc(wowIconUrl(name, size))}" alt="" loading="lazy">` : "";
}

function memberLine(m) {
    const right = m.specLabel || ROLE_LABEL[m.role] || "";
    return `<li>${icon(m.specIcon, 18)}<b>${esc(m.character)}</b>${right ? `<span>${esc(right)}</span>` : ""}</li>`;
}

function block(group) {
    const color = group.color ? ` style="--cc:${esc(group.color)}"` : "";
    return `<div class="ev-block"${color}>
      <h3>${icon(group.icon)}${esc(group.label)}<span class="n">${group.members.length}</span></h3>
      <ul class="ev-list">${group.members.map(memberLine).join("")}</ul>
    </div>`;
}

/** The page body for a view (the `<div class="wrap">` content of layout()). */
function renderPublicEventBody(view) {
    const phase = PHASE_BADGE[view.phase];
    const badges = [
        ...(phase ? [`<span class="ev-badge ${phase.tone === "high" ? "high" : phase.tone === "medium" ? "medium" : ""}">${esc(phase.label)}</span>`] : []),
        ...view.raids.map((r) => `<span class="ev-badge">${icon(r.icon, 18)}${esc(r.label)}</span>`),
        ...(view.size ? [`<span class="ev-badge">${view.size}-man</span>`] : []),
    ].join("");

    const facts = [
        { kicker: "Date · server time", value: fmtDate(view.startTime), sub: view.endTime ? `until ${fmtTime(view.endTime)} server time` : "server time" },
        {
            kicker: "Signed up",
            value: `${view.counts.attending}${view.size ? ` / ${view.size}` : ""}`,
            sub: `${view.counts.tank} ${view.counts.tank === 1 ? "Tank" : "Tanks"} · ${view.counts.healer} ${view.counts.healer === 1 ? "Healer" : "Healers"} · ${view.counts.dps} DPS`,
        },
        {
            kicker: "Signup deadline",
            value: view.signupDeadline ? fmtDate(view.signupDeadline) : "none",
            sub: view.signupsClosed ? "Signups closed" : (view.signupDeadline ? "server time" : ""),
        },
    ].map((f) => `<div class="ev-fact"><span class="kicker">${esc(f.kicker)}</span><b>${esc(f.value)}</b>${f.sub ? `<span>${esc(f.sub)}</span>` : ""}</div>`).join("");

    const cancelled = view.status === "cancelled"
        ? `<div class="ev-desc" style="border-left-color:var(--high)"><strong>Cancelled.</strong>${view.cancelReason ? ` ${esc(view.cancelReason)}` : ""}</div>`
        : "";
    const description = view.description ? `<div class="ev-desc">${esc(view.description)}</div>` : "";

    const roster = [...view.classes, ...view.other];
    const rosterHtml = roster.length
        ? `<div class="ev-grid">${roster.map(block).join("")}</div>`
        : "<div class=\"empty\">Nobody has signed up yet.</div>";

    const setup = view.setup
        ? `<h2 class="ev-sec">Setup</h2><div class="ev-grid">${[
            ...view.setup.groups.map((g) => block({ id: "", label: `Group ${g.index}`, color: "", icon: "", members: g.members })),
            ...(view.setup.bench.length ? [block({ id: "", label: "Bench", color: "", icon: "", members: view.setup.bench })] : []),
        ].join("")}</div>`
        : "";

    return `<div class="ev-head">
      <div class="ev-kicker">Guild raid</div>
      <h1 class="ev-title">${esc(view.title)}</h1>
      <div class="ev-badges">${badges}</div>
    </div>
    ${cancelled}
    <div class="ev-facts">${facts}</div>
    ${description}
    <div class="ev-actions">
      <a class="ev-btn primary" href="${esc(view.icsUrl)}">Add to calendar</a>
      <a class="ev-btn" href="${esc(view.signupUrl)}">Sign up in the menu</a>
    </div>
    <h2 class="ev-sec">Signups</h2>
    ${rosterHtml}
    ${setup}
    <p class="ev-foot">Public view – no login needed. Sign up in Discord or in the menu.</p>`;
}

/**
 * The whole HTML page for a view. `bare` because layout()'s own footer says
 * "Log-Check" — this page is not one.
 */
function renderPublicEventPage(view) {
    const body = `<div class="wrap">
${renderPublicEventBody(view)}
<footer>EventHelper · Public event view</footer>
</div>`;
    // layout() is shared with the German report pages; this one page is English.
    return layout(`${view.title} · EventHelper`, body, { bare: true, extraStyle: PAGE_STYLE }).replace("<html lang=\"de\">", "<html lang=\"en\">");
}

/**
 * The page for an event id, read from the stores. `null` for an unknown event
 * (the route answers 404 then) — a Raid-Helper id never resolves here.
 */
function renderEventPage(eventId, { now = Date.now() } = {}) {
    const event = getEvent(eventId);
    if (!event) return null;
    return renderPublicEventPage(publicEventView(event, listSignups(event.id), { now }));
}

module.exports = { VIEW_KEYS, publicEventView, renderPublicEventBody, renderPublicEventPage, renderEventPage };
