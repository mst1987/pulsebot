import type { ClaFilter, ClaRow, LogSection } from "../../api";
import { formatDateTime, formatDayDate } from "../../lib/format";
import { t } from "../../i18n";

export const FILTERS: ClaFilter[] = ["all", "open", "unlinked", "done"];

// Rough runtimes, used only to give the progress toast a bar to fill. RPB walks
// the whole fight timeline and is the slow half; a report built from a pasted
// link is a full CLA run.
export const EVAL_SECONDS: Record<LogSection, number> = { cla: 25, rpb: 55 };

const REPORT_SECONDS = 30;

// What a pasted link builds: both halves unless the dialog says otherwise.
export type SectionChoice = "both" | "cla" | "rpb";

// Labels and explanations are getters, so they are read in the language that
// is active when the page renders (never at module load).
export const SECTION_CHOICES: { key: SectionChoice; label: string; sub: string; icon: string; seconds: number; sections: LogSection[] }[] = [
    { key: "both", label: "CLA + RPB", get sub() { return t("cla.choices.bothSub"); }, icon: "inv_misc_book_09", seconds: EVAL_SECONDS.cla + EVAL_SECONDS.rpb, sections: ["cla", "rpb"] },
    { key: "cla", get label() { return t("cla.choices.claLabel"); }, get sub() { return t("cla.choices.claSub"); }, icon: "inv_chest_cloth_43", seconds: REPORT_SECONDS, sections: ["cla"] },
    { key: "rpb", get label() { return t("cla.choices.rpbLabel"); }, get sub() { return t("cla.choices.rpbSub"); }, icon: "ability_warrior_offensivestance", seconds: EVAL_SECONDS.rpb, sections: ["rpb"] },
];

// The two halves of an analysis — label, icon and what each one looks at.
export const ANALYSES: { key: LogSection; label: string; icon: string; sub: string }[] = [
    { key: "cla", label: "CLA", icon: "inv_chest_cloth_43", get sub() { return t("cla.analyses.claSub"); } },
    { key: "rpb", label: "RPB", icon: "ability_warrior_offensivestance", get sub() { return t("cla.analyses.rpbSub"); } },
];

/** Label, tooltip and empty text of a filter, in the active language. */
export function filterMeta(filter: ClaFilter): { label: string; tip: string; sub: string; empty: string } {
    return {
        label: t(`cla.filters.${filter}.label`),
        tip: t(`cla.filters.${filter}.tip`),
        sub: t(`cla.filters.${filter}.sub`),
        empty: t(`cla.filters.${filter}.empty`),
    };
}

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
    if (mins === 0) return t("cla.offset.onTime");
    return ms >= 0 ? t("cla.offset.after", { span }) : t("cla.offset.before", { span });
}

export function discordUrl(row: ClaRow): string {
    return row.guildId && row.channelId && row.messageId
        ? `https://discord.com/channels/${row.guildId}/${row.channelId}/${row.messageId}`
        : "";
}
