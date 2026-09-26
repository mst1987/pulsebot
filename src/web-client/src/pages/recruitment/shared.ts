

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
    const d = new Date(ms);
    const date = d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" });
    const time = d.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
    return `${date} ${time}`;
}

export const isUrl = (v: string) => /^https?:\/\//i.test((v || "").trim());

export const openExternal = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
