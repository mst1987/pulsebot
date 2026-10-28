import { formatDayMonth, formatTime } from "../../lib/format";

export const ICONS = {
    page: "recruitment",
    post: "notify",
    posts: "message",
    templates: "edit",
    applications: "tasks",
    scan: "search",
    armory: "armory",
    wcl: "warcraftLogs",
};

/** "13.09. 22:41" — the lists' compact timestamp. */
export function shortStamp(ms: number | undefined): string {
    if (!ms) return "—";
    return `${formatDayMonth(ms)} ${formatTime(ms)}`;
}

export const isUrl = (v: string) => /^https?:\/\//i.test((v || "").trim());

export const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
