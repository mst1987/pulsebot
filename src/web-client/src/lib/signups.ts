// The vocabulary of the "Anmeldungen" page and its dialog (#256): the five
// statuses in the member's words, their colours (the --sig-* tokens of
// index.css), and the small rules the dialog applies before the server checks
// them again (src/web/signupService.js).
import type { GameRole, OwnSignupRow, SignupCounts, SignupProfile, SignupStatus } from "../api";
import type { Tone } from "../components/ui/Badge";
import { formatEventTime } from "./format";
import { t } from "../i18n";

/** In the order a member thinks about it: coming, maybe, late, bench, not coming. */
export const SIGNUP_STATUS_ORDER: SignupStatus[] = ["signed", "tentative", "late", "bench", "absence"];

/**
 * What one single character can be (#320): the same list without the absence —
 * signing off is for the person, not for one of their characters (the server's
 * CHARACTER_STATUSES in src/web/signupCharacters.js).
 */
export const CHARACTER_STATUS_ORDER: SignupStatus[] = ["signed", "tentative", "late", "bench"];

// Labels and tips are getters: they are read at render time in the active
// language, while tone, colour and icon stay plain constants. Callers keep
// writing `SIGNUP_STATUS[s].label` / `CAN_ALSO[r].label` / `GEAR_LABEL[g]`.
export const SIGNUP_STATUS: Record<SignupStatus, { readonly label: string; tone?: Tone; color: string; readonly tip: string }> = {
    signed: { tone: "ok", color: "var(--sig-signed)", get label() { return t("signups.status.signed"); }, get tip() { return t("signups.statusTip.signed"); } },
    tentative: { tone: "mid", color: "var(--sig-tentative)", get label() { return t("signups.status.tentative"); }, get tip() { return t("signups.statusTip.tentative"); } },
    late: { tone: "mid", color: "var(--sig-late)", get label() { return t("signups.status.late"); }, get tip() { return t("signups.statusTip.late"); } },
    bench: { color: "var(--sig-bench)", get label() { return t("signups.status.bench"); }, get tip() { return t("signups.statusTip.bench"); } },
    absence: { tone: "bad", color: "var(--sig-absence)", get label() { return t("signups.status.absence"); }, get tip() { return t("signups.statusTip.absence"); } },
};

/** What a stored absence reads as on a badge ("Abmelden" is the action, "Abgemeldet" the state). */
export function statusBadgeLabel(status: SignupStatus): string {
    return status === "absence" ? t("signups.absentBadge") : SIGNUP_STATUS[status].label;
}

export const CAN_ALSO: Record<GameRole, { readonly label: string; icon: string }> = {
    tank: { icon: "ability_warrior_defensivestance", get label() { return t("signups.canAlso.tank"); } },
    healer: { icon: "spell_holy_flashheal", get label() { return t("signups.canAlso.healer"); } },
    melee: { icon: "ability_dualwield", get label() { return t("signups.canAlso.melee"); } },
    ranged: { icon: "inv_weapon_bow_07", get label() { return t("signups.canAlso.ranged"); } },
};
export const ROLE_ORDER: GameRole[] = ["tank", "healer", "melee", "ranged"];

export const GEAR_LABEL: Readonly<Record<string, string>> = {
    get none() { return t("signups.gear.none"); },
    get usable() { return t("signups.gear.usable"); },
    get ready() { return t("signups.gear.ready"); },
};

/**
 * "Ich kann auch" prefilled from the profile, the same rule as the server's
 * defaultCanAlso(): off-tank and healing as set in the profile, plus the roles
 * of the character's other specs — never the role signed up with.
 */
export function defaultCanAlso(profile: SignupProfile, characterKey: string, ownRole: GameRole | ""): GameRole[] {
    const roles = new Set<GameRole>();
    if (profile.canOfftank) roles.add("tank");
    if (profile.canHeal) roles.add("healer");
    const character = profile.characters.find((c) => c.key === characterKey);
    for (const s of character?.specs || []) if (s.role) roles.add(s.role);
    return ROLE_ORDER.filter((r) => roles.has(r) && r !== ownRole);
}

/** "Tank 1/2 · Heiler 1/3 · DPS 4/5" */
export function roleCountText(counts: SignupCounts): string {
    const part = (label: string, c: { n: number; target: number }) => `${label} ${c.target ? `${c.n}/${c.target}` : c.n}`;
    return [part(t("wow.role.tank"), counts.tank), part(t("wow.role.healer"), counts.healer), part(t("wow.role.dps"), counts.dps)].join(" · ");
}

/** The small line under a row's title: date, then the deadline or where signing up happens. */
export function rowSubline(row: { source: string; startTime: number } & Partial<Pick<OwnSignupRow, "deadline" | "deadlinePassed">>): string {
    const parts = [formatEventTime(row.startTime)];
    if (row.source !== "eventhelper") parts.push(t("signups.viaRaidHelper"));
    else if (row.deadline) parts.push(row.deadlinePassed ? t("signups.deadlinePassed") : t("signups.deadlineAt", { time: formatEventTime(row.deadline) }));
    return parts.filter(Boolean).join(" · ");
}

/** Bar tone of the fill: full = ok, more than half = accent (none), less = mid. */
export function fillTone(attending: number, size: number): "ok" | "mid" | undefined {
    if (!size) return undefined;
    if (attending >= size) return "ok";
    return attending / size >= 0.5 ? undefined : "mid";
}
