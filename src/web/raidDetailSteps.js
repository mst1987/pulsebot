// The Raid-Detail page's progress bar: where a raid stands, as six steps
// (Anmeldung › Setup › Raidsheet › Softres › Loot › Logs). Each step is a figure,
// a status badge and the way into that part of the page at once, and the first
// step that is still open becomes the page head's one primary action.
//
// Derived on the server from the same payload the page already gets, so the bar
// and the primary action can never disagree, and so the rules are covered by
// plain Jest tests instead of living untested in TSX.

const LOOT_TOOL_LABELS = { gargul: "Gargul", rclc: "RCLootcouncil", manual: "Manuell" };
const SECTION_LABELS = { cla: "CLA", rpb: "RPB" };
const SECTIONS = ["cla", "rpb"];

/** "17.09." in the display time zone the rest of the menu uses. */
function shortDate(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });
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
 * All six steps plus which one is next and the primary action it implies.
 * Before the raid only the preparation steps can be "next"; once it started,
 * only loot and logs — nobody should be nudged to create a softres list for a
 * raid that is over.
 * @param {object} d the raid-detail payload (event, setup, eventSheet, sheetLink, …)
 * @returns {{ steps: object[], next: string, primary: object|null }}
 */
function raidSteps(d) {
    const steps = [signupStep(d), setupStep(d), sheetStep(d), softresStep(d), lootStep(d), logsStep(d)];
    const before = ["signup", "setup", "sheet", "softres"];
    const candidates = (d.event && d.event.isPast) ? ["loot", "logs"] : before;
    // A cancelled event (#288) has no next step to push.
    const cancelled = !!(d.event && d.event.status === "cancelled");
    const nextStep = cancelled ? null : steps.find((s) => candidates.includes(s.key) && !s.done) || null;
    for (const s of steps) s.next = !!nextStep && s.key === nextStep.key;
    return { steps, next: nextStep ? nextStep.key : "", primary: primaryFor(nextStep, d) };
}

module.exports = { raidSteps, roleSummary, firstOpenAnalysis };
