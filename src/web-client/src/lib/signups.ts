// The vocabulary of the "Anmeldungen" page and its dialog (#256): the five
// statuses in the member's words, their colours (the --sig-* tokens of
// index.css), and the small rules the dialog applies before the server checks
// them again (src/web/signupService.js).
import type { GameRole, OwnSignupRow, SignupCounts, SignupProfile, SignupStatus } from "../api";
import type { Tone } from "../components/ui/Badge";
import { formatEventTime } from "./format";

/** In the order a member thinks about it: coming, maybe, late, bench, not coming. */
export const SIGNUP_STATUS_ORDER: SignupStatus[] = ["signed", "tentative", "late", "bench", "absence"];

/**
 * What one single character can be (#320): the same list without the absence —
 * signing off is for the person, not for one of their characters (the server's
 * CHARACTER_STATUSES in src/web/signupCharacters.js).
 */
export const CHARACTER_STATUS_ORDER: SignupStatus[] = ["signed", "tentative", "late", "bench"];

export const SIGNUP_STATUS: Record<SignupStatus, { label: string; tone?: Tone; color: string; tip: string }> = {
    signed: { label: "Dabei", tone: "ok", color: "var(--sig-signed)", tip: "Du kommst und spielst mit." },
    tentative: { label: "Vielleicht", tone: "mid", color: "var(--sig-tentative)", tip: "Noch nicht sicher – die Orga plant dich nicht fest ein." },
    late: { label: "Spät", tone: "mid", color: "var(--sig-late)", tip: "Du kommst, aber später. Geht auch nach dem Anmeldeschluss." },
    bench: { label: "Bank", color: "var(--sig-bench)", tip: "Du springst ein, wenn jemand fehlt." },
    absence: { label: "Abmelden", tone: "bad", color: "var(--sig-absence)", tip: "Du bist nicht dabei. Geht immer bis zum Raidbeginn." },
};

/** What a stored absence reads as on a badge ("Abmelden" is the action, "Abgemeldet" the state). */
export function statusBadgeLabel(status: SignupStatus): string {
    return status === "absence" ? "Abgemeldet" : SIGNUP_STATUS[status].label;
}

export const CAN_ALSO: Record<GameRole, { label: string; icon: string }> = {
    tank: { label: "Offtank", icon: "ability_warrior_defensivestance" },
    healer: { label: "Heilen", icon: "spell_holy_flashheal" },
    melee: { label: "Nahkampf", icon: "ability_dualwield" },
    ranged: { label: "Fernkampf", icon: "inv_weapon_bow_07" },
};
export const ROLE_ORDER: GameRole[] = ["tank", "healer", "melee", "ranged"];

export const GEAR_LABEL: Record<string, string> = { none: "kein Gear", usable: "brauchbar", ready: "raidbereit" };

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
    return [part("Tank", counts.tank), part("Heiler", counts.healer), part("DPS", counts.dps)].join(" · ");
}

/** The small line under a row's title: date, then the deadline or where signing up happens. */
export function rowSubline(row: { source: string; startTime: number } & Partial<Pick<OwnSignupRow, "deadline" | "deadlinePassed">>): string {
    const parts = [formatEventTime(row.startTime)];
    if (row.source !== "eventhelper") parts.push("über Raid-Helper");
    else if (row.deadline) parts.push(row.deadlinePassed ? "Anmeldeschluss vorbei" : `Anmeldeschluss ${formatEventTime(row.deadline)}`);
    return parts.filter(Boolean).join(" · ");
}

/** Bar tone of the fill: full = ok, more than half = accent (none), less = mid. */
export function fillTone(attending: number, size: number): "ok" | "mid" | undefined {
    if (!size) return undefined;
    if (attending >= size) return "ok";
    return attending / size >= 0.5 ? undefined : "mid";
}
