// Pure logic behind the start page ("Übersicht", design issue #220). The page
// answers one question — "what is coming up, what is open?" — so everything
// here turns data the bot already keeps into that answer: the next raid with its
// role fill, the open tasks, and one compact figure per admin area.
//
// No I/O in this file: dashboardData.js loads, this file decides. That keeps the
// rules (which task is shown when, how full a role is) testable without mocking
// Raid-Helper, Discord and five stores.
const { DateTime } = require("luxon");
const { contentsForText } = require("../config/tbcContent");
const { enrichSlot, CLASS_COLORS } = require("../utils/setupView");
const { signupStatus } = require("../utils/attendance");
const { plural } = require("../utils/text");
const { TIMEZONE } = require("../config/timezone");

// The boss icon a raid is recognised by — its final boss, the one the raid is
// named after in everyone's head. Names verified against the zamimg CDN; the
// Archimonde icon only exists with its trailing "-", Kael'thas needs the
// apostrophe (WowIcon encodes it).
const ZONE_ICONS = {
    kara: "achievement_boss_princemalchezaar_02",
    gruul: "achievement_boss_gruul",
    mag: "achievement_boss_magtheridon",
    ssc: "achievement_boss_ladyvashj",
    tk: "achievement_boss_kael'thassunstrider_01",
    za: "achievement_boss_zuljin",
    hyjal: "achievement_boss_archimonde-",
    bt: "achievement_boss_illidan",
    swp: "achievement_boss_kiljaedan",
};
/** A raid whose title names no known content: a generic raid head, never a wrong boss. */
const FALLBACK_ZONE_ICON = "inv_misc_head_dragon_01";

// Raids that are ten-man; every other TBC raid is 25.
const TEN_MAN = new Set(["kara", "za"]);

// The usual composition per raid size. The Raid-Helper setup has no "target"
// per role, and a setting per category would be one more list to maintain for a
// number that is the same for every 25-man raid — so the size decides.
const ROLE_TARGETS = {
    10: { tank: 2, healer: 3, dps: 5 },
    25: { tank: 3, healer: 6, dps: 16 },
};

const ROLES = [
    { key: "tank", label: "Tank", icon: "ability_warrior_defensivestance" },
    { key: "healer", label: "Heiler", icon: "spell_holy_flashheal" },
    { key: "dps", label: "DPS", icon: "inv_sword_39" },
];

const CLASS_LABELS = {
    Warrior: "Krieger", Paladin: "Paladin", Priest: "Priester", Shaman: "Schamane", Druid: "Druide",
    Mage: "Magier", Warlock: "Hexer", Hunter: "Jäger", Rogue: "Schurke", DK: "Todesritter",
};

// Statuses of a reaction that are not a plain "I'm there", as the modal words them.
const NOT_SIGNED = { tentative: "Tentative", bench: "Ersatzbank", absence: "Abwesend", none: "keine Antwort" };

/**
 * The content a raid title or zone names, and its icon. A combined night
 * ("Hyjal + BT") is shown with its newest content — CONTENTS order is release
 * order, so the last hit is the raid the night is built around.
 * @returns {{ contentId: string, icon: string }}
 */
function zoneFor(text) {
    const hits = contentsForText(text);
    const contentId = hits.length ? hits[hits.length - 1] : "";
    return { contentId, icon: ZONE_ICONS[contentId] || FALLBACK_ZONE_ICON };
}

/**
 * The content of one event: an own EventHelper event names its raids
 * (`instanceIds`, rule-set ids = tbcContent ids for TBC), so a title such as
 * "Mittwoch" still gets its boss icon (#291); the last known one wins like in
 * zoneFor(). Everything else — and an own event without a known raid — reads
 * the title.
 */
function zoneForEvent(ev) {
    const ids = (ev && ev.source === "eventhelper" && Array.isArray(ev.instanceIds)) ? ev.instanceIds : [];
    const order = Object.keys(ZONE_ICONS); // release order, like CONTENTS
    const known = ids.filter((id) => ZONE_ICONS[id]).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (known.length) {
        const contentId = known[known.length - 1];
        return { contentId, icon: ZONE_ICONS[contentId] };
    }
    return zoneFor(ev && ev.title);
}

/** The raid size a night is planned for: the softres list's size wins, else the content, else 25. */
function raidSize(contentId, softresSize = 0) {
    if (softresSize > 0) return softresSize <= 10 ? 10 : 25;
    return TEN_MAN.has(contentId) ? 10 : 25;
}

/** tank / healer / dps for one Raid-Helper spec (or a raidplan slot's spec). */
function roleBucket(entry) {
    const roleName = String((entry && entry.roleName) || "").toLowerCase();
    if (roleName.startsWith("tank")) return "tank";
    if (roleName.startsWith("heal")) return "healer";
    const role = enrichSlot({ name: "-", specName: (entry && entry.specName) || "" }).role;
    return role === "tank" || role === "healer" ? role : "dps";
}

/** A signup that says "I'm coming" (a late one included). */
function isAttending(signUp) {
    const status = signupStatus(signUp);
    return status === "signed" || status === "late";
}

/** { tank, healer, dps } counted over entries (signups or raidplan slots). */
function countRoles(entries) {
    const counts = { tank: 0, healer: 0, dps: 0 };
    for (const e of entries || []) counts[roleBucket(e)] += 1;
    return counts;
}

/**
 * The three role bars: filled from the raidplan when one is built (that is who
 * actually goes), from the attending signups otherwise; target from the size —
 * or from an own event's planned composition ({ tank, healer }), the damage
 * dealers taking what is left of the size.
 */
function roleFill({ setupSlots = [], signUps = [], size = 25, composition = null }) {
    const slots = (setupSlots || []).filter((s) => s && (s.name || s.charName || s.characterName));
    const counts = slots.length
        ? countRoles(slots.map((s) => ({ specName: s.specName || s.spec || s.className })))
        : countRoles((signUps || []).filter(isAttending));
    const targets = composition
        ? { tank: composition.tank || 0, healer: composition.healer || 0, dps: Math.max(0, size - (composition.tank || 0) - (composition.healer || 0)) }
        : (ROLE_TARGETS[size] || ROLE_TARGETS[25]);
    return ROLES.map((r) => ({ ...r, filled: counts[r.key], target: targets[r.key] }));
}

/** Attending signups per WoW class, biggest first — the modal's class grid. */
function classCounts(signUps) {
    const byClass = new Map();
    for (const s of (signUps || []).filter(isAttending)) {
        const cls = enrichSlot({ name: "-", specName: s.specName || "" }).className;
        if (!cls) continue;
        byClass.set(cls, (byClass.get(cls) || 0) + 1);
    }
    return [...byClass.entries()]
        .map(([className, count]) => ({
            className,
            label: CLASS_LABELS[className] || className,
            classColor: CLASS_COLORS[className] || "",
            icon: `classicon_${className === "DK" ? "deathknight" : className.toLowerCase()}`,
            count,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The raiders of a category who have not said "I'm coming": no answer, tentative, bench or absent. */
function notSignedUp({ missing = [], responded = [], specHistory = {} }) {
    const row = (m, status) => {
        const spec = specHistory[m.id] || "";
        const profile = m.profile || null;
        return {
            id: m.id,
            name: m.character || m.displayName || "",
            className: (profile && profile.className) || "",
            classColor: (profile && profile.classColor) || "",
            role: spec ? ROLES.find((r) => r.key === roleBucket({ specName: spec })).label : "",
            status,
            statusLabel: NOT_SIGNED[status],
        };
    };
    const order = { tentative: 0, none: 1, bench: 2, absence: 3 };
    return [
        ...(missing || []).map((m) => row(m, "none")),
        ...(responded || []).filter((m) => NOT_SIGNED[m.status]).map((m) => row(m, m.status)),
    ].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}

/** How many recommendations of a report nobody has approved or rejected yet. */
function openRecommendations(reviewed) {
    if (!reviewed) return 0;
    const raid = (reviewed.raid || []).filter((i) => i.approved === null).length;
    const players = (reviewed.players || [])
        .reduce((n, p) => n + (p.items || []).filter((i) => i.approved === null).length, 0);
    return raid + players;
}

/**
 * The "Letzte Auswertung" tile: the one number (problems) plus what the tooltip
 * breaks it into. `report` is the full stored report, `summary` its listReports() row.
 */
function lastReportArea(summary, report) {
    if (!summary) return null;
    const r = report || {};
    const fights = (r.timeline && r.timeline.fights) || [];
    const rows = (r.bossUptimes && r.bossUptimes.rows) || [];
    const pulls = fights.length ? fights : rows;
    const bosses = fights.length
        ? new Set(fights.map((f) => f.encounterId || f.name)).size
        : rows.length;
    const deaths = r.mechanics && r.mechanics.deaths;
    const gear = (r.players || []).reduce((n, p) => n + (p.issues || []).length, 0);
    const consumables = ((r.consumables && r.consumables.players) || []).filter((p) => (p.buffed || 0) < 50).length;
    const buffs = ((r.raidBuffs && r.raidBuffs.players) || []).filter((p) => (p.missing || 0) > 0).length;
    return {
        id: summary.id,
        title: summary.title || "",
        zone: summary.zone || "",
        icon: zoneFor(`${summary.zone || ""} ${summary.title || ""}`).icon,
        generatedAt: summary.generatedAt || 0,
        bosses,
        kills: pulls.filter((f) => f.kill).length,
        deaths: deaths ? deaths.total || 0 : null,
        avoidableDeaths: deaths ? deaths.avoidable || 0 : null,
        gear,
        consumables,
        buffs,
        problems: gear + consumables + buffs,
    };
}

/** Top-item awards handed out since a raid started (with a few hours' slack for an early award). */
function newLootSince(awards, sinceMs) {
    if (!sinceMs) return 0;
    const from = sinceMs - 6 * 60 * 60 * 1000;
    return (awards || []).filter((a) => (Number(a.awardedAt) || 0) >= from).length;
}


/**
 * The open tasks, one row each and only when there is something to do. Every
 * task leads straight to where it is done; the tooltip says why it is open.
 *
 * @param {object} p
 * @param {object[]} p.nextRaids     from loadNextRaids(): { id, title, startTime, sheet }
 * @param {object[]} p.recentEvents  from loadRecentEvents(): { id, title, startTime, pendingLogCount }
 * @param {object|null} p.report     { id, title, zone, generatedAt, open } of the newest evaluation
 * @param {object[]} p.inbox         pending addon-inbox sessions ({ items })
 * @param {object|null} p.archive    { count, overdue, hintDays } of the channel archive (channelArchiveStore.archiveHint)
 * @param {object|null} p.roleDrift  from roleSync.loadDrift(): { groups, total }
 * @param {object[]} p.seriesFailures from eventSeries.seriesFailures(): { categoryId, categoryName, date, error }
 * @param {object|null} p.deploy     from deployStatus(): { status, behind, behindSince, short, … }
 */
function buildTasks({ nextRaids = [], recentEvents = [], report = null, inbox = [], archive = null, roleDrift = null, seriesFailures = [], deploy = null }) {
    const tasks = [];

    // First in the list: everything else on this page is about a version that
    // may not even be running (#314).
    const deployT = deployTask(deploy);
    if (deployT) tasks.push(deployT);

    const seriesTask = eventSeriesTask(seriesFailures);
    if (seriesTask) tasks.push(seriesTask);

    const noSheet = (nextRaids || []).filter((r) => !r.sheet);
    if (noSheet.length) {
        const first = noSheet[0];
        tasks.push({
            id: "sheet", tone: "bad", icon: "inv_misc_note_02", title: "Sheet füllen",
            ref: { title: first.title, at: (first.startTime || 0) * 1000 },
            count: noSheet.length > 1 ? noSheet.length : 0,
            href: `/raids/detail?event=${encodeURIComponent(first.id)}`,
            tip: noSheet.length > 1 ? `${noSheet.length} Raids ohne Raidsheet` : "Raidsheet fehlt",
            tipSub: "Für den Raid wurde noch kein Sheet gefüllt, und seiner Kategorie ist kein festes Sheet zugewiesen. Öffnet das Raid-Event.",
        });
    }

    if (report && report.open > 0) {
        tasks.push({
            id: "recommendations", tone: "mid", icon: "inv_scroll_03", title: "Empfehlungen prüfen",
            ref: { title: report.zone || report.title, at: report.generatedAt || 0 },
            count: report.open,
            href: `/r/${encodeURIComponent(report.id)}#raid`,
            tip: `${plural(report.open, "Empfehlung", "Empfehlungen")} ungeprüft`,
            tipSub: "Niemand hat sie freigegeben oder verworfen – erst freigegebene Punkte gehen an die Raider. Öffnet den Report in der Sicht Raid.",
        });
    }

    const pending = (recentEvents || []).filter((e) => (e.pendingLogCount || 0) > 0);
    if (pending.length) {
        const first = pending[0];
        const logs = pending.reduce((n, e) => n + e.pendingLogCount, 0);
        tasks.push({
            id: "logs", tone: "mid", icon: "inv_misc_pocketwatch_01", title: "Logs zuordnen",
            ref: { title: first.title, at: (first.startTime || 0) * 1000 },
            count: logs,
            href: `/raids/detail?event=${encodeURIComponent(first.id)}&tab=logs`,
            tip: `${plural(logs, "Log passt", "Logs passen")} zu mehreren Raids`,
            tipSub: "Zeitlich kommen mehrere Raids am selben Abend in Frage; die automatische Zuordnung hat keinen gewählt. Öffnet den Logs-Tab des Raids.",
        });
    }

    if ((inbox || []).length) {
        const items = inbox.reduce((n, s) => n + ((s && s.items) || []).length, 0);
        tasks.push({
            id: "inbox", tone: "accent", tile: "history", icon: "inv_misc_bag_10", title: "Addon-Inbox",
            ref: { text: `${plural(inbox.length, "Sitzung", "Sitzungen")} · ${items} Items` },
            count: inbox.length,
            href: "/history?tab=inbox",
            tip: "Hochgeladener Loot wartet",
            tipSub: "Das Addon hat Loot hochgeladen, der noch keinem Raid zugeordnet ist. Öffnet die Addon-Inbox unter Historie & Loot.",
        });
    }

    // Archived channels are never deleted automatically (issue #259) — the task
    // is the reminder. It turns yellow once one has waited past the deadline.
    if (archive && archive.count > 0) {
        const overdue = archive.overdue || 0;
        tasks.push({
            id: "channels", tone: overdue ? "mid" : "accent", tile: overdue ? "mid" : "channels", icon: "inv_letter_15",
            title: "Archivierte Kanäle löschen",
            ref: { text: overdue ? `${plural(overdue, "Kanal wartet", "Kanäle warten")} länger als ${archive.hintDays} Tage` : `${plural(archive.count, "Kanal wartet", "Kanäle warten")} auf Löschung` },
            count: archive.count,
            href: "/channels?tab=archive",
            tip: `${plural(archive.count, "archivierter Kanal wartet", "archivierte Kanäle warten")} auf Löschung`,
            tipSub: "Archivierte Kanäle werden nie automatisch gelöscht. Öffnet das Archiv der Kanäle-Seite, wo ein Admin sie löscht.",
        });
    }

    const driftTask = roleDriftTask(roleDrift);
    if (driftTask) tasks.push(driftTask);

    return tasks;
}

/**
 * "3 Mitglieder haben @Raider nur noch auf Pulse Talk" — the role sync only
 * adds roles, so someone who lost the source role keeps the synced one until a
 * person removes it in Discord. Null when nothing drifted.
 */
function roleDriftTask(roleDrift) {
    const groups = (roleDrift && roleDrift.groups) || [];
    const total = (roleDrift && roleDrift.total) || 0;
    if (!groups.length || !total) return null;
    const first = groups[0];
    const more = groups.length > 1 ? ` · +${groups.length - 1} ${groups.length === 2 ? "Rolle" : "Rollen"}` : "";
    return {
        id: "rolesync", tone: "mid", tile: "settings", icon: "inv_misc_groupneedmore", title: "Rollen prüfen",
        ref: { text: `${plural(first.members.length, "Mitglied hat", "Mitglieder haben")} @${first.roleName} nur noch auf ${first.guildName || "dem anderen Server"}${more}` },
        count: total,
        href: "/settings?section=discordserver",
        tip: `${plural(total, "Mitglied trägt", "Mitglieder tragen")} eine abgeglichene Rolle ohne ihre Ursprungsrolle`,
        tipSub: "Der Rollen-Abgleich vergibt nur und entfernt nie. Wer die Rolle auf einem Server verloren hat, behält sie auf dem anderen, bis jemand sie in Discord entfernt. Öffnet Einstellungen → Discord-Server.",
    };
}

/**
 * "Serie konnte Event nicht anlegen: fehlende Rechte" (#289) — a recurring
 * event whose date failed stays failed after a few attempts; the task says
 * which date and why, and leads to the series page where it is retried.
 */
function eventSeriesTask(failures) {
    const list = failures || [];
    if (!list.length) return null;
    const first = list[0];
    const day = DateTime.fromISO(first.date, { zone: TIMEZONE }).setLocale("de");
    const when = day.isValid ? day.toFormat("ccc dd.MM.") : first.date;
    // The reason's last part is short enough for the title ("fehlende Rechte"); the whole sentence goes into the tooltip.
    const reason = String(first.error || "").split(": ").pop();
    return {
        id: "series", tone: "bad", tile: "raids", icon: "spell_holy_borrowedtime",
        title: `Serie konnte Event nicht anlegen: ${reason}`,
        ref: { text: `${first.categoryName || "Kategorie"} · ${when}` },
        count: list.length > 1 ? list.length : 0,
        href: "/raids/series",
        tip: first.error || (list.length > 1 ? `${list.length} Termine von Serien fehlgeschlagen` : "Termin einer Serie fehlgeschlagen"),
        tipSub: "Die Serie hat das Event dieses Termins nicht anlegen können. Sie versucht es höchstens dreimal im Abstand von 10 Minuten, danach nur noch auf Knopfdruck. Öffnet Raid-Events › Serien mit Grund und „Erneut versuchen“.",
    };
}

// Where the deploy task leads: the written instructions, which live in the
// repository and are readable without a checkout. A menu page would be the
// wrong target — nothing in the menu can deploy.
const DEPLOY_GUIDE_URL = "https://github.com/mst1987/pulsebot/blob/main/docs/deployment.md";
// A day behind is worth a yellow line; a week means the deploy is broken, not slow.
const DEPLOY_RED_DAYS = 7;

/**
 * "Server ist 9 Commits hinter main (seit 6 Tagen)" (#314) — eight merged PRs
 * never reached the server because the deploy failed silently every time.
 *
 * Yellow from the first commit, red once the oldest missing commit is a week
 * old. Nothing at all when the server is current *or* when the comparison could
 * not be made: "nicht prüfbar" is a footnote in the menu, never a task — a task
 * nobody can close is noise.
 */
function deployTask(deploy, now = Date.now()) {
    if (!deploy || deploy.status !== "behind") return null;
    const behind = Number(deploy.behind) || 0;
    if (behind < 1) return null;
    const since = deploy.behindSince ? new Date(deploy.behindSince).getTime() : 0;
    const days = since ? Math.floor((now - since) / 86400000) : 0;
    const age = since ? ` (seit ${plural(days, "Tag", "Tagen")})` : "";
    const running = deploy.short ? `läuft auf ${deploy.short}` : "Stand unbekannt";
    return {
        id: "deploy", tone: days >= DEPLOY_RED_DAYS ? "bad" : "mid", tile: "settings",
        icon: "inv_misc_gear_02",
        title: `Server ist ${plural(behind, "Commit", "Commits")} hinter main${age}`,
        ref: { text: running + (deploy.latest && deploy.latest.short ? ` · main auf ${deploy.latest.short}` : "") },
        count: behind,
        href: DEPLOY_GUIDE_URL,
        tip: `${plural(behind, "Commit ist", "Commits sind")} auf main, aber nicht auf dem Server`,
        tipSub: "Das automatische Deployment hat den Stand nicht übernommen. Öffnet die Anleitung: welche Secrets es braucht und wie man von Hand deployt.",
    };
}

module.exports = {
    eventSeriesTask, deployTask, DEPLOY_GUIDE_URL, DEPLOY_RED_DAYS,
    ZONE_ICONS, FALLBACK_ZONE_ICON, ROLE_TARGETS, ROLES,
    zoneFor, zoneForEvent, raidSize, roleBucket, roleFill, classCounts, notSignedUp,
    openRecommendations, lastReportArea, newLootSince, buildTasks, roleDriftTask, isAttending,
};
