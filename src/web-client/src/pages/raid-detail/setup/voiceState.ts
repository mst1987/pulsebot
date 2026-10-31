import type { VoiceRaid } from "../../../api";
import type { useT } from "../../../i18n";
import { formatTime, formatWeekday, formatWith } from "../../../lib/format";
import { clock } from "./setupText";

type Translate = ReturnType<typeof useT>;

const berlinDay = (ms: number) => formatWith(ms, { year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * The latest close: past midnight of the raid's day with its weekday ("So 00:30"),
 * so a close at midnight does not read like the start of the raid's own day.
 */
function closeTime(raid: VoiceRaid): string {
    const ms = (raid.limitAt || 0) * 1000;
    const ref = (raid.openAt || raid.endAt || 0) * 1000;
    if (ms && ref && berlinDay(ms) !== berlinDay(ref)) return `${formatWeekday(ms)} ${formatTime(ms)}`;
    return clock(ms);
}

/** The line under the channel's name: its state as words ("offen · 7 drin · schließt, sobald leer, spätestens 24:00"). */
export function voiceStateLine(raid: VoiceRaid, t: Translate): string {
    const members = (n: number | null | undefined) => (typeof n === "number" ? t("channels.voiceRow.members", { count: n }) : "");
    const parts = (...p: string[]) => p.filter(Boolean).join(" · ");
    const at = (sec?: number) => clock((sec || 0) * 1000);
    switch (raid.state) {
        case "fixed":
            return parts(t("channels.voiceRow.fixed"), members(raid.members));
        case "planned":
            return parts(t("channels.voiceRow.temp"), raid.parentName
                ? t("channels.voiceRow.plannedIn", { time: at(raid.openAt), parent: raid.parentName })
                : t("channels.voiceRow.planned", { time: at(raid.openAt) }));
        case "creating":
            return parts(t("channels.voiceRow.temp"), t("channels.voiceRow.creating"));
        case "open":
            return parts(t("channels.voiceRow.open"), members(raid.members), t("channels.voiceRow.closesBy", { time: closeTime(raid) }));
        case "closed":
            return raid.closedAt ? t("channels.voiceRow.closedAt", { time: at(raid.closedAt) }) : t("channels.voiceRow.closed");
        case "failed":
            return t("channels.voiceRow.failed", { error: raid.error || t("channels.voiceRow.unknownError") });
        default:
            return "";
    }
}
