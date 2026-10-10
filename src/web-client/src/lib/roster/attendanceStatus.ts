// The attendance codes of a raid night (#677, services/characters/rosterAttendance.js) and
// how every page words and colours them — the roster tooltip, the attendance grid, the
// member drawer, "Meine Anwesenheit", the Kaderplaner and the character page.
//
// Six statuses: "present" (in the log, or signed up without a log) and "bench" (on the
// setup's bench or signed up as bench) count for the quota; "vacation" (an absence entry
// covers the raid), "absence" (signed off), "noSignup" and "noShow" are missed. The
// colours are the tokens --att-<status> (styles/tokens.css); a cell carries a letter too,
// so the status never rests on hue alone.
import type { AttendanceOverride, AttendanceStatus } from "../../api";
import { t } from "../../i18n";
import { formatDayMonth } from "../format";

/** The order the tooltip groups the nights in (issue #677). */
export const STATUS_ORDER: AttendanceStatus[] = ["present", "bench", "noSignup", "absence", "vacation", "noShow", "tentative"];

/** The order the edit menu offers them in. */
export const EDIT_ORDER: AttendanceStatus[] = ["present", "bench", "vacation", "absence", "noSignup", "noShow"];

/** The statuses that count for the quota. */
/** Whether a night counts for the quota at all: a "maybe" the setup left out (tentative) does not (Oct 2026). */
export function countsForQuota(status: AttendanceStatus): boolean {
    return status !== "tentative";
}

/** Whether a night counts as there; "tentative" (not set up) counts neither way - see countsForQuota. */
export function countsAsPresent(status: AttendanceStatus): boolean {
    return status === "present" || status === "bench";
}

// The server's German words of older answers ("nicht im Log" …), matched without their accents ("spater"),
// so no German literal sits in the client.
const LEGACY: Record<string, AttendanceStatus> = {
    "im Log": "present",
    "im Log (Klasse passt)": "present",
    angemeldet: "present",
    "angemeldet (spater)": "present",
    Ersatzbank: "bench",
    Urlaub: "vacation",
    abgemeldet: "absence",
    "keine Anmeldung": "noSignup",
    "nicht im Log": "noShow",
    vorlaufig: "noShow",
};

/** A night's status: the server's code, else read from an older answer's German word, else from `attended`. */
export function statusOf(night: { status?: string | null; reason?: string | null; attended?: boolean }): AttendanceStatus {
    if (night.status && (STATUS_ORDER as string[]).includes(night.status)) return night.status as AttendanceStatus;
    const legacy = night.reason ? LEGACY[night.reason.normalize("NFD").replace(/[̀-ͯ]/g, "")] : undefined;
    if (legacy) return legacy;
    return night.attended === false ? "noShow" : "present";
}

/** "Dabei", "Bench", "Urlaub" … in the menu language. */
export function statusLabel(status: AttendanceStatus): string {
    return t(`attendance.status.${status}`);
}

/** The one letter a grid cell carries ("D", "B", "U" …). */
export function statusLetter(status: AttendanceStatus): string {
    return t(`attendance.letter.${status}`);
}

/** What the status means, one short line (the edit menu, the grid's legend). */
export function statusHint(status: AttendanceStatus): string {
    return t(`attendance.hint.${status}`);
}

const DETAILS = new Set(["inLog", "inLogClass", "signed", "late", "benchSetup", "benchSignup", "benchNotInLog", "vacation", "absence", "notInLog", "noSignup", "tentative", "tentativePlaced", "tentativeNotPlaced"]);

/** Why the night has its status ("im Log", "angemeldet (später)" …), "" when the server named no reason. */
export function detailText(detail: string | undefined): string {
    return detail && DETAILS.has(detail) ? t(`attendance.detail.${detail}`) : "";
}

/** "von Hand: Bench (Marc, 09.10.)" — the line of a night the orga set by hand. */
export function overrideLine(o: AttendanceOverride): string {
    const date = o.at ? formatDayMonth(o.at) : "";
    const who = [o.byName || o.by, date].filter(Boolean).join(", ");
    return who ? t("attendance.override.line", { status: statusLabel(o.status), who }) : t("attendance.override.lineNoWho", { status: statusLabel(o.status) });
}

/** A night's verdict as one line: the status, why, and the override with its reason. */
export function verdictText(night: { status?: string | null; reason?: string | null; attended?: boolean; detail?: string; override?: AttendanceOverride }): string {
    if (night.override) {
        const base = overrideLine(night.override);
        return night.override.reason ? `${base} · ${night.override.reason}` : base;
    }
    const status = statusOf(night);
    const why = detailText(night.detail);
    return why ? `${statusLabel(status)} · ${why}` : statusLabel(status);
}

// Details that only repeat their status's label ("Nicht angemeldet" · "keine Anmeldung"): the tooltip explains the status instead.
const PLAIN_DETAILS = new Set(["noSignup", "absence", "vacation", "tentative"]);

/** The tooltip under a night's short label: the override with its reason, else why the night has its status, else what the status means. */
export function verdictTip(night: { status?: string | null; reason?: string | null; attended?: boolean; detail?: string; override?: AttendanceOverride }): string {
    if (night.override) return verdictText(night);
    const why = night.detail && !PLAIN_DETAILS.has(night.detail) ? detailText(night.detail) : "";
    return why || statusHint(statusOf(night));
}
