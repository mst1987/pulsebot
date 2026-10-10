// Pure helpers of the "Datensicherung" section (pages/system/BackupSection.tsx): how long ago, how long it took,
// which tile tone a traffic light gets. Texts go through `t` at call time.
import { t } from "../../i18n";
import type { BackupLight } from "../../api";
import { num, type FigureTone } from "./systemFormat";

/** "gerade eben", "vor 12 Min.", "vor 3 Std.", "vor 2 Tagen" - the section's own wording, hours up to two days. */
export function backupAgo(at: number, now: number): string {
    const minutes = Math.max(0, Math.round((now - at) / 60000));
    if (minutes < 1) return t("system.backup.ago.now");
    if (minutes < 60) return t("system.backup.ago.minutes", { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 48) return t("system.backup.ago.hours", { count: hours });
    return t("system.backup.ago.days", { count: Math.round(hours / 24) });
}

/** "850 ms", "4,2 s", "12 s": a snapshot takes seconds. */
export function duration(ms: number): string {
    if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
    const s = ms / 1000;
    return `${num(s, s < 10 ? 1 : 0)} s`;
}

/** The tile tone of a light: yellow and red colour the tile, green and grey stay plain. */
export function backupTone(light: BackupLight): FigureTone {
    if (light === "warn") return "mid";
    return light === "bad" ? "bad" : "";
}
