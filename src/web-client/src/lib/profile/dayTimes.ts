// "Wann ich kann" with an hour (Mein Profil, part 2): per chosen weekday an
// optional "ab HH:MM" in quarter hours, moved with − and +; no end. Empty =
// the whole evening. The server keeps the same shape (raiderProfileStore
// normalizeTime): "HH:MM" on a quarter hour, 00:00 to 23:45.

/** Where + starts from on a day without an hour - a usual raid start. */
export const DEFAULT_FROM = "19:00";
const LAST = 23 * 60 + 45;

/** "19:30" -> 1170; anything else -> null. */
export function toMinutes(time: string | undefined): number | null {
    const m = /^(\d{2}):(\d{2})$/.exec(time || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 1170 -> "19:30". */
export function fromMinutes(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The hour after one click: +/- one step, kept within 00:00..23:45. A day
 * without an hour starts at DEFAULT_FROM with +, and has no − (null = the
 * button is disabled). At either end the button is disabled too.
 */
export function stepTime(time: string | undefined, dir: -1 | 1, step = 15): string | null {
    const now = toMinutes(time);
    if (now === null) return dir > 0 ? DEFAULT_FROM : null;
    const next = now + dir * step;
    if (next < 0 || next > LAST) return null;
    return fromMinutes(next);
}

/** The map with one day's hour set (a string) or taken out (""), days in their order. */
export function withDayTime(times: Record<string, string>, day: string, time: string): Record<string, string> {
    const next = { ...times };
    if (time) next[day] = time; else delete next[day];
    return next;
}
