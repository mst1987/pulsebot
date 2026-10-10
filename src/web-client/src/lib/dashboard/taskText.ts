// The words of a start-page task in the reader's language. The server sends
// each task's German texts (title, ref, tip, tipSub, the button) and, next to
// them, `texts`: per field a key under `dashboard.task.` with what it needs
// (src/web/dashboard/dashboardOverview.js, `txt`). A field may be a list of
// pieces, or a raw `{ text }` (a name, the server's own error sentence). When a
// key is unknown here the German text stands, so a newer server never shows a
// bare key.
import type { DashboardTask, DashboardTaskText } from "../../api";
import { hasKey, t } from "../../i18n";
import { formatDayMonth } from "../format";
import { dayDate } from "../raids/overviewDates";

export type TaskField = "title" | "ref" | "tip" | "tipSub" | "action";

/** One piece in words, or null when its key is unknown. `date` (ms) becomes "12.10.", `day` (ms) "Mo 12.10.". */
function piece(p: DashboardTaskText): string | null {
    if (typeof p.text === "string") return p.text;
    const key = `dashboard.task.${p.key || ""}`;
    if (!p.key || !hasKey(key)) return null;
    const params: Record<string, string | number> = { ...(p.params || {}) };
    if (typeof params.date === "number") params.date = formatDayMonth(params.date);
    if (typeof params.day === "number") params.day = dayDate(params.day);
    return t(key, params);
}

/** A task's field in the reader's language, else `fallback` (the server's German text). */
export function taskText(task: Pick<DashboardTask, "texts">, field: TaskField, fallback: string): string {
    const value = task.texts && task.texts[field];
    if (!value) return fallback;
    const parts = (Array.isArray(value) ? value : [value]).map(piece);
    if (!parts.length || parts.some((p) => p === null)) return fallback;
    return parts.join(field === "ref" ? " · " : " ");
}
