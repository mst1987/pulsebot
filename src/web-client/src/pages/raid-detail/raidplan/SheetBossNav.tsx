import type { RaidplanPublicBoss } from "../../../api";
import { useT } from "../../../i18n";

/**
 * The section chips of the sheet (/p/<token>): "Only for me" first (for a visitor who stands in the plan), then one chip per section with
 * icon and name, the chosen one filled. A section where the visitor is personally assigned (`mineKeys`, lib/raidplan/bossMine.ts) carries a
 * small accent dot and says so in its tooltip and label - so he sees before a click where he has something to do.
 */
export default function SheetBossNav({ bosses, selectedKey, mineKeys, label, showOnlyMine, onlyMine, onToggleOnlyMine, onSelect }: {
    bosses: RaidplanPublicBoss[];
    selectedKey: string;
    /** the sections with a personal assignment of the visitor */
    mineKeys: Set<string>;
    label: (b: RaidplanPublicBoss) => string;
    showOnlyMine: boolean;
    onlyMine: boolean;
    onToggleOnlyMine: () => void;
    onSelect: (key: string) => void;
}) {
    const t = useT();
    return (
        <nav className="rp-bossnav rp-public-nav" aria-label={t("raidBoard.bosses.title")}>
            {showOnlyMine && (
                <button type="button" className={`rp-bosschip rp-onlymine${onlyMine ? " is-on" : ""}`} aria-pressed={onlyMine} data-tip={t("raidBoard.read.onlyMineTip")} onClick={onToggleOnlyMine}>{t("raidBoard.read.onlyMine")}</button>
            )}
            {bosses.map((b) => {
                const on = b.key === selectedKey;
                const mine = mineKeys.has(b.key);
                // icon and name on every chip (the same bar as the editor's BossNav)
                return (
                    <button
                        key={b.key} type="button" className={`rp-bosschip${on ? " is-on" : ""}${mine ? " has-mine" : ""}`} aria-current={on ? "true" : undefined}
                        aria-label={mine ? `${label(b)} (${t("raidBoard.read.hasMine")})` : label(b)} data-tip={mine ? t("raidBoard.read.hasMine") : undefined} onClick={() => onSelect(b.key)}
                    >
                        <img src={b.iconUrl} alt="" width={24} height={24} />
                        <span className="rp-bosschip-name">{label(b)}</span>
                        {mine && <span className="rp-bosschip-mine" aria-hidden="true" />}
                    </button>
                );
            })}
        </nav>
    );
}
