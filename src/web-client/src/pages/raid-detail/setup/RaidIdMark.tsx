import type { SetupRaidIdTaken } from "../../../api/events/setup";
import { useT } from "../../../i18n";
import { raidIdText } from "./setupText";

/**
 * The quiet mark after a raider's name: the short word "ID" in the editor's
 * warning tone, the full hint in its tooltip. A hint only — the line stays
 * draggable and placeable.
 */
export default function RaidIdMark({ taken }: { taken: SetupRaidIdTaken | undefined }) {
    const t = useT();
    if (!taken) return null;
    const text = raidIdText(taken);
    return (
        <span className="se-raidid" role="img" aria-label={text} data-tip={text} data-tip-sub={t("setup.raidId.sub")}>
            {t("setup.raidId.short")}
        </span>
    );
}
