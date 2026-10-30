// The public page of an own event (#308, new look #908): `GET /e/<eventId>`,
// server-rendered like the report pages and reachable **without a login** — the
// link the bot puts under every signup message and the one a PuG raid is shared
// with, so anyone can look up when the raid is, who signed up and what the
// approved setup is, and sign up from here.
//
// ⚠️ The line this module holds: nothing personal leaves it. `publicEventView()`
// is the only thing the page renders from, and it carries exactly the fields of
// `VIEW_KEYS` — character name, spec and status, nothing else. Not in it, on
// purpose and guarded by test/web/pages/eventPublicPage.test.js:
//   · Discord user ids (and no Discord links at all — a visitor may not even be
//     on the server, and a link is an id); the leader is named by the character
//     of their own signup, never by their account
//   · comments, wishes and wish partners, "kann auch mit"
//   · anything from the raider profile (availability, gear, notes)
//   · a setup **draft** — only setupEditor.approvedSetupOf() is ever read, and
//     the approved snapshot's userIds and reasons are dropped here too
// Whoever adds a field adds it to VIEW_KEYS as well, or the test fails.
// Who looks at the page (logged in or not, on the PuG server or not) and the
// server invite are render options, never part of the view.
//
// The roster grouping is the signup message's (eventMessage.rosterEntries /
// classesOf / rosterCounts / messagePhase), so the page and the channel can
// never disagree about who stands where. The page speaks the event's language
// (its category's, services/discord/botLanguage.js `eventLang`).
//
// The look (#908) is Pilot C of the web admin (#870): calm and typographic, a
// detail page like Wowhead's or Raid-Helper's — one column, hierarchy through
// size and weight, lines instead of cards; the game version's colour is the
// only accent, the green "go" button the only coloured control.
const { rosterEntries, classesOf, messagePhase } = require("../../services/events/eventMessage");
const { roleCounts } = require("../../services/signups/signupService");
const { versionOfEvent } = require("../../services/versions/mainVersion");
const { categoryNameAt } = require("../../services/categories/categoryEras");
const { listKnownCategories } = require("../../services/categories/categoryNames");
const log = require("../../logger").child("eventPublicPage");
const { approvedSetupOf, benchPosted } = require("../../services/setup/setupCore");
const { getEvent } = require("../../stores/eventStore");
const { listSignups } = require("../../stores/signupStore");
const { getConfig } = require("../../stores/settingsStore");
const { instance } = require("../../config/gameVersions");
const { durationOf, eventEndTime } = require("../../utils/time");
const { wowIconUrl } = require("../../config/menu");
const { layout, esc, themeToggleBtn } = require("../report/render");
const { DISCORD_LOGO } = require("../report/layout");
// Times are written out in server time (a web page cannot render a Discord timestamp).
const { serverDateTime } = require("../../utils/time");
const { ROLE_LABELS, ROLE_LABELS_EN } = require("../../config/gameVersions/classes");
const { str, clip } = require("../../utils/text");
const { tr, specLabel, classLabel, normalizeLang, dateLocale } = require("../../utils/i18n/botText");
const { serverLang, eventLang } = require("../../services/discord/botLanguage");
const { signupEventIdOf, raidIndexOf } = require("../../utils/raidGroup");
const { groupSummary, groupPlaces } = require("../../services/events/raidGroup");
const { normalizeOverflow } = require("../../utils/signup/capacity");
const { openToAll } = require("../../services/signups/signupAccess");

// Every key the public payload may carry, at every level. The test walks the
// view against this list — a new personal field cannot slip in unnoticed.
const VIEW_KEYS = [
    "id", "title", "description", "startTime", "endTime", "durationMinutes",
    "signupDeadline", "size", "status", "phase", "cancelReason", "signupsClosed",
    "icsUrl", "signupUrl", "versionId",
    "raids", "counts", "classes", "other", "setup",
    // #908: PuG or guild raid, its category's name, the leader's character, the
    // seats and what happens when a raid with a limit is full
    "pug", "category", "leader", "places", "full", "overflow", "targets",
    // a raid group (#811): which raid this is and the links to the others
    "group", "count", "url", "current",
    // raids[]
    "label", "icon",
    // counts (targets: tank / healer / dps)
    "attending", "accounts", "tank", "healer", "dps", "tentative", "bench", "absence",
    // classes[] / other[] / setup groups
    "color", "members", "index", "groups", "approvedAt",
    // a member
    "character", "spec", "specLabel", "specIcon", "role",
];

// The single words of the page as de/en pairs.
const WORDS = {
    late: { de: "Spät", en: "Late" },
    tentative: { de: "Vielleicht", en: "Tentative" },
    bench: { de: "Bank", en: "Bench" },
    absence: { de: "Abgemeldet", en: "Absence" },
    other: { de: "Sonstige", en: "Other" },
    signups: { de: "Anmeldungen", en: "Signups" },
    deadline: { de: "Anmeldeschluss", en: "Signup deadline" },
    serverTime: { de: "Serverzeit", en: "server time" },
    guildRaid: { de: "Gilden-Raid", en: "Guild raid" },
    pugRaid: { de: "PuG-Raid", en: "PuG raid" },
    leader: { de: "Raidleitung", en: "Leader" },
    tank: { de: ["Tank", "Tanks"], en: ["Tank", "Tanks"] },
    healer: { de: ["Heiler", "Heiler"], en: ["Healer", "Healers"] },
};
const word = (lang, key) => WORDS[key][normalizeLang(lang)];

// The statuses below the class rows, in the order the message uses (their label: WORDS).
const OTHER_LINES = ["late", "tentative", "bench", "absence"];
// The notice a phase puts above the signup line (tone: the colour of its left rule).
const PHASE_NOTE = {
    cancelled: { label: "Cancelled.", tone: "high" },
    started: { label: "Raid in progress", tone: "muted" },
    closed: { label: "Signups closed", tone: "medium" },
    deadline: { label: "Signup deadline passed", tone: "medium" },
};
// A full raid by overflow mode (utils/signup/capacity.js): what a new signup
// gets. "none" (the default since #516) has no limit — the raid is never full,
// anyone may sign up and the orga adds raids when there are more (#811).
const FULL_NOTE = {
    waitlist: "The raid is full – new signups go to the waiting list.",
    refuse: "The raid is full – no new signups.",
};
/** A role's name in the language ("Heiler" / "Healer"). */
const roleLabel = (role, lang) => (normalizeLang(lang) === "en" ? ROLE_LABELS_EN : ROLE_LABELS)[role] || "";


/** A spec table of the event's rule set: key → { spec, class }. */
function specTable(event) {
    const table = new Map();
    for (const cls of classesOf(event)) {
        for (const spec of cls.specs) table.set(spec.key || `${cls.id}-${spec.id}`, { spec, cls });
    }
    return table;
}

/** One roster line, stripped to what the public may see. */
function member(entry, table, lang = "de") {
    const hit = table.get(entry.spec) || null;
    return {
        character: str(entry.character) || "?",
        spec: str(entry.spec),
        specLabel: hit ? specLabel(lang, hit.spec) : "",
        specIcon: (hit && hit.spec.icon) || "",
        role: str(entry.role),
    };
}

/** The leader's character: the first one of their own signup, "" without one (never their account). */
function leaderCharacter(event, entries) {
    const id = str(event.leaderId);
    if (!id) return "";
    const own = entries.find((e) => e.userId === id && e.status !== "absence" && str(e.character));
    return own ? str(own.character) : "";
}

/**
 * The role targets "Tanks 1/2 · Heiler 1/6 · DPS 0/17" from signupService.roleCounts().
 * null without a composition, and in a raid group (its counts are the whole
 * group's, the composition one raid's).
 */
function targetsOf(rc, grouped) {
    if (grouped || (!rc.tank.target && !rc.healer.target)) return null;
    return { tank: rc.tank.target, healer: rc.healer.target, dps: rc.dps.target };
}

/**
 * The phase the signup follows. In a raid group (#811) the raiders sign up at
 * its first raid, so that raid's phase decides — only a cancelled raid itself
 * says so; the first raid cancelled takes no signups (closed).
 */
function signupPhase(event, first, now) {
    if (event.status === "cancelled") return "cancelled";
    if (first === event) return messagePhase(event, now);
    const base = first.status === "cancelled" ? { ...first, status: "closed" } : first;
    return messagePhase(base, now);
}

/**
 * The viewer's own signup on the page: the first character of it (character and
 * spec in words), null when they are not signed up or signed off. Only the
 * character leaves here — the account id the lookup ran with stays behind.
 * @param {object} event   the displayed event (its rule set names the spec)
 * @param {object[]} signups the signups of the event's first raid
 * @param {string} userId  the viewer's Discord id
 */
function ownSignupOf(event, signups, userId, lang = "de") {
    const uid = str(userId);
    if (!uid) return null;
    const mine = rosterEntries((signups || []).filter((s) => s && String(s.userId) === uid))
        .filter((e) => e.status !== "absence" && str(e.character));
    if (!mine.length) return null;
    const m = member(mine[0], specTable(event), lang);
    return { character: m.character, specLabel: m.specLabel || roleLabel(m.role, lang) };
}

/**
 * What the public page shows — pure and deliberately narrow (see VIEW_KEYS).
 * @param {object} event   an eventStore event
 * @param {object[]} signups signupStore signups of that event
 * @param {{ now?: number, lang?: string, group?: object|null, pug?: boolean, places?: number, category?: string, signupEvent?: object|null }} [opts]
 *   `lang`: the labels' language (German by default); `pug`: an open category
 *   (signupAccess.openToAll); `places`: the seats of the raid group (its own size by default);
 *   `category`: the category's name for the breadcrumb; `signupEvent`: the raid
 *   the signup runs at — a group's first raid (#811), the event itself by default
 * @returns {object|null} null without an event
 */
function publicEventView(event, signups, { now = Date.now(), lang = "de", group = null, pug = false, places = 0, category = "", signupEvent = null } = {}) {
    if (!event || !event.id) return null;
    const first = signupEvent && signupEvent.id ? signupEvent : event;
    const list = (signups || []).filter((s) => s && s.userId);
    const entries = rosterEntries(list);
    const table = specTable(event);
    const rc = roleCounts(event, list);
    const phase = signupPhase(event, first, now);
    const toMember = (e) => member(e, table, lang);
    const size = Number(event.size) || 0;
    const seats = Number(places) || size;
    const groupInfo = groupView(event, group);
    // a limit only where the category has one: "none" takes every signup (#516)
    const overflow = normalizeOverflow(first.overflow);

    // The signed-up characters, one row per class of the rule set — the
    // message's order, so the page reads like the channel.
    const signed = entries.filter((e) => e.status === "signed").map(toMember);
    const classes = classesOf(event).map((cls) => {
        const keys = new Set(cls.specs.map((s) => s.key || `${cls.id}-${s.id}`));
        const members = signed.filter((m) => keys.has(m.spec)).sort((a, b) => a.character.localeCompare(b.character, "en"));
        return { id: cls.id, label: classLabel(lang, cls), color: cls.color || "", icon: cls.icon || "", members };
    }).filter((c) => c.members.length);
    // A spec the rule set does not know (a version changed under a stored
    // signup) would fall out of every class row — it gets its own.
    const placed = new Set(classes.flatMap((c) => c.members.map((m) => `${m.character}|${m.spec}`)));
    const rest = signed.filter((m) => !placed.has(`${m.character}|${m.spec}`));
    if (rest.length) classes.push({ id: "", label: word(lang, "other"), color: "", icon: "", members: rest });

    const other = OTHER_LINES.map((status) => ({
        id: status,
        label: word(lang, status),
        color: "",
        icon: "",
        members: entries.filter((e) => e.status === status).map(toMember),
    })).filter((o) => o.members.length);

    const approved = approvedSetupOf(event);
    const setup = approved ? {
        approvedAt: Number(approved.approvedAt) || 0,
        groups: (approved.groups || [])
            .filter((g) => (g.slots || []).length)
            .map((g) => ({ index: Number(g.index) || 0, members: (g.slots || []).map(toMember) })),
        // the bench only when the orga posted it with the setup (#517)
        bench: benchPosted(event) ? (approved.bench || []).map(toMember) : [],
    } : null;

    return {
        id: str(event.id),
        title: str(event.title) || "Raid",
        description: clip(str(event.description), 1500),
        startTime: Number(event.startTime) || 0,
        endTime: eventEndTime(event),
        durationMinutes: durationOf(event.durationMinutes),
        signupDeadline: Number(first.signupDeadline) || 0,
        size,
        versionId: str(event.versionId),
        status: event.status === "cancelled" ? "cancelled" : "active",
        signupsClosed: !!first.signupsClosed,
        cancelReason: clip(str(event.cancel && event.cancel.reason), 300),
        phase,
        pug: !!pug,
        category: clip(str(category), 100),
        leader: leaderCharacter(event, entries),
        places: seats,
        full: overflow !== "none" && seats > 0 && rc.attending >= seats,
        overflow,
        targets: targetsOf(rc, !!groupInfo),
        icsUrl: `/r/cal/${encodeURIComponent(event.id)}.ics`,
        // a raid of a group (#811): the raiders sign up at its first raid
        signupUrl: `/signups?event=${encodeURIComponent(signupEventIdOf(event))}`,
        group: groupInfo,
        raids: (event.instanceIds || []).map((id) => {
            const inst = instance(event.versionId, id);
            return { id: str(id), label: (inst && (inst.short || inst.name)) || str(id), icon: (inst && inst.icon) || "" };
        }),
        counts: {
            attending: rc.attending,
            // the single Discord accounts (#520) — "25 signed up", one number, never "x/25"
            accounts: rc.accounts,
            tank: rc.tank.n,
            healer: rc.healer.n,
            dps: rc.dps.n,
            tentative: rc.tentative,
            bench: rc.bench,
            absence: rc.absence,
        },
        classes,
        other,
        setup,
    };
}

/**
 * A raid group (#811) on the public page: which raid this is and the public
 * pages of the evening's other raids — titles and links only. null outside a group.
 */
function groupView(event, group) {
    if (!group || !Array.isArray(group.raids) || group.raids.length < 2) return null;
    return {
        index: raidIndexOf(event),
        count: group.raids.length,
        raids: group.raids.map((r) => ({
            id: str(r.id), title: str(r.title), index: Number(r.index) || 0,
            url: `/e/${encodeURIComponent(r.id)}`, current: String(r.id) === String(event.id),
        })),
    };
}

// ---- rendering --------------------------------------------------------------

// Tokens only (static/report.css + report-version.css): --accent is the game
// version's colour, --go the one coloured button. No pills, no cards, no tiles.
const PAGE_STYLE = `
  .ev-wrap { max-width:760px; margin:0 auto; padding:0 16px 48px; }
  .ev-bar { display:flex; align-items:center; gap:12px; padding:12px 0 10px; border-bottom:2px solid var(--accent); }
  .ev-crumb { flex:1; min-width:0; font-size:13px; color:var(--muted); overflow-wrap:anywhere; }
  .ev-crumb b { color:var(--text); font-weight:700; }
  .ev-crumb .sep { margin:0 6px; opacity:.6; }
  .ev-bar .theme-toggle { width:32px; height:32px; flex:0 0 auto; }
  .ev-head { margin:22px 0 4px; }
  .ev-title { font-size:26px; line-height:1.2; font-weight:800; letter-spacing:-.3px; margin:0 0 8px; overflow-wrap:anywhere; }
  .ev-when { margin:0; font-size:16px; }
  .ev-when b { font-weight:700; }
  .ev-when span { color:var(--muted); }
  .ev-meta { margin:6px 0 0; color:var(--muted); font-size:14px; display:flex; flex-wrap:wrap; align-items:center; gap:4px 0; }
  .ev-meta > span + span::before { content:"·"; margin:0 8px; opacity:.7; }
  .ev-meta img { width:18px; height:18px; border-radius:3px; vertical-align:-4px; margin-right:6px; }
  .ev-meta b { color:var(--text); font-weight:600; }
  .ev-group { margin:8px 0 0; font-size:13.5px; color:var(--muted); }
  .ev-group a { color:var(--text); }
  .ev-group a + a::before, .ev-group span + a::before, .ev-group a + span::before { content:""; }
  .ev-group .cur { color:var(--text); font-weight:700; }
  .ev-group > * + * { margin-left:10px; }
  .ev-note { margin:18px 0 0; padding:8px 12px; border-left:3px solid var(--line); background:var(--panel); font-size:14.5px; }
  .ev-note.high { border-left-color:var(--high); }
  .ev-note.high b { color:var(--high); }
  .ev-note.medium { border-left-color:var(--medium); }
  .ev-signup { margin:18px 0 0; padding:16px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
  .ev-count { font-size:15px; color:var(--muted); }
  .ev-count b { font-size:28px; font-weight:800; color:var(--text); margin-right:4px; font-variant-numeric:tabular-nums; }
  .ev-own { margin:12px 0 0; font-size:15px; font-weight:600; }
  .ev-roles { margin:4px 0 0; font-size:14px; font-variant-numeric:tabular-nums; }
  .ev-roles > span + span::before { content:"·"; margin:0 8px; color:var(--muted); }
  .ev-roles .low { color:var(--medium); }
  .ev-deadline { margin:4px 0 0; font-size:13.5px; color:var(--muted); }
  .ev-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px 18px; margin:14px 0 0; }
  .ev-go { display:inline-flex; align-items:center; gap:9px; padding:10px 18px; border-radius:8px; font-size:15px; font-weight:700;
    text-decoration:none; background:var(--go); color:var(--go-ink); border:1px solid var(--go); }
  .ev-go:hover { filter:brightness(1.08); }
  .ev-go svg { flex:0 0 auto; }
  .ev-ghost { display:inline-flex; align-items:center; gap:8px; padding:9px 16px; border-radius:8px; font-size:14px; font-weight:700;
    text-decoration:none; color:var(--text); border:1px solid var(--line); background:var(--panel2); }
  .ev-ghost:hover { border-color:var(--accent); }
  .ev-link { font-size:14px; color:var(--text); text-decoration:underline; text-decoration-color:var(--line); text-underline-offset:3px; }
  .ev-link:hover { text-decoration-color:var(--accent); }
  .ev-invite { margin:12px 0 0; font-size:14px; color:var(--muted); }
  .ev-invite p { margin:0 0 8px; color:var(--text); }
  .ev-desc { margin:18px 0 0; white-space:pre-wrap; font-size:15px; overflow-wrap:anywhere; }
  .ev-sec { font-size:17px; font-weight:800; margin:28px 0 6px; display:flex; align-items:baseline; gap:10px; }
  .ev-sec small { font-size:13px; font-weight:400; color:var(--muted); }
  .ev-rows { margin:0; }
  .ev-row { display:grid; grid-template-columns:150px 1fr; gap:4px 14px; padding:8px 0; border-bottom:1px solid var(--line-soft); }
  .ev-row dt { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:700; min-width:0; }
  .ev-row dt .cc { width:4px; align-self:stretch; min-height:16px; border-radius:2px; background:var(--line); box-shadow:inset 0 0 0 1px var(--line); flex:0 0 auto; }
  .ev-row dt .n { margin-left:auto; font-weight:400; color:var(--muted); font-size:13px; font-variant-numeric:tabular-nums; }
  .ev-row dd { margin:0; display:flex; flex-wrap:wrap; gap:4px 16px; font-size:14.5px; min-width:0; }
  .ev-m { display:inline-flex; align-items:center; gap:6px; min-width:0; overflow-wrap:anywhere; }
  .ev-m img { width:18px; height:18px; border-radius:3px; flex:0 0 auto; }
  .ev-m small { color:var(--muted); font-size:12.5px; }
  .ev-empty { color:var(--muted); font-size:14.5px; padding:8px 0; }
  .ev-foot { color:var(--muted); font-size:12.5px; margin:36px 0 0; text-align:center; }
  @media (max-width:560px) {
    .ev-title { font-size:22px; }
    .ev-row { grid-template-columns:1fr; }
    .ev-row dt .n { margin-left:0; }
    .ev-go { width:100%; justify-content:center; }
  }`;

// "Mi., 24. Sept. 2026, 19:30" / "Wed 24 Sep 2026, 19:30" — in server time (Europe/Berlin), 24 h.
const fmtDate = (seconds, lang = "de") => {
    const dt = serverDateTime(seconds);
    if (!dt) return "–";
    const de = dateLocale(lang) === "de";
    return dt.setLocale(dateLocale(lang)).toFormat(de ? "ccc, d. LLL yyyy, HH:mm" : "ccc d LLL yyyy, HH:mm");
};
const fmtTime = (seconds) => {
    const dt = serverDateTime(seconds);
    return dt ? dt.toFormat("HH:mm") : "–";
};

function icon(name, size = 20, title = "") {
    if (!name) return "";
    const tip = title ? ` title="${esc(title)}"` : "";
    return `<img src="${esc(wowIconUrl(name, size))}" alt="${esc(title)}"${tip} loading="lazy">`;
}

/** One character: spec icon (spec as tooltip) and name — the spec in words where there is no icon. */
function memberHtml(m, lang = "de") {
    const spec = m.specLabel || roleLabel(m.role, lang);
    if (m.specIcon) return `<span class="ev-m">${icon(m.specIcon, 18, spec)}${esc(m.character)}</span>`;
    return `<span class="ev-m">${esc(m.character)}${spec ? ` <small>${esc(spec)}</small>` : ""}</span>`;
}

/** One row of the roster: the class (its colour a thin rule) and its characters. */
function rowHtml(group, lang = "de") {
    const cc = group.color ? ` style="background:${esc(group.color)}"` : "";
    return `<div class="ev-row"><dt><i class="cc"${cc}></i>${esc(group.label)}<span class="n">${group.members.length}</span></dt>`
        + `<dd>${group.members.map((m) => memberHtml(m, lang)).join("")}</dd></div>`;
}

/**
 * "Tanks 1/2 · Heiler 1/6 · DPS 0/17", a role still short of its target in the
 * warning tone; without targets "1 Tank · 3 Heiler · 12 DPS" (the number with its word).
 */
function rolesHtml(view, lang) {
    const t = view.targets;
    const part = (key) => {
        const have = view.counts[key];
        const words = key === "dps" ? ["DPS", "DPS"] : word(lang, key);
        if (!t) return `<span>${esc(`${have} ${words[have === 1 ? 0 : 1]}`)}</span>`;
        const want = t[key];
        const low = want && have < want ? " class=\"low\"" : "";
        return `<span${low}>${esc(`${words[1]} ${have}/${want || "–"}`)}</span>`;
    };
    return `<div class="ev-roles">${part("tank")}${part("healer")}${part("dps")}</div>`;
}

/** The line "Raid 2 of 2 · Zul'Aman · Zul'Aman 2" with the other raids linked, "" outside a group. */
function groupHtml(view, lang) {
    if (!view.group) return "";
    const links = view.group.raids.map((r) => (r.current
        ? `<span class="cur">${esc(r.title)}</span>`
        : `<a href="${esc(r.url)}">${esc(r.title)}</a>`)).join("");
    return `<p class="ev-group"><span>${esc(tr(lang, "Raid {index} of {count}", { index: view.group.index, count: view.group.count }))}</span>${links}</p>`;
}

/** The notice above the signup block: the phase, else a full raid; "" when there is nothing to say. */
function noteHtml(view, lang) {
    const phase = PHASE_NOTE[view.phase];
    if (phase) {
        const reason = view.phase === "cancelled" && view.cancelReason ? ` ${esc(view.cancelReason)}` : "";
        return `<div class="ev-note ${phase.tone}"><b>${esc(tr(lang, phase.label))}</b>${reason}</div>`;
    }
    if (view.full && FULL_NOTE[view.overflow]) return `<div class="ev-note medium">${esc(tr(lang, FULL_NOTE[view.overflow]))}</div>`;
    return "";
}

/** Whether the page offers a signup: an open phase, and a full raid only when it still takes signups. */
const offersSignup = (view) => view.phase === "open" && !(view.full && view.overflow === "refuse");
// A signed-up raider may still change their signup (sign off, "Spät") after the
// deadline and once it was closed (signupService) — not once the raid began.
const CHANGE_PHASES = ["open", "deadline", "closed"];

/**
 * The sign-up control for the viewer: signed up already → "Du bist angemeldet
 * als …" and "Anmeldung ändern" (even when a full raid refuses new ones);
 * logged in → the signup in the menu; logged out → "Mit Discord anmelden",
 * back here afterwards. A PuG raid with an invite adds the way onto the PuG
 * server — as a notice with a button when the viewer is known not to be on it,
 * as a small line while that is unknown.
 */
function actionsHtml(view, lang, { viewer, loginUrl, inviteUrl }) {
    const loggedIn = !!(viewer && viewer.loggedIn);
    const isMember = viewer ? viewer.isMember : null;
    const own = loggedIn && viewer.own && viewer.own.character ? viewer.own : null;
    const cal = `<a class="ev-link" href="${esc(view.icsUrl)}">${esc(tr(lang, "Add to calendar"))}</a>`;
    if (own) {
        const line = own.specLabel
            ? tr(lang, "You are signed up as {character} ({spec})", { character: own.character, spec: own.specLabel })
            : tr(lang, "You are signed up as {character}", { character: own.character });
        const change = CHANGE_PHASES.includes(view.phase)
            ? `<a class="ev-go" href="${esc(view.signupUrl)}">${esc(tr(lang, "Change signup"))}</a>`
            : "";
        return `<p class="ev-own">${esc(line)}</p><div class="ev-actions">${change}${cal}</div>`;
    }
    let go = "";
    if (offersSignup(view)) {
        go = loggedIn
            ? `<a class="ev-go" href="${esc(view.signupUrl)}">${esc(tr(lang, "Sign up"))}</a>`
            : `<a class="ev-go" href="${esc(loginUrl)}">${DISCORD_LOGO}<span>${esc(tr(lang, "Sign up with Discord"))}</span></a>`;
    }
    let invite = "";
    if (view.pug && inviteUrl && offersSignup(view) && isMember !== true) {
        const join = `<a class="ev-ghost" href="${esc(inviteUrl)}" target="_blank" rel="noopener">${esc(tr(lang, "Join the PuG server"))}</a>`;
        invite = isMember === false
            ? `<div class="ev-invite"><p>${esc(tr(lang, "To sign up you need to be on the PuG server first."))}</p>${join}</div>`
            : `<div class="ev-invite">${esc(tr(lang, "Not on the PuG server yet?"))} <a class="ev-link" href="${esc(inviteUrl)}" target="_blank" rel="noopener">${esc(tr(lang, "Join the PuG server"))}</a></div>`;
    }
    return `<div class="ev-actions">${go}${cal}</div>${invite}`;
}

/**
 * The page body for a view, in `lang` (German by default).
 * @param {object} view publicEventView()
 * @param {{ lang?: string, viewer?: { loggedIn?: boolean, isMember?: boolean|null, own?: object|null }, loginUrl?: string, inviteUrl?: string }} [opts]
 *   `viewer`: who looks (isMember: on the PuG server — null while unknown;
 *   own: their signup, ownSignupOf() — never their id);
 *   `loginUrl`: the Discord login coming back here (built from the id by default);
 *   `inviteUrl`: the PuG server's invite, "" for none (#905)
 */
function renderPublicEventBody(view, { lang = "de", viewer = null, loginUrl = "", inviteUrl = "" } = {}) {
    const login = loginUrl || `/auth/login?returnTo=${encodeURIComponent(`/e/${view.id}`)}`;
    // the category's name ("PUG Raids TBC"), the kind of raid where it has none
    const kind = view.category || word(lang, view.pug ? "pugRaid" : "guildRaid");
    const raidNames = view.raids.map((r) => r.label).join(" + ");
    const crumb = `EventHelper<span class="sep">›</span>${esc(kind)}${raidNames ? `<span class="sep">›</span><b>${esc(raidNames)}</b>` : ""}`;

    const until = view.endTime ? ` ${tr(lang, "until {time} server time", { time: fmtTime(view.endTime) })}` : ` ${word(lang, "serverTime")}`;
    const meta = [
        ...view.raids.map((r) => `<span>${icon(r.icon, 18)}${esc(r.label)}</span>`),
        ...(view.size ? [`<span>${esc(tr(lang, "{size}-man", { size: view.size }))}</span>`] : []),
        ...(view.leader ? [`<span>${esc(word(lang, "leader"))} <b>${esc(view.leader)}</b></span>`] : []),
    ].join("");

    const deadline = view.signupDeadline && view.phase === "open"
        ? `<div class="ev-deadline">${esc(word(lang, "deadline"))} ${esc(fmtDate(view.signupDeadline, lang))}</div>`
        : "";
    const description = view.description ? `<p class="ev-desc">${esc(view.description)}</p>` : "";

    const roster = [...view.classes, ...view.other];
    const rosterHtml = roster.length
        ? `<dl class="ev-rows">${roster.map((g) => rowHtml(g, lang)).join("")}</dl>`
        : `<p class="ev-empty">${esc(tr(lang, "Nobody has signed up yet."))}</p>`;

    return `<div class="ev-bar"><nav class="ev-crumb">${crumb}</nav>${themeToggleBtn(normalizeLang(lang))}</div>
    <header class="ev-head">
      <h1 class="ev-title">${esc(view.title)}</h1>
      <p class="ev-when"><b>${esc(fmtDate(view.startTime, lang))}</b><span>${esc(until)}</span></p>
      ${meta ? `<p class="ev-meta">${meta}</p>` : ""}
      ${groupHtml(view, lang)}
    </header>
    ${noteHtml(view, lang)}
    <section class="ev-signup">
      <div class="ev-count"><b>${view.counts.accounts}</b> ${esc(tr(lang, "signed up"))}</div>
      ${rolesHtml(view, lang)}
      ${deadline}
      ${actionsHtml(view, lang, { viewer, loginUrl: login, inviteUrl })}
    </section>
    ${description}
    <h2 class="ev-sec">${esc(word(lang, "signups"))}</h2>
    ${rosterHtml}
    ${setupHtml(view, lang)}`;
}

/** The approved setup's rows, "" without one (`#setup`: the link of /e/<id>/comp). */
function setupHtml(view, lang) {
    if (!view.setup) return "";
    const rows = [
        ...view.setup.groups.map((g) => ({ label: tr(lang, "Group {index}", { index: g.index }), color: "", members: g.members })),
        ...(view.setup.bench.length ? [{ label: word(lang, "bench"), color: "", members: view.setup.bench }] : []),
    ];
    return `<h2 class="ev-sec" id="setup">Setup</h2><dl class="ev-rows">${rows.map((g) => rowHtml(g, lang)).join("")}</dl>`;
}

/**
 * The whole HTML page for a view, in `lang` (German by default), with the
 * render options of renderPublicEventBody(). `bare` because layout()'s own
 * footer says "Log-Check" — this page is not one.
 */
function renderPublicEventPage(view, { lang = "de", ...opts } = {}) {
    const body = `<div class="ev-wrap">
${renderPublicEventBody(view, { lang, ...opts })}
<footer class="ev-foot">${esc(tr(lang, "EventHelper · Public event view"))}</footer>
</div>`;
    // layout() is shared with the German report pages: the page's own language goes into <html lang>.
    return layout(`${view.title} · EventHelper`, body, { bare: true, extraStyle: PAGE_STYLE, version: view.versionId || "" }).replace("<html lang=\"de\"", `<html lang="${normalizeLang(lang)}"`);
}

/**
 * The page for an event id, read from the stores, in the event's language.
 * `null` for an unknown event (the route answers 404 then) — a Raid-Helper id
 * never resolves here.
 * @param {string} eventId
 * @param {{ now?: number, lang?: string, viewer?: { loggedIn?: boolean, isMember?: boolean|null, userId?: string }, loginUrl?: string, inviteUrl?: string }} [opts]
 *   see renderPublicEventBody(); `viewer.userId` (the session's Discord id) only
 *   looks up the viewer's own signup and is never rendered
 */
function renderEventPage(eventId, { now = Date.now(), lang: wanted = "", viewer = null, loginUrl = "", inviteUrl = "" } = {}) {
    const event = getEvent(eventId);
    // the event's language (its category's), unless the caller asks for one
    const lang = wanted || (event ? eventLang(event) : serverLang());
    if (!event) return null;
    const config = getConfig();
    const pug = openToAll(event.categoryId, { config, versionId: versionOfEvent(event, { config }) });
    // a raid of a group (#811): the signups, phase and limit of its first raid,
    // the seats of the whole group, and the links to the evening's other raids
    const firstId = signupEventIdOf(event);
    const first = (firstId !== event.id && getEvent(firstId)) || event;
    const signups = listSignups(firstId);
    const view = publicEventView(event, signups, {
        now, lang, group: groupSummary(event), pug, places: groupPlaces(event),
        category: categoryOf(event, config), signupEvent: first,
    });
    const { userId, ...shown } = viewer || {};
    const own = shown.loggedIn ? ownSignupOf(event, signups, userId, lang) : null;
    return renderPublicEventPage(view, { lang, viewer: viewer ? { ...shown, own } : null, loginUrl, inviteUrl });
}

/** The event's category name in its own section (#744), "" when unknown — the breadcrumb falls back then. */
function categoryOf(event, config) {
    if (!event.categoryId) return "";
    let live = "";
    try {
        const hit = listKnownCategories(event.guildId).find((c) => c.id === String(event.categoryId));
        live = (hit && hit.name) || "";
    } catch (err) {
        log.warn(`category name of ${event.id}: ${err.message}`);
    }
    return categoryNameAt(event.categoryId, event.startTime, live || event.categoryName || "", { config });
}

module.exports = { VIEW_KEYS, publicEventView, ownSignupOf, renderPublicEventBody, renderPublicEventPage, renderEventPage };
