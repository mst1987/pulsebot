import { boardCount } from "../../../lib/raidplan";
import type { RaidplanBoard, RaidplanBoss } from "../../../api";
import { useT } from "../../../i18n";

/**
 * The bosses of the plan as one compact row of chips (icon and number; the chosen
 * one also shows its name, the others carry it in the tooltip), so the board keeps
 * the width. A dot marks a boss that already holds something.
 */
export default function BossNav({ bosses, selected, draft, onSelect }: {
    bosses: RaidplanBoss[];
    selected: string;
    draft: Record<string, Partial<RaidplanBoard>>;
    onSelect: (key: string) => void;
}) {
    const t = useT();
    return (
        <nav className="rp-bossnav" aria-label={t("raidBoard.bosses.title")}>
            {bosses.map((b, i) => {
                const on = b.key === selected;
                return (
                    <button
                        key={b.key} type="button" className={`rp-bosschip${on ? " is-on" : ""}`} aria-current={on ? "true" : undefined}
                        aria-label={`${i + 1}. ${b.name}`} data-tip={`${i + 1}. ${b.name}`}
                        onClick={() => onSelect(b.key)}
                    >
                        <img src={b.iconUrl} alt="" width={24} height={24} loading="lazy" />
                        <span className="rp-bosschip-no">{i + 1}</span>
                        {on && <span className="rp-bosschip-name">{b.name}</span>}
                        {boardCount(draft, b.key) > 0 && <span className="rp-boss-dot" aria-hidden="true" />}
                    </button>
                );
            })}
        </nav>
    );
}
