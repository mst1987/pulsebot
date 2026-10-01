// Live in the Kaderplaner (docs/kaderplaner.md, "Live"): a line of a Kader's
// activity log as a sentence ("Kurt hat Seraphine ins vorläufige Roster
// geschoben"), the toast for what the others changed since the page's
// revision (one sentence for one change, a summary for several, a repeated
// edit only every two minutes), what the presence of the others says about a
// player, and the hint "inzwischen geändert" of an open dialog. Pure.
import type { KaderActivityItem, KaderActivityType, KaderData, KaderPresence, KaderPresenceSub, KaderView } from "../../api";
import { t } from "../../i18n";
import { nameOf, playerName } from "./model";

/** The line types an edit repeats quickly (the server folds them into one line, the toast says them once per REPEAT_MS). */
export const REPEATED: KaderActivityType[] = ["interview", "lead", "questions", "setups", "settings", "character"];
export const REPEAT_MS = 2 * 60 * 1000;
const STATES = ["pool", "selected", "provisional", "roster", "bench", "tentative"];

/** A person by id: the name the page knows, else the name their presence brought, else "Jemand". */
export function personName(view: KaderView, userId: string, fallback = ""): string {
    if (userId && view.names[userId]) return view.names[userId];
    return fallback || (userId ? userId : t("kader.live.someone"));
}

/** The player of a line, or "3 Spieler". */
function whoOf(view: KaderView, kader: KaderData, item: KaderActivityItem): string {
    if (item.count && item.count > 1) return t("kader.live.players", { count: item.count });
    if (item.playerId) return playerName(view, item.playerId, kader.players[item.playerId]);
    return "";
}

/** One line of the activity log as a sentence in the menu language. */
export function activityText(view: KaderView, kader: KaderData, item: KaderActivityItem): string {
    const by = nameOf(view, item.by);
    const who = whoOf(view, kader, item);
    switch (item.type) {
        case "state":
            return STATES.includes(item.to || "") ? t(`kader.live.state.${item.to}`, { by, who }) : t("kader.live.stateOther", { by, who });
        case "lead":
            if (!item.to) return t("kader.live.leadNone", { by, who });
            return item.to === item.by ? t("kader.live.leadSelf", { by, who }) : t("kader.live.lead", { by, who, lead: nameOf(view, item.to) });
        case "questions": {
            const q = item.questionId ? kader.questions.find((x) => x.id === item.questionId) : undefined;
            return q ? t("kader.live.question", { by, text: q.text }) : t("kader.live.questions", { by });
        }
        default:
            return t(`kader.live.${item.type}`, { by, who });
    }
}

/** "Lena", "Lena und Kurt", "Lena und 2 weitere". */
function namesText(names: string[]): string {
    if (names.length === 1) return names[0];
    if (names.length === 2) return t("kader.live.and", { a: names[0], b: names[1] });
    return t("kader.live.andOthers", { name: names[0], count: names.length - 1 });
}

/** The key under which a repeated edit counts as the same (one person, one thing). */
export const repeatKey = (item: KaderActivityItem): string => `${item.by}|${item.type}|${item.playerId || ""}|${item.questionId || ""}`;

/**
 * The toast for changes the page just learnt of: only the others' (own changes never toast), a repeated edit
 * (somebody typing in an interview) once per REPEAT_MS — `recent` remembers when each was last said. One change
 * is its sentence, several of one person "Lena hat 3 Änderungen gemacht", of several people "Lena und Kurt haben
 * 4 Änderungen gemacht". Null when there is nothing to say.
 */
export function liveToast(view: KaderView, kader: KaderData, changes: KaderActivityItem[], me: string, recent: Map<string, number>, now = Date.now()): string | null {
    const fresh = changes.filter((c) => {
        if (c.by === me) return false;
        if (!REPEATED.includes(c.type)) return true;
        const last = recent.get(repeatKey(c));
        return last === undefined || now - last >= REPEAT_MS;
    });
    for (const c of fresh) if (REPEATED.includes(c.type)) recent.set(repeatKey(c), now);
    if (!fresh.length) return null;
    if (fresh.length === 1) return activityText(view, kader, fresh[0]);
    const people = [...new Set(fresh.map((c) => c.by))];
    if (people.length === 1) return t("kader.live.summary", { by: nameOf(view, people[0]), count: fresh.length });
    return t("kader.live.summaryMany", { names: namesText(people.map((id) => nameOf(view, id))), count: fresh.length });
}

/** The others who have this player open — `what` narrows it to the interview, the drawer or the account dialog. */
export function presenceOn(presence: KaderPresence[], playerId: string, what: KaderPresence["what"][] = []): KaderPresence[] {
    if (!playerId) return [];
    return presence.filter((p) => p.playerId === playerId && (!what.length || what.includes(p.what)));
}

/**
 * What somebody else does with a player, in words: "Lena bearbeitet gerade dieses Gespräch", "… sieht sich das
 * gerade an". `also` for the same surface the reader has open ("bearbeitet gerade auch dieses Gespräch").
 */
export function presenceText(name: string, p: KaderPresence, also = false): string {
    if (p.what === "interview") {
        if (!p.edit) return t("kader.live.presence.interviewView", { name });
        return t(also ? "kader.live.presence.alsoInterviewEdit" : "kader.live.presence.interviewEdit", { name });
    }
    if (p.what === "account") {
        if (!p.edit) return t("kader.live.presence.accountView", { name });
        return t(also ? "kader.live.presence.alsoAccountEdit" : "kader.live.presence.accountEdit", { name });
    }
    return t("kader.live.presence.drawerView", { name });
}

/** The page somebody is on, in words ("Gespräche"). */
export function whereText(sub: KaderPresenceSub): string {
    return t(`kader.live.where.${sub || "pool"}`);
}

/** The tooltip of somebody present: "Kurt · gerade in Gespräche". */
export function presenceTip(name: string, p: KaderPresence): string {
    return t("kader.live.presence.where", { name, where: whereText(p.sub) });
}

/**
 * The newest line by somebody else after revision `rev` of one of `types` (and about `playerId` when given): an open
 * dialog's quiet hint "Kurt hat das inzwischen geändert". Null when nobody else changed it.
 */
export function changedSince(kader: KaderData, rev: number, me: string, types: KaderActivityType[], playerId = ""): KaderActivityItem | null {
    const log = kader.activity || [];
    for (let i = log.length - 1; i >= 0; i--) {
        const a = log[i];
        if (a.rev <= rev) break;
        if (a.by !== me && types.includes(a.type) && (!playerId || a.playerId === playerId)) return a;
    }
    return null;
}
