import type { ClaFilter, ClaRow, LogSection } from "../../api";
import { formatDateTime, formatDayDate } from "../../lib/format";

export const FILTERS: ClaFilter[] = ["all", "open", "unlinked", "done"];

// Rough runtimes, used only to give the progress toast a bar to fill. RPB walks
// the whole fight timeline and is the slow half; a report built from a pasted
// link is a full CLA run.
export const EVAL_SECONDS: Record<LogSection, number> = { cla: 25, rpb: 55 };

const REPORT_SECONDS = 30;

// What a pasted link builds: both halves unless the dialog says otherwise.
export type SectionChoice = "both" | "cla" | "rpb";

export const SECTION_CHOICES: { key: SectionChoice; label: string; sub: string; icon: string; seconds: number; sections: LogSection[] }[] = [
    { key: "both", label: "CLA + RPB", sub: "Komplette Auswertung auf einer Report-Seite", icon: "inv_misc_book_09", seconds: EVAL_SECONDS.cla + EVAL_SECONDS.rpb, sections: ["cla", "rpb"] },
    { key: "cla", label: "nur CLA", sub: "Gear, Consumables, Kampfverlauf", icon: "inv_chest_cloth_43", seconds: REPORT_SECONDS, sections: ["cla"] },
    { key: "rpb", label: "nur RPB", sub: "Schaden, Tode, Aktivität, Cooldowns", icon: "ability_warrior_offensivestance", seconds: EVAL_SECONDS.rpb, sections: ["rpb"] },
];

// The two halves of an analysis — label, icon and what each one looks at.
export const ANALYSES: { key: LogSection; label: string; icon: string; sub: string }[] = [
    { key: "cla", label: "CLA", icon: "inv_chest_cloth_43", sub: "Gear, Verzauberungen, Sockel, Consumables, Drums, Potions & Shadow-Resi" },
    { key: "rpb", label: "RPB", icon: "ability_warrior_offensivestance", sub: "Vermeidbarer Schaden, Tode, Aktivität, Cooldowns, Interrupts & Log-Prüfung" },
];

export const FILTER_META: Record<ClaFilter, { label: string; tip: string; sub: string; empty: string }> = {
    all: {
        label: "Alle",
        tip: "Alle Logs",
        sub: "Vom Bot im Log-Channel erkannte Warcraft-Logs und per Link ausgewertete Reports, neueste Post-Zeit zuerst. Jeder Report wird nur einmal ausgewertet.",
        empty: "Noch keine Logs. Sobald im Log-Channel ein Warcraft-Logs-Link gepostet wird, taucht er hier auf.",
    },
    open: {
        label: "Offen",
        tip: "Noch nicht ausgewertet",
        sub: "Logs, für die weder CLA noch RPB gelaufen ist. Über den Log-Link vorab prüfen, dann „Auswerten“.",
        empty: "Kein Log wartet auf eine Auswertung.",
    },
    unlinked: {
        label: "Ohne Raid-Event",
        tip: "Keinem Raid-Event zugeordnet",
        sub: "Jedes Log gehört zu dem Raid, dessen Startzeit zur Post-Zeit passt. Der Vorschlag ist im Zuordnen-Dialog vorgewählt.",
        empty: "Alle Logs sind einem Raid-Event zugeordnet.",
    },
    done: {
        label: "Ausgewertet",
        tip: "Mindestens eine Hälfte ausgewertet",
        sub: "Logs mit CLA- oder RPB-Auswertung und die per Link erstellten Reports.",
        empty: "Noch keine Auswertungen.",
    },
};

// ---- small formatting helpers ----

/** "So 14.09. 21:58" (epoch ms). */
export function fmtPosted(ms: number): string {
    if (!ms) return "";
    return formatDateTime(ms);
}

/** "Do 11.09." (event start in seconds). */
export function fmtEventDay(startTime: number): string {
    if (!startTime) return "";
    return formatDayDate(startTime * 1000);
}

/** "2 h 13 min nach Start" — how far a log's post lies from an event's start. */
export function formatMatchOffset(diffMs: number): string {
    const ms = Number(diffMs) || 0;
    const mins = Math.round(Math.abs(ms) / 60000);
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    const span = hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${mins} min`;
    if (mins === 0) return "pünktlich zum Start";
    return ms >= 0 ? `${span} nach Start` : `${span} vor Start`;
}

export function discordUrl(row: ClaRow): string {
    return row.guildId && row.channelId && row.messageId
        ? `https://discord.com/channels/${row.guildId}/${row.channelId}/${row.messageId}`
        : "";
}
