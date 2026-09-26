import { useT } from "../../i18n";
import type { View } from "./view";

/** The page's four tabs; the counts are the raiders and the open BiS items. */
export function CouncilTabs({ tab, patch, rosterCount, gapCount }: {
    tab: View["tab"];
    patch: (next: Partial<View>) => void;
    rosterCount: number;
    gapCount: number;
}) {
    const t = useT();
    return (
        <div className="tabs lc-tabs">
            <button type="button" className={`tab-btn${tab === "roster" ? " active" : ""}`} onClick={() => patch({ tab: "roster" })}>
                {t("lootcouncil.tabs.roster")} <span className="tab-count">{rosterCount}</span>
            </button>
            <button type="button" className={`tab-btn${tab === "bis" ? " active" : ""}`} onClick={() => patch({ tab: "bis" })}>
                {t("lootcouncil.tabs.gaps")} <span className="tab-count">{gapCount}</span>
            </button>
            <button type="button" className={`tab-btn${tab === "bislists" ? " active" : ""}`} onClick={() => patch({ tab: "bislists" })}>
                {t("lootcouncil.tabs.bisLists")}
            </button>
            <button type="button" className={`tab-btn${tab === "compare" ? " active" : ""}`} onClick={() => patch({ tab: "compare" })}>
                {t("lootcouncil.tabs.compare")}
            </button>
        </div>
    );
}
