import type { VoiceRaid } from "../../../api";
import type { useT } from "../../../i18n";
import { clock } from "./setupText";

type Translate = ReturnType<typeof useT>;

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
        case "open":
            return parts(t("channels.voiceRow.open"), members(raid.members), t("channels.voiceRow.closesBy", { time: at(raid.limitAt) }));
        case "closed":
            return raid.closedAt ? t("channels.voiceRow.closedAt", { time: at(raid.closedAt) }) : t("channels.voiceRow.closed");
        case "failed":
            return t("channels.voiceRow.failed", { error: raid.error || t("channels.voiceRow.unknownError") });
        default:
            return "";
    }
}
