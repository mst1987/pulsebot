// "Event verwalten" (#288): the pure rules behind the raid detail's actions
// menu and its dialogs — which entries the menu shows, how a move preview and
// a cancellation read, how the raider picker filters. No React in here, and
// strippable (one-line signatures, no types inside bodies), so
// test/web-client/eventManage.test.js runs it for real.
import type { ManageCandidates, ManageDeletion, ManageRaider, ManageSpec, MovePlan, SignupStatus } from "../api";

export type ManageAction = "edit" | "move" | "signups" | "raider" | "ping" | "setup" | "history" | "cancel" | "reopen" | "delete"
    | "notify" | "sheet" | "softres" | "invite";
export type ManageMenuEntry = { id: ManageAction; label: string; icon: string; sub: string; danger: boolean } | "sep";
/**
 * `softres` false = the raid's loot system has no softres list (Loot-Council, …): no menu entry for it.
 * `invite` = an approved setup exists, so "Invite callen" has groups to ping.
 */
export type ManageState = { cancelled: boolean; signupsClosed: boolean; isPast: boolean; logCount: number; softres?: boolean; invite?: boolean };

function entry(id: ManageAction, label: string, icon: string, sub: string, danger: boolean): ManageMenuEntry {
    return { id, label, icon, sub, danger };
}

function sep(): ManageMenuEntry {
    return "sep";
}

/**
 * The menu: few entries, one per action, the dangerous one last and apart.
 * A cancelled event offers nothing but taking it back, its history and deleting;
 * a raid that started can no longer be moved, closed, pinged or cancelled — only
 * deleted, with a confirmation (the dialog says what is lost).
 *
 * Since the step bar (#319) the menu holds the *rare* things. What belongs to a
 * step moved into that step's row — Bearbeiten, Fehlende pingen, Setup öffnen —
 * and what the old progress bar used to be the only way to (Anmelde-Aufruf,
 * Raidsheet, Softres) moved in here instead. „Anmeldung öffnen/schließen“
 * deliberately stays: it is a switch that has to be reachable in both
 * directions, while the step only offers closing in the moment it is due.
 */
export function manageMenu(state: ManageState): ManageMenuEntry[] {
    const history = entry("history", "Verlauf", "inv_misc_book_09", state.logCount ? `${state.logCount} Einträge — wer hat wann was geändert` : "Noch nichts geändert", false);
    const remove = entry("delete", "Löschen", "inv_misc_bone_humanskull_01", state.isPast ? "Mit Bestätigung — Anmeldungen und Anwesenheit gehen verloren" : "Event, Anmeldungen und Nachricht entfernen — der Kanal bleibt", true);
    if (state.cancelled) {
        return [
            entry("reopen", "Absage zurücknehmen", "spell_holy_divineintervention", "Anmeldung wieder offen; ein archivierter Kanal bleibt im Archiv", false),
            sep(),
            history,
            sep(),
            remove,
        ];
    }
    const out = [entry("raider", "Raider eintragen", "inv_misc_groupneedmore", "Jemanden an- oder austragen", false)];
    if (!state.isPast) {
        out.unshift(
            entry("move", "Verschieben", "inv_misc_pocketwatch_02", "Neuer Termin — der Kanal wird mit umbenannt", false),
            state.signupsClosed
                ? entry("signups", "Anmeldung öffnen", "inv_misc_note_02", "Raider können sich wieder anmelden", false)
                : entry("signups", "Anmeldung schließen", "inv_misc_note_02", "Nur noch Abmelden möglich; die Orga trägt weiter ein", false),
        );
    }
    out.push(sep());
    // Raid night: also after the start — the invite goes out right then.
    if (state.invite) out.push(entry("invite", "Invite callen", "spell_holy_prayerofspirit", "Gruppe 1–5 pingen: /w dein Charakter inv", false));
    if (!state.isPast) out.push(entry("notify", "Anmelde-Aufruf", "inv_letter_15", "Vorlage in den Kanal posten und Rollen pingen", false));
    out.push(entry("sheet", "Raidsheet", "inv_scroll_03", "Kopie der Vorlage füllen und posten", false));
    // Only where the loot system uses one; the chip in the head switches it on for this raid.
    if (state.softres !== false) out.push(entry("softres", "Softres-Liste", "inv_misc_ticket_tarot_madness", "Liste erstellen oder verlinken", false));
    out.push(sep(), history);
    out.push(sep());
    if (!state.isPast) out.push(entry("cancel", "Absagen", "ability_creature_cursed_02", "Mit Grund — DM an alle Angemeldeten", true));
    out.push(remove);
    return out;
}

/** "2026-09-24" and "19:30" of a start in Berlin time — what the move dialog starts from. */
export function berlinDateTime(startTime: number): { date: string; time: string } {
    if (!startTime) return { date: "", time: "" };
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(startTime * 1000));
    const at = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return { date: `${at.year}-${at.month}-${at.day}`, time: `${at.hour}:${at.minute}` };
}

/** The channel line of a move: what it will be called, and why. */
export function moveChannelText(plan: MovePlan, rename: boolean): { value: string; sub: string } {
    const ch = plan.channel;
    if (ch.rename && rename) return { value: `#${ch.next}`, sub: `statt #${ch.current}` };
    if (ch.rename) return { value: `#${ch.current}`, sub: "bleibt — Umbenennen ist ausgeschaltet" };
    return { value: `#${ch.current || "—"}`, sub: ch.reason || "Der Name bleibt." };
}

/** Who hears about a move: a post in the event channel, or nobody. */
export function moveNotifyText(recipients: number, notify: boolean): string {
    if (!recipients) return "Niemand angemeldet — kein Hinweis nötig.";
    if (!notify) return `Die ${recipients} Angemeldeten erfahren es nicht.`;
    return `Post im Event-Kanal, ${recipients} Angemeldete werden erwähnt.`;
}

/** What cancelling does, in one line for the dialog foot. */
export function cancelSummary(recipients: number, notify: boolean, archive: boolean): string {
    const parts = ["Nachricht wird als ABGESAGT markiert"];
    parts.push(notify && recipients ? `DM an ${recipients} Angemeldete` : "keine DM");
    if (archive) parts.push("Kanal ins Archiv");
    return parts.join(" · ");
}

/** A reason is required and goes to every raider — at least three characters. */
export function cancelReasonOk(reason: string): boolean {
    return reason.trim().length >= 3;
}

/** The raiders of the picker that match a search in their Discord name or a character. */
export function filterRaiders(raiders: ManageRaider[], query: string): ManageRaider[] {
    const q = query.trim().toLowerCase();
    if (!q) return raiders;
    return raiders.filter((r) => r.name.toLowerCase().includes(q) || r.characters.some((c) => c.name.toLowerCase().includes(q)));
}

/** The specs a new character of a class may sign up with; [] for no class. */
export function specsOfClass(candidates: ManageCandidates | null, classId: string): ManageSpec[] {
    const cls = candidates ? candidates.classes.find((c) => c.id === classId) : undefined;
    return cls ? cls.specs : [];
}

/** The statuses the orga may enter somebody with — signing off is "Austragen". */
export function orgaStatuses(): SignupStatus[] {
    return ["signed", "tentative", "late", "bench"];
}

/** Whether the add dialog has what the server needs. */
export function raiderInputOk(userId: string, character: string, spec: string): boolean {
    return !!userId && character.trim().length > 1 && !!spec;
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/**
 * What deleting takes along and what stays, as short lines for the dialog:
 * the signups (and with them a started raid's attendance), the posted messages —
 * while linked logs and loot keep the raid's name and stay.
 */
export function deleteLines(d: ManageDeletion): { gone: string[]; stays: string[] } {
    const gone = [d.signups ? plural(d.signups, "Anmeldung", "Anmeldungen") : "keine Anmeldungen"];
    if (d.started && d.signups) gone.push("die Anwesenheit dieses Raids");
    if (d.messages) gone.push(d.messages === 1 ? "die Nachricht im Kanal" : "Anmelde- und Setup-Nachricht im Kanal");
    const stays = [];
    if (d.logs) stays.push(plural(d.logs, "Log", "Logs"));
    if (d.loot) stays.push(plural(d.loot, "Loot-Eintrag", "Loot-Einträge"));
    return { gone, stays };
}

/** What pressing "Löschen" does, in one line for the dialog foot. */
export function deleteSummary(d: ManageDeletion, notify: boolean, archive: boolean): string {
    const parts = ["Event wird entfernt"];
    if (d.canNotify && notify && d.recipients) parts.push(`DM an ${d.recipients} Angemeldete`);
    parts.push(archive ? "Kanal ins Archiv" : "Kanal bleibt");
    return parts.join(" · ");
}

/** Whether "Löschen" may be pressed: a raid that already started wants the extra confirmation. */
export function deleteReady(d: ManageDeletion | null, confirmed: boolean): boolean {
    return !!d && (!d.started || confirmed);
}
