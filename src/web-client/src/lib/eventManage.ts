// "Event verwalten" (#288): the pure rules behind the raid detail's actions
// menu and its dialogs — which entries the menu shows, how a move preview and
// a cancellation read, how the raider picker filters. No React in here, and
// strippable (one-line signatures, no types inside bodies), so
// src/web-client/src/lib/eventManage.test.ts runs it for real.
import type { ManageCandidates, ManageDeletion, ManageRaider, ManageSpec, MovePlan, SignupStatus } from "../api";
import { t } from "../i18n";
import { DISPLAY_TZ } from "./format";

export type ManageAction = "edit" | "move" | "signups" | "raider" | "ping" | "setup" | "history" | "cancel" | "reopen" | "delete"
    | "notify" | "sheet" | "softres" | "invite" | "raidplanOn" | "raidplanOff";
export type ManageMenuEntry = { id: ManageAction; label: string; icon: string; sub: string; danger: boolean } | "sep";
/**
 * `softres` false = the raid's loot system has no softres list (Loot-Council, …): no menu entry for it.
 * `invite` = an approved setup exists, so "Invite callen" has groups to ping.
 */
export type ManageState = { cancelled: boolean; signupsClosed: boolean; isPast: boolean; logCount: number; softres?: boolean; invite?: boolean };
/**
 * A Raid-Helper event's menu (docs/raidplan.md, "Raid-Helper-Events"): only the raid plan switch. `disabled` = Raid-Helper is
 * switched off in the settings - the entry stays, its line says the plan works from the saved line-up only.
 */
export type RaidhelperManageState = { planEnabled: boolean; disabled: boolean };

/** The slim menu of a Raid-Helper event: switch its raid plan on, or (with a confirmation) off. */
export function raidhelperMenu(state: RaidhelperManageState): ManageMenuEntry[] {
    const note = state.disabled ? t("raidDetail.manage.raidplanDisabled") : "";
    if (state.planEnabled) return [entry("raidplanOff", t("raidDetail.manage.raidplanOff"), "inv_misc_map02", note || t("raidDetail.manage.raidplanOffSub"), false)];
    return [entry("raidplanOn", t("raidDetail.manage.raidplanOn"), "inv_misc_map02", note || t("raidDetail.manage.raidplanOnSub"), false)];
}

/** The instance chips and size a Raid-Helper event's activation dialog starts with: what the plan has, else what the title says. */
export function linkStart(link: { instanceIds: string[]; size: number } | null, suggestion: { instanceIds: string[]; size: number }): { instanceIds: string[]; size: number } {
    const from = link && link.instanceIds.length > 0 ? link : suggestion;
    return { instanceIds: from.instanceIds.slice(), size: from.size || 0 };
}

/** The sizes the dialog offers for the chosen instances (each instance's own), largest last; the default when nothing is chosen. */
export function linkSizes(instances: { id: string; sizes: number[] }[], chosen: string[]): number[] {
    return [...new Set(instances.filter((i) => chosen.includes(i.id)).flatMap((i) => i.sizes))].sort((a, b) => a - b);
}

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
    const history = entry("history", t("raidDetail.manage.history"), "inv_misc_book_09", state.logCount ? t("raidDetail.manage.historySub", { count: state.logCount }) : t("raidDetail.manage.historyEmpty"), false);
    const remove = entry("delete", t("raidDetail.manage.delete"), "inv_misc_bone_humanskull_01", state.isPast ? t("raidDetail.manage.deleteSubPast") : t("raidDetail.manage.deleteSub"), true);
    if (state.cancelled) {
        return [
            entry("reopen", t("raidDetail.manage.reopen"), "spell_holy_divineintervention", t("raidDetail.manage.reopenSub"), false),
            sep(),
            history,
            sep(),
            remove,
        ];
    }
    const out = [entry("raider", t("raidDetail.manage.raider"), "inv_misc_groupneedmore", t("raidDetail.manage.raiderSub"), false)];
    if (!state.isPast) {
        out.unshift(
            entry("move", t("raidDetail.manage.move"), "inv_misc_pocketwatch_02", t("raidDetail.manage.moveSub"), false),
            state.signupsClosed
                ? entry("signups", t("raidDetail.manage.signupsOpen"), "inv_misc_note_02", t("raidDetail.manage.signupsOpenSub"), false)
                : entry("signups", t("raidDetail.manage.signupsClose"), "inv_misc_note_02", t("raidDetail.manage.signupsCloseSub"), false),
        );
    }
    out.push(sep());
    // Raid night: also after the start — the invite goes out right then.
    if (state.invite) out.push(entry("invite", t("raidDetail.manage.invite"), "spell_holy_prayerofspirit", t("raidDetail.manage.inviteSub"), false));
    if (!state.isPast) out.push(entry("notify", t("raidDetail.manage.notify"), "inv_letter_15", t("raidDetail.manage.notifySub"), false));
    out.push(entry("sheet", t("raidDetail.manage.sheet"), "inv_scroll_03", t("raidDetail.manage.sheetSub"), false));
    // Only where the loot system uses one; the chip in the head switches it on for this raid.
    if (state.softres !== false) out.push(entry("softres", t("raidDetail.manage.softres"), "inv_misc_ticket_tarot_madness", t("raidDetail.manage.softresSub"), false));
    out.push(sep(), history);
    out.push(sep());
    if (!state.isPast) out.push(entry("cancel", t("raidDetail.manage.cancel"), "ability_creature_cursed_02", t("raidDetail.manage.cancelSub"), true));
    out.push(remove);
    return out;
}

/** "2026-09-24" and "19:30" of a start in Berlin time — what the move dialog starts from. */
export function berlinDateTime(startTime: number): { date: string; time: string } {
    if (!startTime) return { date: "", time: "" };
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(startTime * 1000));
    const at = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return { date: `${at.year}-${at.month}-${at.day}`, time: `${at.hour}:${at.minute}` };
}

/** The channel line of a move: what it will be called, and why. */
export function moveChannelText(plan: MovePlan, rename: boolean): { value: string; sub: string } {
    const ch = plan.channel;
    if (ch.rename && rename) return { value: `#${ch.next}`, sub: t("raidDetail.manage.channelInstead", { channel: ch.current }) };
    if (ch.rename) return { value: `#${ch.current}`, sub: t("raidDetail.manage.channelKept") };
    return { value: `#${ch.current || "—"}`, sub: ch.reason || t("raidDetail.manage.channelNameStays") };
}

/** Who hears about a move: a post in the event channel, or nobody. */
export function moveNotifyText(recipients: number, notify: boolean): string {
    if (!recipients) return t("raidDetail.manage.notifyNobody");
    if (!notify) return t("raidDetail.manage.notifySilent", { count: recipients });
    return t("raidDetail.manage.notifyPost", { count: recipients });
}

/** What cancelling does, in one line for the dialog foot. */
export function cancelSummary(recipients: number, notify: boolean, archive: boolean): string {
    const parts = [t("raidDetail.manage.cancelMarked")];
    parts.push(notify && recipients ? t("raidDetail.manage.dmTo", { count: recipients }) : t("raidDetail.manage.noDm"));
    if (archive) parts.push(t("raidDetail.manage.channelArchive"));
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

/**
 * What deleting takes along and what stays, as short lines for the dialog:
 * the signups (and with them a started raid's attendance), the posted messages —
 * while linked logs and loot keep the raid's name and stay.
 */
export function deleteLines(d: ManageDeletion): { gone: string[]; stays: string[] } {
    const gone = [d.signups ? t("raidDetail.manage.signups", { count: d.signups }) : t("raidDetail.manage.noSignups")];
    if (d.started && d.signups) gone.push(t("raidDetail.manage.attendance"));
    if (d.messages) gone.push(d.messages === 1 ? t("raidDetail.manage.messageOne") : t("raidDetail.manage.messageBoth"));
    const stays: string[] = [];
    if (d.logs) stays.push(t("raidDetail.manage.logs", { count: d.logs }));
    if (d.loot) stays.push(t("raidDetail.manage.loot", { count: d.loot }));
    return { gone, stays };
}

/** What pressing "Löschen" does, in one line for the dialog foot. */
export function deleteSummary(d: ManageDeletion, notify: boolean, archive: boolean): string {
    const parts = [t("raidDetail.manage.eventRemoved")];
    if (d.canNotify && notify && d.recipients) parts.push(t("raidDetail.manage.dmTo", { count: d.recipients }));
    parts.push(archive ? t("raidDetail.manage.channelArchive") : t("raidDetail.manage.channelStays"));
    return parts.join(" · ");
}

/** Whether "Löschen" may be pressed: a raid that already started wants the extra confirmation. */
export function deleteReady(d: ManageDeletion | null, confirmed: boolean): boolean {
    return !!d && (!d.started || confirmed);
}
