import { Check } from "lucide-react";
import type { RaidplanPublicBoss } from "../../../api";
import { useT } from "../../../i18n";
import AutoFollowToggle from "./AutoFollowToggle";
import type { FollowChip } from "../../../hooks/useRaidProgress";

/**
 * The section chips of the sheet (/p/<token>): "Only for me" first (for a visitor who stands in the plan), then one chip per section with
 * icon and name, the chosen one filled. A section where the visitor is personally assigned (`mineKeys`, lib/raidplan/bossMine.ts) carries a
 * small accent dot and says so in its tooltip and label - so he sees before a click where he has something to do. While the linked log is
 * read (#534), a boss it shows killed is dimmed with a small check (`killedKeys`) and "Automatisch mitgehen" ends the bar (`follow`).
 */
export default function SheetBossNav({ bosses, selectedKey, mineKeys, killedKeys, follow, label, showOnlyMine, onlyMine, onToggleOnlyMine, onSelect }: {
    bosses: RaidplanPublicBoss[];
    selectedKey: string;
    /** the sections with a personal assignment of the visitor */
    mineKeys: Set<string>;
    /** the sections whose boss the linked log shows killed (#534) */
    killedKeys?: Set<string>;
    /** the "Automatisch mitgehen" chip: a switch while a log is read, "Wartet auf Log" (`waiting`) inside the raid window without one; missing = none */
    follow?: FollowChip;
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
                const killed = !!killedKeys && killedKeys.has(b.key);
                const tips = [mine ? t("raidBoard.read.hasMine") : "", killed ? t("raidBoard.progress.killed") : ""].filter(Boolean);
                // icon and name on every chip (the same bar as the editor's BossNav)
                return (
                    <button
                        key={b.key} type="button" className={`rp-bosschip${on ? " is-on" : ""}${mine ? " has-mine" : ""}${killed ? " is-killed" : ""}`} aria-current={on ? "true" : undefined}
                        aria-label={tips.length ? `${label(b)} (${tips.join(", ")})` : label(b)} data-tip={tips.length ? tips.join(" · ") : undefined} onClick={() => onSelect(b.key)}
                    >
                        <img src={b.iconUrl} alt="" width={24} height={24} />
                        <span className="rp-bosschip-name">{label(b)}</span>
                        {mine && <span className="rp-bosschip-mine" aria-hidden="true" />}
                        {killed && <span className="rp-bosschip-done" aria-hidden="true"><Check size={9} strokeWidth={3.5} /></span>}
                    </button>
                );
            })}
            {follow && <AutoFollowToggle on={follow.on} onToggle={follow.onToggle} waiting={follow.waiting} />}
        </nav>
    );
}
