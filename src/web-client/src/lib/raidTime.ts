// Time bands of the Raid-Events list: coming raids by calendar week (Monday to
// Sunday), past raids by month — both in the guild's time zone, so a raid on
// Sunday 23:30 does not slip into the next week for a viewer elsewhere.
import { locale, t } from "../i18n";

const TZ = "Europe/Berlin";
const DAY_MS = 86400000;

/** The calendar day (UTC midnight of that date) an epoch-seconds time falls on in TZ. */
function dayOf(ms: number): number {
    return Date.parse(new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ }));
}

/** Monday of the week the day lies in, as a UTC-midnight timestamp. */
function mondayOf(day: number): number {
    const weekday = (new Date(day).getUTCDay() + 6) % 7; // 0 = Monday
    return day - weekday * DAY_MS;
}

const ddmm = (day: number) => {
    const d = new Date(day);
    return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;
};

/** ISO week number of a UTC-midnight day. */
function isoWeek(day: number): number {
    const d = new Date(day);
    const thursday = day + (3 - ((d.getUTCDay() + 6) % 7)) * DAY_MS;
    const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
    return Math.floor((thursday - yearStart) / DAY_MS / 7) + 1;
}

export type TimeBand<T> = { key: string; label: string; range: string; rows: T[] };

/**
 * Consecutive rows of the same band grouped, in the order the rows come — the
 * list is sorted first, so the bands follow the sort direction.
 */
function bandsBy<T>(rows: T[], band: (row: T) => { key: string; label: string; range: string }): TimeBand<T>[] {
    const out: TimeBand<T>[] = [];
    const byKey = new Map<string, TimeBand<T>>();
    for (const row of rows) {
        const b = band(row);
        let entry = byKey.get(b.key);
        if (!entry) {
            entry = { ...b, rows: [] };
            byKey.set(b.key, entry);
            out.push(entry);
        }
        entry.rows.push(row);
    }
    return out;
}

/** "Diese Woche 14.–20.09.", "Nächste Woche 21.–27.09.", "KW 40 28.09.–04.10.". */
export function weekBands<T extends { startTime: number }>(rows: T[], now: number = Date.now()): TimeBand<T>[] {
    const thisMonday = mondayOf(dayOf(now));
    return bandsBy(rows, (row) => {
        const monday = mondayOf(dayOf((row.startTime || 0) * 1000));
        const weeks = Math.round((monday - thisMonday) / (7 * DAY_MS));
        const label = weeks === 0 ? t("raids.time.thisWeek")
            : weeks === 1 ? t("raids.time.nextWeek")
                : weeks === -1 ? t("raids.time.lastWeek")
                    : t("raids.time.week", { week: isoWeek(monday) });
        const sunday = monday + 6 * DAY_MS;
        const from = ddmm(monday);
        const range = new Date(monday).getUTCMonth() === new Date(sunday).getUTCMonth()
            ? `${from.slice(0, 3)}–${ddmm(sunday)}`
            : `${from}–${ddmm(sunday)}`;
        return { key: `w${monday}`, label, range };
    });
}

/** "September 2026". */
export function monthBands<T extends { startTime: number }>(rows: T[]): TimeBand<T>[] {
    return bandsBy(rows, (row) => {
        const d = new Date((row.startTime || 0) * 1000);
        const key = d.toLocaleDateString("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" });
        const label = d.toLocaleDateString(locale(), { timeZone: TZ, month: "long", year: "numeric" });
        return { key: `m${key}`, label, range: "" };
    });
}

/** "Do 17.09." and "19:45" of an event start. */
export function eventDay(startTime: number): { day: string; time: string } {
    if (!startTime) return { day: "", time: "" };
    const d = new Date(startTime * 1000);
    const weekday = d.toLocaleDateString(locale(), { timeZone: TZ, weekday: "short" }).replace(".", "");
    const date = d.toLocaleDateString(locale(), { timeZone: TZ, day: "2-digit", month: "2-digit" });
    const time = d.toLocaleTimeString(locale(), { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
    return { day: `${weekday} ${date}`, time };
}
