import { formatDayMonth, formatTime } from "../../lib/format";

export const ICONS = {
    page: "inv_misc_grouplooking",
    post: "ability_warrior_battleshout",
    posts: "inv_letter_15",
    templates: "inv_scroll_03",
    applications: "inv_misc_note_01",
    scan: "inv_misc_spyglass_02",
    armory: "inv_misc_book_09",
    wcl: "inv_misc_pocketwatch_01",
};

/** "13.09. 22:41" — the lists' compact timestamp. */
export function shortStamp(ms: number | undefined): string {
    if (!ms) return "—";
    return `${formatDayMonth(ms)} ${formatTime(ms)}`;
}

export const isUrl = (v: string) => /^https?:\/\//i.test((v || "").trim());

export const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
