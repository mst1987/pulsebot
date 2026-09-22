// Time bands of the lists of raids: coming raids by raid ID (Wednesday to
// Tuesday, lib/raidId.ts), past raids by month — both in the guild's time zone.
import { locale, t } from "../i18n";
import { idsFromNow, raidIdOf } from "./raidId";

const TZ = "Europe/Berlin";
const DAY_MS = 86400000;

const ddmm = (day: number) => {
    const d = new Date(day);
    return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;
};

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

/** "Diese ID 16.–22.09.", "Nächste ID 23.–29.09.", "In 2 IDs 30.09.–06.10." — Wednesday to Tuesday. */
export function weekBands<T extends { startTime: number }>(rows: T[], now: number = Date.now()): TimeBand<T>[] {
    return bandsBy(rows, (row) => {
        const wednesday = raidIdOf((row.startTime || 0) * 1000);
        const weeks = idsFromNow((row.startTime || 0) * 1000, now);
        const label = weeks === 0 ? t("raids.time.thisWeek")
            : weeks === 1 ? t("raids.time.nextWeek")
                : weeks === -1 ? t("raids.time.lastWeek")
                    : weeks > 1 ? t("raids.time.inWeeks", { count: weeks }) : t("raids.time.weeksAgo", { count: -weeks });
        const tuesday = wednesday + 6 * DAY_MS;
        const from = ddmm(wednesday);
        const range = new Date(wednesday).getUTCMonth() === new Date(tuesday).getUTCMonth()
            ? `${from.slice(0, 3)}–${ddmm(tuesday)}`
            : `${from}–${ddmm(tuesday)}`;
        return { key: `w${wednesday}`, label, range };
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
