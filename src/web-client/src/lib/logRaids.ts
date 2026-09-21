// How the Log-Auswertung shows the raids of a log: the raid's boss icon from the
// shared table (lib/raidIcons.ts, the same icons the Raid-Events use), the count
// badge "Hyjal 3/5" and its tooltip. A log whose raid is not known (yet) gets
// the page's own pocket watch instead of the shared note fallback.

import type { ClaRaid } from "../api";
import { RAID_CONTENTS } from "./raidIcons";
import { t } from "../i18n";

/** The page's own icon, for a log whose raid is not known (yet). */
export const LOG_FALLBACK_ICON = "inv_misc_pocketwatch_01";

export function raidIcon(contentId: string | undefined): string {
    return (contentId && RAID_CONTENTS[contentId]?.icon) || LOG_FALLBACK_ICON;
}

/** "Hyjal 3/5", or just "Hyjal" when the raid's encounter count is unknown. */
export function raidCount(r: ClaRaid): string {
    return r.total ? `${r.label} ${r.killed}/${r.total}` : r.label;
}

/** Head and explanation of a raid badge's tooltip. */
export function raidTip(r: ClaRaid): { head: string; sub: string } {
    if (r.finalKilled) {
        return {
            head: t("raidDetail.logRaid.doneHead", { raid: r.label }),
            sub: r.total ? t("raidDetail.logRaid.doneSub", { killed: r.killed, total: r.total }) : t("raidDetail.logRaid.doneSubNoTotal"),
        };
    }
    const standing = r.missing.length ? r.missing.join(", ") : r.finalBoss;
    return {
        head: t("raidDetail.logRaid.openHead"),
        sub: `${r.total ? t("raidDetail.logRaid.openCount", { killed: r.killed, total: r.total, raid: r.label }) : t("raidDetail.logRaid.openNoTotal", { raid: r.label })}, ${t("raidDetail.logRaid.standing", { count: r.missing.length > 1 ? 2 : 1, names: standing })} ${t("raidDetail.logRaid.evalAnyway")}`,
    };
}
