// The Raid-Detail page's progress bar: where a raid stands, as six steps
// (Anmeldung › Setup › Raidsheet › Softres › Loot › Logs). Each step is a figure,
// a status badge and the way into that part of the page at once, and the first
// step that is still open becomes the page head's one primary action.
//
// Derived on the server from the same payload the page already gets, so the bar
// and the primary action can never disagree, and so the rules are covered by
// plain Jest tests instead of living untested in TSX.

const { plural } = require("../../utils/text");
const { TIMEZONE } = require("../../config/timezone");

const LOOT_TOOL_LABELS = { gargul: "Gargul", rclc: "RCLootcouncil", manual: "Manuell" };
const SECTION_LABELS = { cla: "CLA", rpb: "RPB" };
const SECTIONS = ["cla", "rpb"];

/** "17.09." in the display time zone the rest of the menu uses. */
function shortDate(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString("de-DE", { timeZone: TIMEZONE, day: "2-digit", month: "2-digit" });
}

/**
 * What a locally saved roster/raidplan is called: for a finished raid it is the
 * state of the raid day, for an upcoming one only the last state we saw.
 */
function savedLabel(ev) {
    return ev && ev.isPast ? "Stand vom Raidtag" : "gespeicherter Stand";
}

/** "3 T · 6 H · 16 DD" from buildSetupView()'s roleCounts. */
function roleSummary(roleCounts = {}) {
    const tanks = roleCounts.tank || 0;
    const healers = roleCounts.healer || 0;
    const dps = (roleCounts.melee || 0) + (roleCounts.ranged || 0) + (roleCounts.dps || 0);
    return `${tanks} T · ${healers} H · ${dps} DD`;
}

/** The loot tool most rows of this raid came from. */
function mainLootSource(items) {
    const counts = new Map();
    for (const it of items) counts.set(it.source, (counts.get(it.source) || 0) + 1);
    let best = "";
    let bestN = 0;
    for (const [src, n] of counts) if (n > bestN) { best = src; bestN = n; }
    return LOOT_TOOL_LABELS[best] || best || "";
}

function signupStep(d) {
    const ev = d.event || {};
    const known = ev.signupsKnown !== false;
    const signups = Number(ev.signupCount) || 0;
    const target = Number(d.signupTarget) || 0;
    const missing = ((d.attendance && d.attendance.missing) || []).length;
    const step = {
        key: "signup", label: "Anmeldung", icon: "inv_letter_15", open: { modal: "notify" },
        value: known ? String(signups) : "—", unit: known && target ? `/ ${target}` : "",
        fill: known && target ? Math.min(1, signups / target) : null,
        done: !known || signups > 0 || !!ev.isPast,
    };
    if (!known) {
        return { ...step, tone: "none", badge: { label: "unbekannt" }, tip: { head: "Anmeldung · nicht mehr bekannt", sub: "Raid-Helper liefert für diesen vergangenen Raid keine Anmeldungen mehr, und es wurde keine gespeichert." } };
    }
    // Event verwalten (#288): a cancelled event and a closed signup say so on the step.
    if (ev.status === "cancelled") {
        return { ...step, done: true, tone: "bad", badge: { label: "abgesagt", tone: "bad" }, tip: { head: "Anmeldung · abgesagt", sub: ev.cancelReason ? `Grund: ${ev.cancelReason}` : "Das Event wurde abgesagt." } };
    }
    if (ev.signupsClosed) {
        return { ...step, done: true, tone: "mid", badge: { label: "geschlossen", tone: "mid" }, tip: { head: `Anmeldung · ${signups}${target ? ` von ${target}` : ""} · geschlossen`, sub: "Nur noch Abmelden möglich; die Orga trägt über „Verwalten“ weiter ein." } };
    }
    const saved = savedLabel(ev);
    const sub = ev.signUpsFromSnapshot ? `${saved} (lokal gespeichert).` : "Klick öffnet den Anmelde-Aufruf.";
    if (target && signups >= target) {
        return { ...step, tone: "ok", badge: { label: "vollständig", tone: "ok" }, tip: { head: `Anmeldung · ${signups} von ${target}`, sub } };
    }
    if (!ev.isPast && missing > 0) {
        return { ...step, tone: "mid", badge: { label: `${missing} ohne Reaktion`, tone: "mid" }, tip: { head: `Anmeldung · ${signups}${target ? ` von ${target}` : ""}`, sub: `${missing} Raider mit Raider-Rolle haben noch nicht reagiert. ${sub}` } };
    }
    return {
        ...step,
        tone: signups ? "ok" : "none",
        badge: ev.signUpsFromSnapshot ? { label: saved } : { label: signups ? "läuft" : "offen", tone: signups ? "ok" : undefined },
        tip: { head: `Anmeldung · ${signups}${target ? ` von ${target}` : ""}`, sub },
    };
}

/** An event of the EventHelper's own store: no Raid-Helper raidplan to link to. */
function isOwnEvent(d) {
    return !!(d && d.event && d.event.source === "eventhelper");
}

/**
 * The setup step of an own event (#263): the editor's state — no proposal yet,
 * a draft, changed since the approval, or approved. Only an approval counts as
 * done: raiders see nothing before it.
 */
function ownSetupStep(d) {
    const s = d.ownSetup || null;
    const ev = d.event || {};
    const step = { key: "setup", label: "Setup", icon: "inv_misc_map_01", open: { tab: "setup" } };
    if (!s || !s.placed) {
        return {
            ...step, done: false, tone: ev.isPast ? "none" : "mid", value: "—", unit: "",
            badge: { label: "kein Vorschlag" },
            tip: { head: "Setup · noch kein Vorschlag", sub: "Dieses Event wird im EventHelper geplant. Klick öffnet den Setup-Editor: vorschlagen, anpassen, freigeben." },
        };
    }
    const unit = s.size ? `/ ${s.size}` : "";
    if (s.status === "approved") {
        return {
            ...step, done: true, tone: "ok", value: String(s.placed), unit,
            badge: { label: "freigegeben", tone: "ok" },
            tip: { head: `Setup · freigegeben (${s.placed}${s.size ? ` von ${s.size}` : ""})`, sub: "Raider sehen das Setup im Web, in der Event-Nachricht und im Bot." },
        };
    }
    const changed = s.changedSinceApproval;
    return {
        ...step, done: false, tone: "mid", value: String(s.placed), unit,
        badge: { label: changed ? "geändert seit Freigabe" : "Entwurf", tone: "mid" },
        tip: {
            head: `Setup · ${changed ? "geändert seit Freigabe" : "Entwurf"}`,
            sub: changed
                ? "Raider sehen weiter den zuletzt freigegebenen Stand, bis die Änderung freigegeben ist."
                : "Raider sehen noch nichts. Klick öffnet den Setup-Editor zum Prüfen und Freigeben.",
        },
    };
}

function setupStep(d) {
    if (isOwnEvent(d)) return ownSetupStep(d);
    const setup = d.setup;
    const total = (setup && setup.total) || 0;
    const step = { key: "setup", label: "Setup", icon: "inv_misc_map_01", open: { tab: "roster" }, done: total > 0 };
    if (d.setupError) {
        return { ...step, tone: "bad", value: "—", unit: "", badge: { label: "Fehler", tone: "bad" }, tip: { head: "Setup · nicht geladen", sub: d.setupError } };
    }
    if (!total) {
        const sub = "Im Raid-Helper ist für dieses Event noch kein Raidplan angelegt.";
        return { ...step, tone: "none", value: "—", unit: "", badge: { label: "kein Plan" }, tip: { head: "Setup · noch kein Raidplan", sub } };
    }
    const roles = roleSummary(setup.roleCounts);
    return {
        ...step,
        tone: "ok",
        value: String(total),
        unit: "im Plan",
        badge: d.setupFromSnapshot ? { label: savedLabel(d.event) } : { label: roles, tone: "ok" },
        tip: { head: `Setup · ${total} im Raidplan`, sub: d.setupFromSnapshot ? `${roles}. ${savedLabel(d.event)} – Raid-Helper liefert den Raidplan gerade nicht.` : `${roles}. Klick öffnet das Roster.` },
    };
}

function sheetStep(d) {
    const sheet = d.eventSheet || null;
    const link = d.sheetLink || null;
    const ev = d.event || {};
    const posted = !!(sheet && sheet.postedChannelId && sheet.postedMessageId);
    const step = { key: "sheet", label: "Raidsheet", icon: "inv_scroll_03", open: { modal: "sheet" }, done: !!link };
    if (!link) {
        const configured = (d.raidsheets || []).length > 0;
        return {
            ...step, tone: ev.isPast ? "none" : "mid", value: "Offen", unit: "",
            badge: configured ? { label: "offen" } : { label: "nicht eingerichtet" },
            tip: { head: "Raidsheet · noch keins", sub: configured ? "Klick öffnet „Raidsheet“: eine Kopie der Vorlage füllen und in den Channel posten." : "Es sind keine Raidsheet-Vorlagen eingerichtet (Einstellungen)." },
        };
    }
    const own = link.source === "event";
    const deleteAfter = own && sheet ? Number(sheet.deleteAfter) || 0 : 0;
    let badge;
    if (posted && !ev.isPast) badge = { label: "gepostet", tone: "ok" };
    else if (ev.isPast && deleteAfter) badge = { label: `löscht am ${shortDate(deleteAfter)}` };
    else if (posted) badge = { label: "gepostet", tone: "ok" };
    else badge = { label: "nicht gepostet", tone: "mid" };
    const origin = own ? "Für diesen Raid gefüllte Kopie der Vorlage." : `Festes Sheet der Kategorie${link.name ? `: ${link.name}` : ""}.`;
    const removal = deleteAfter ? ` Die Kopie wird am ${shortDate(deleteAfter)} automatisch gelöscht.` : "";
    return {
        ...step, tone: "ok", value: own ? "Gefüllt" : "Festes Sheet", unit: "", badge,
        tip: { head: `Raidsheet · ${own ? "gefüllt" : "festes Sheet"}`, sub: `${origin}${removal}` },
    };
}

function softresStep(d) {
    const so = d.eventSoftres || null;
    const ev = d.event || {};
    const step = { key: "softres", label: "Softres", icon: "inv_misc_ticket_tarot_madness", open: { modal: "softres" }, done: !!(so && so.url) };
    if (!so || !so.url) {
        return {
            ...step, tone: ev.isPast ? "none" : "mid", value: "Offen", unit: "", badge: { label: "offen" },
            tip: { head: "Softres · noch keine Liste", sub: "Klick öffnet „Softres-Liste erstellen“. Die Instanzen sind aus dem Titel vorausgewählt." },
        };
    }
    const posted = !!(so.postedChannelId && so.postedMessageId);
    const instances = (so.instances || []).length;
    return {
        ...step, tone: "ok", value: String(so.amount || 1), unit: "/ Spieler",
        badge: posted ? { label: "gepostet", tone: "ok" } : { label: "nicht gepostet", tone: "mid" },
        tip: { head: `Softres · ${so.amount || 1} pro Spieler`, sub: `${instances} Instanz${instances === 1 ? "" : "en"}${so.hardReserveCount ? ` · ${so.hardReserveCount} Hardreserve` : ""}. Klick öffnet die Liste zum Posten.` },
    };
}

function lootStep(d) {
    const items = d.lootItems || [];
    const ev = d.event || {};
    const step = { key: "loot", label: "Loot", icon: "inv_misc_bag_10", open: { tab: "loot" }, done: items.length > 0 };
    if (!items.length) {
        return {
            ...step, tone: ev.isPast ? "mid" : "none", value: "—", unit: "",
            badge: ev.isPast ? { label: "fehlt", tone: "mid" } : { label: "nach dem Raid" },
            tip: { head: "Loot · noch nichts importiert", sub: "Nach dem Raid den Gargul- oder RCLootcouncil-Export importieren." },
        };
    }
    const source = mainLootSource(items);
    const raiders = new Set(items.map((it) => String(it.character || "").toLowerCase())).size;
    return {
        ...step, tone: "ok", value: String(items.length), unit: "Items",
        badge: { label: source || "importiert", tone: "ok" },
        tip: { head: `Loot · ${items.length} Items an ${raiders} Raider`, sub: source ? `Überwiegend aus ${source}.` : "" },
    };
}

/** The first analysis a log still lacks, as { log, section }, or null. */
function firstOpenAnalysis(logs) {
    for (const l of logs) {
        const done = l.sections || [];
        for (const s of SECTIONS) if (!done.includes(s)) return { log: l, section: s };
    }
    return null;
}

function logsStep(d) {
    const logs = d.eventLogs || [];
    const ev = d.event || {};
    const open = firstOpenAnalysis(logs);
    const step = { key: "logs", label: "Logs", icon: "inv_misc_pocketwatch_01", open: { tab: "logs" }, done: logs.length > 0 && !open };
    if (!logs.length) {
        return {
            ...step, tone: ev.isPast ? "mid" : "none", value: "—", unit: "",
            badge: ev.isPast ? { label: "kein Log", tone: "mid" } : { label: "nach dem Raid" },
            tip: { head: "Logs · noch keins zugeordnet", sub: "Ein erkanntes Log oder einen Warcraft-Logs-Link diesem Raid zuordnen." },
        };
    }
    const missing = new Set();
    for (const l of logs) for (const s of SECTIONS) if (!(l.sections || []).includes(s)) missing.add(s);
    const badge = !missing.size
        ? { label: "ausgewertet", tone: "ok" }
        : { label: `${[...missing].map((s) => SECTION_LABELS[s]).join(" · ")} offen`, tone: "mid" };
    return {
        ...step, tone: missing.size ? "mid" : "ok", value: String(logs.length), unit: logs.length === 1 ? "Log" : "Logs", badge,
        tip: { head: `Logs · ${logs.length} zugeordnet`, sub: missing.size ? "CLA prüft Gear, Consumables und Buffs, RPB Schaden, Tode, Aktivität und Cooldowns." : "Alle Auswertungen liegen vor." },
    };
}

/** The head's primary action for the step that is next, or null. */
function primaryFor(step, d) {
    if (!step) return null;
    switch (step.key) {
        case "signup": return { label: "Anmelde-Aufruf posten", icon: "inv_letter_15", modal: "notify" };
        // The raidplan link only exists at Raid-Helper; an own event opens its setup editor.
        case "setup": return isOwnEvent(d)
            ? { label: d.ownSetup && d.ownSetup.placed ? "Setup freigeben" : "Setup vorschlagen", icon: "inv_misc_map_01", tab: "setup" }
            :{ label: "Raidplan öffnen", icon: "inv_misc_map_01", href: `https://raid-helper.xyz/raidplan/${(d.event || {}).id || ""}` };
        case "sheet": return { label: "Raidsheet füllen", icon: "inv_scroll_03", modal: "sheet" };
        case "softres": return { label: "Softres erstellen", icon: "inv_misc_ticket_tarot_madness", modal: "softres" };
        case "loot": return { label: "Loot hinzufügen", icon: "inv_misc_bag_10", modal: "loot" };
        case "logs": {
            const open = firstOpenAnalysis(d.eventLogs || []);
            if (!open) return { label: "Log zuordnen", icon: "inv_misc_pocketwatch_01", modal: "log" };
            return { label: `${SECTION_LABELS[open.section]} auswerten`, icon: "inv_misc_pocketwatch_01", evaluate: { logId: open.log.id, section: open.section } };
        }
        default: return null;
    }
}

/**
 * Whether this raid gets a softres step at all: only when its loot system asks
 * for one (src/services/loot/lootSystem.js) — a Loot-Council raid is not nudged to
 * create a list it never uses. A payload without `lootSystem` keeps the step.
 */
function wantsSoftres(d) {
    return !(d && d.lootSystem) || d.lootSystem.softres !== false;
}

/**
 * All six steps (five without softres) plus which one is next and the primary
 * action it implies. Before the raid only the preparation steps can be "next";
 * once it started, only loot and logs — nobody should be nudged to create a
 * softres list for a raid that is over.
 * @param {object} d the raid-detail payload (event, setup, eventSheet, sheetLink, lootSystem, …)
 * @returns {{ steps: object[], next: string, primary: object|null }}
 */
function raidSteps(d) {
    const steps = [signupStep(d), setupStep(d), sheetStep(d), wantsSoftres(d) ? softresStep(d) : null, lootStep(d), logsStep(d)].filter(Boolean);
    const before = ["signup", "setup", "sheet", "softres"];
    const candidates = (d.event && d.event.isPast) ? ["loot", "logs"] : before;
    // A cancelled event (#288) has no next step to push.
    const cancelled = !!(d.event && d.event.status === "cancelled");
    const nextStep = cancelled ? null : steps.find((s) => candidates.includes(s.key) && !s.done) || null;
    for (const s of steps) s.next = !!nextStep && s.key === nextStep.key;
    return { steps, next: nextStep ? nextStep.key : "", primary: primaryFor(nextStep, d) };
}

module.exports = {
    raidSteps,
    // only for the tests (#424): not part of the module's API
    _internal: {
        roleSummary, firstOpenAnalysis,
    },
};

// ---------------------------------------------------------------------------
// Das Raid-Cockpit (#319): dieselbe Frage in fünf Schritten
// ---------------------------------------------------------------------------
// Ein Raid wohnt an sieben Stellen im Menü, die Frage der Orga ist aber immer
// dieselbe: was ist bei diesem Raid als Nächstes zu tun? eventSteps() beantwortet
// sie für ein *eigenes* Event als Strecke — Angelegt › Anmeldung › Setup ›
// Freigabe › Nachbereitung —, je Schritt ein Zustand, eine Zahl und höchstens
// eine Tat.
//
// Rein wie alles hier oben: keine Store- und keine Discord-Aufrufe, nur eine
// Funktion über das Detail-Payload, das die Seite ohnehin bekommt. Deshalb kann
// die Raid-Liste später dieselbe Antwort benutzen, und deshalb hängen die Regeln
// in plain Jest statt ungetestet im TSX.

/** Die fünf Zustände eines Schritts; der Client spiegelt sie in lib/raidSteps.ts. */
const STEP_STATES = ["done", "current", "todo", "skipped", "cancelled"];
/** Die Strecke, in ihrer Reihenfolge. */
const STEP_IDS = ["created", "signup", "setup", "approval", "after"];
/** Innerhalb der letzten Stunde vor dem Start kommt kein Setup mehr. */
const SKIP_WINDOW_MS = 60 * 60 * 1000;
/** Einen Platz im Raid belegt, wer „Dabei“ oder „Spät“ ist — wie rosterCounts(). */
const ATTENDING = ["signed", "late"];

/** "Mi 24.09. · 19:30 Uhr" einer Unix-Sekunde, in der Zeitzone des Menüs. */
function whenLabel(seconds) {
    if (!seconds) return "";
    const d = new Date(seconds * 1000);
    const day = d.toLocaleDateString("de-DE", { timeZone: TIMEZONE, weekday: "short", day: "2-digit", month: "2-digit" });
    const time = d.toLocaleTimeString("de-DE", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit" });
    return `${day} · ${time} Uhr`;
}

/** Eine Tat: ein Menü-Eintrag, ein Dialog, ein Tab oder eine Auswertung. */
function deed(id, label, icon, extra) {
    return { id, label, icon, ...extra };
}

/** Wie viele Anmeldungen welchen Standes — die eine Zählregel der Leiste. */
function signupCounts(d) {
    const rows = d.ownSignups || [];
    const by = (...st) => rows.filter((s) => st.includes(s.status)).length;
    return {
        attending: by(...ATTENDING),
        bench: by("bench"),
        tentative: by("tentative"),
        absence: by("absence"),
        total: rows.length,
    };
}

function createdStep(d) {
    const ev = d.event || {};
    const channel = ev.channelName || "";
    const where = channel ? `in #${channel}` : "in seinem Kanal";
    const when = ev.startTime ? ` und beginnt am ${whenLabel(ev.startTime)}` : "";
    return {
        id: "created", label: "Angelegt", icon: "inv_misc_note_05", state: "done", fill: null,
        value: channel ? `#${channel}` : "angelegt", unit: "", note: "",
        hint: `Das Event steht ${where}${when}. „Bearbeiten“ ändert Titel, Termin, Raid, Größe und Anmeldeschluss.`,
        action: deed("edit", "Bearbeiten", "inv_misc_note_05", { manage: "edit" }),
    };
}

function signupStepOwn(d, now) {
    const ev = d.event || {};
    const c = signupCounts(d);
    const size = Number(ev.size) || Number(d.signupTarget) || 0;
    const deadline = Number(ev.signupDeadline) || 0;
    const deadlinePassed = deadline > 0 && deadline * 1000 <= now;
    const missing = ((d.attendance && d.attendance.missing) || []).length;
    const notes = [];
    if (c.bench) notes.push(`${c.bench} auf der Warteliste`);
    if (c.tentative) notes.push(`${c.tentative}× vielleicht`);
    if (!notes.length && c.absence) notes.push(`${c.absence} abgemeldet`);
    const step = {
        id: "signup", label: "Anmeldung", icon: "inv_letter_15",
        value: String(c.attending), unit: size ? `/ ${size}` : "", note: notes.join(" · "),
        fill: size ? Math.min(1, c.attending / size) : null,
    };
    const closing = deadline ? `Anmeldeschluss ${whenLabel(deadline)}.` : "Kein Anmeldeschluss gesetzt.";
    // Fertig, wenn niemand mehr von selbst dazukommt: geschlossen oder Schluss vorbei.
    if (ev.signupsClosed) {
        return { ...step, state: "done", hint: `Die Anmeldung ist geschlossen — abmelden geht noch, eintragen darf die Orga. ${closing}`, action: null };
    }
    if (deadlinePassed || ev.isPast) {
        return { ...step, state: "done", hint: `${closing} Wer jetzt noch mitsoll, wird über „Verwalten › Raider eintragen“ eingetragen.`, action: null };
    }
    // Offen: die eine Tat richtet sich danach, woran es gerade hängt.
    let action;
    if (!c.total) action = deed("notify", "Anmelde-Aufruf posten", "inv_letter_15", { modal: "notify" });
    else if (missing) action = deed("ping", "Fehlende pingen", "spell_holy_borrowedtime", { modal: "ping" });
    else action = deed("signups", "Anmeldung schließen", "inv_misc_note_02", { manage: "signups" });
    const waiting = c.bench ? " Wer von der Warteliste nachrückt, entscheidest du im Setup." : "";
    const hint = missing
        ? `${plural(missing, "Raider hat", "Raider haben")} mit Raider-Rolle noch nicht reagiert. ${closing}`
        : `${closing}${waiting}`;
    return { ...step, state: "open", hint, action };
}

/**
 * Ein Raid ohne Setup ist ein normaler Raid, kein kaputter: ein PuG oder ein
 * spontaner Abend wird im Kanal geplant, nicht im Editor. Innerhalb der letzten
 * Stunde vor dem Start kommt keiner mehr — es sei denn, „Vorschlag bei
 * Anmeldeschluss“ ist an und der Raid hat noch nicht begonnen.
 */
function setupSkipped(d, now) {
    const ev = d.event || {};
    if (d.ownSetup && d.ownSetup.placed) return false;
    const startMs = (Number(ev.startTime) || 0) * 1000;
    if (!startMs) return false;
    if (startMs - now >= SKIP_WINDOW_MS) return false;
    return !ev.autoSuggest || !!ev.isPast;
}

function setupStepOwn(d, now) {
    const s = d.ownSetup || null;
    const ev = d.event || {};
    const size = Number(ev.size) || (s && Number(s.size)) || 0;
    const step = { id: "setup", label: "Setup", icon: "inv_misc_map_01", value: "—", unit: "", note: "", fill: null };
    const openEditor = deed("setup", "Setup öffnen", "inv_misc_map_01", { tab: "setup" });
    if (s && s.placed) {
        const checks = s.ok === false ? ", die Prüfung meldet noch etwas" : "";
        return {
            ...step, state: "done",
            value: String(s.placed), unit: size ? `/ ${size}` : "", note: s.bench ? `${s.bench} auf der Bank` : "verplant",
            fill: size ? Math.min(1, s.placed / size) : null,
            hint: `${s.placed}${size ? ` von ${size}` : ""} Plätzen sind eingeteilt${checks}. Klick öffnet den Setup-Editor.`,
            action: openEditor,
        };
    }
    if (setupSkipped(d, now)) {
        return {
            ...step, state: "skipped", note: "ohne Setup",
            hint: "Dieser Raid läuft ohne Setup — kein Vorschlag, keine Gruppen. Ein gewöhnlicher Fall (PuG, spontaner Abend), kein Fehler. Der Editor steht trotzdem offen.",
            action: openEditor,
        };
    }
    return {
        ...step, state: "open", note: ev.autoSuggest ? "Vorschlag bei Anmeldeschluss" : "",
        hint: ev.autoSuggest
            ? "Zum Anmeldeschluss legt der Bot von selbst einen Entwurf an. Vorher geht es von Hand: der Editor schlägt Gruppen vor, du verschiebst."
            : "Noch kein Vorschlag. Der Editor schlägt Gruppen aus den Anmeldungen vor; verschieben und fixieren geht danach.",
        action: deed("propose", "Setup vorschlagen", "inv_misc_map_01", { tab: "setup" }),
    };
}

/** "22 DMs" bzw. "20 DMs · 2 fehlgeschlagen" der geposteten Setup-Nachricht, oder "". */
function dmNote(post) {
    const dms = post && post.dms;
    if (!dms || !dms.total) return "";
    if (dms.failed) return `${dms.sent || 0} DMs · ${dms.failed} fehlgeschlagen`;
    return `${dms.sent || dms.total} DMs`;
}

function approvalStep(d, now) {
    const s = d.ownSetup || null;
    const post = d.ownSetupPost || null;
    const step = { id: "approval", label: "Freigabe", icon: "inv_misc_note_02", value: "—", unit: "", note: "", fill: null };
    if (!s || !s.placed) {
        // Ohne Setup gibt es nichts freizugeben — übersprungen, nicht offen.
        if (setupSkipped(d, now)) {
            return { ...step, state: "skipped", note: "ohne Setup", hint: "Ohne Setup gibt es nichts freizugeben. Raider sehen ihre Anmeldung, aber keine Gruppen.", action: null };
        }
        return { ...step, state: "todo", hint: "Erst ein Entwurf, dann die Freigabe. Bis dahin sehen Raider kein Setup — weder im Web noch in Discord.", action: null };
    }
    const approved = s.status === "approved" && !s.changedSinceApproval;
    const posted = !!(post && post.messageId);
    const outdated = approved && posted && Number(post.version) < Number(s.version || 0);
    if (approved) {
        const notes = [posted ? "gepostet" : "nicht gepostet", dmNote(post)].filter(Boolean);
        const dms = dmNote(post) ? ` ${dmNote(post)} sind raus.` : "";
        return {
            // „Stand 3“ statt „3 Stand“: die Zahl allein sagt hier nichts.
            ...step, state: "done", value: `Stand ${s.version || 1}`, unit: "", note: notes.join(" · "),
            hint: outdated
                ? `Freigegeben als Stand ${s.version}. Die Nachricht im Kanal zeigt noch Stand ${post.version} — „Setup posten“ bringt sie nach.`
                : `Freigegeben als Stand ${s.version}. Raider sehen die Gruppen im Web, in der Anmelde-Nachricht und im Bot.${dms}`,
            action: outdated ? deed("post", "Setup posten", "inv_letter_15", { tab: "setup" }) : null,
        };
    }
    if (d.event && d.event.isPast) {
        // Ein Entwurf, der nie freigegeben wurde, und der Raid ist gelaufen.
        return {
            ...step, state: "skipped", value: String(s.placed), unit: "im Entwurf", note: "nie freigegeben",
            hint: "Der Entwurf wurde nie freigegeben — die Raider haben ihn nie gesehen. Nach dem Raid ändert das nichts mehr.", action: null,
        };
    }
    return {
        ...step, state: "open", value: String(s.placed), unit: "im Entwurf",
        note: s.changedSinceApproval ? "geändert seit der Freigabe" : "Entwurf",
        hint: s.changedSinceApproval
            ? "Die Raider sehen noch den zuletzt freigegebenen Stand. Erst die Freigabe macht die Änderung sichtbar."
            : "Der Entwurf steht, freigegeben ist er nicht — Raider sehen noch nichts. Im Editor prüfen und freigeben.",
        action: deed("approve", "Setup freigeben", "inv_misc_note_02", { tab: "setup" }),
    };
}

function afterStep(d) {
    const logs = d.eventLogs || [];
    const loot = (d.lootItems || []).length;
    const open = firstOpenAnalysis(logs);
    const ev = d.event || {};
    const step = {
        id: "after", label: "Nachbereitung", icon: "inv_misc_pocketwatch_01", fill: null,
        value: logs.length ? String(logs.length) : "—",
        unit: logs.length ? (logs.length === 1 ? "Log" : "Logs") : "",
        note: loot ? plural(loot, "Item", "Items") : "kein Loot",
    };
    if (logs.length && !open && loot) {
        return { ...step, state: "done", hint: `Alles da: ${plural(logs.length, "Log", "Logs")} ausgewertet, ${plural(loot, "Item", "Items")} importiert.`, action: null };
    }
    if (!ev.isPast) {
        return { ...step, state: "todo", hint: "Nach dem Raid: das Log zuordnen und auswerten, den Loot-Export importieren.", action: null };
    }
    let action;
    let hint;
    if (!logs.length) {
        action = deed("log", "Log zuordnen", "inv_misc_pocketwatch_01", { modal: "log" });
        hint = "Noch kein Log zugeordnet. Ein erkanntes Log oder einen Warcraft-Logs-Link diesem Raid zuordnen.";
    } else if (open) {
        action = deed("evaluate", `${SECTION_LABELS[open.section]} auswerten`, "inv_misc_pocketwatch_01", { evaluate: { logId: open.log.id, section: open.section } });
        hint = `${SECTION_LABELS[open.section]} fehlt noch. CLA prüft Gear, Consumables und Buffs, RPB Schaden, Tode, Aktivität und Cooldowns.`;
    } else {
        action = deed("loot", "Loot importieren", "inv_misc_bag_10", { modal: "loot" });
        hint = "Die Auswertung liegt vor, der Loot fehlt. Gargul- oder RCLootcouncil-Export importieren.";
    }
    return { ...step, state: "open", hint, action };
}

/**
 * Die Strecke eines eigenen Events: fünf Schritte, der erste offene ist der
 * aktuelle und trägt die eine auffällige Tat. Jeder andere Schritt bleibt ruhig
 * — „später“ oder „übersprungen“, nie ein Fehler.
 * @param {object} d das Raid-Detail-Payload
 * @param {{ now?: number }} [opts] Testbarkeit: der Jetzt-Zeitpunkt in ms
 * @returns {{ steps: object[], current: string, action: object|null, cancelled: boolean, note: string }}
 */
function eventSteps(d, opts = {}) {
    const now = Number(opts.now) || Date.now();
    const ev = (d && d.event) || {};
    const steps = [createdStep(d), signupStepOwn(d, now), setupStepOwn(d, now), approvalStep(d, now), afterStep(d)];
    // Abgesagt: nur „abgesagt“ und der Weg zurück. Kein Schritt ist mehr offen.
    if (ev.status === "cancelled") {
        for (const s of steps) {
            s.state = "cancelled";
            s.action = null;
        }
        return {
            steps, current: "", cancelled: true,
            note: ev.cancelReason ? `Abgesagt: ${ev.cancelReason}` : "Abgesagt.",
            action: deed("reopen", "Absage zurücknehmen", "spell_holy_divineintervention", { manage: "reopen" }),
        };
    }
    // Vergangene Raids fangen bei der Nachbereitung an; vorher ist sie nur „später“.
    const candidates = ev.isPast ? ["after"] : ["signup", "setup", "approval"];
    const current = steps.find((s) => s.state === "open" && candidates.includes(s.id)) || null;
    for (const s of steps) {
        if (s.state !== "open") continue;
        s.state = current && s.id === current.id ? "current" : "todo";
    }
    return {
        steps, current: current ? current.id : "", cancelled: false,
        note: current ? "" : (ev.isPast ? "Nachbereitung erledigt." : "Alles erledigt, was vor dem Raid zu tun war."),
        action: current ? current.action : null,
    };
}

module.exports.eventSteps = eventSteps;
module.exports.STEP_STATES = STEP_STATES;
module.exports.STEP_IDS = STEP_IDS;
