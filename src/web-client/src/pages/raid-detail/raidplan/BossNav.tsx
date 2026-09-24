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
    const label = (b: RaidplanBoss) => (b.defaults ? t("raidBoard.defaults.title") : b.general ? t("raidBoard.assign.general") : b.trash ? `${b.instanceName ? `${b.instanceName}: ` : ""}${t("raidBoard.assign.trash")}` : b.name);
    return (
        <nav className="rp-bossnav" aria-label={t("raidBoard.bosses.title")}>
            {bosses.map((b, idx) => {
                const on = b.key === selected;
                const special = !!b.trash || !!b.general || !!b.defaults;
                const i = bosses.slice(0, idx).filter((x) => !x.trash && !x.general && !x.defaults).length;
                return (
                    <button
                        key={b.key} type="button" className={`rp-bosschip${on ? " is-on" : ""}`} aria-current={on ? "true" : undefined}
                        aria-label={special ? label(b) : `${i + 1}. ${b.name}`} data-tip={special ? label(b) : `${i + 1}. ${b.name}`}
                        onClick={() => onSelect(b.key)}
                    >
                        <img src={b.iconUrl} alt="" width={24} height={24} loading="lazy" />
                        {!special && <span className="rp-bosschip-no">{i + 1}</span>}
                        {on && <span className="rp-bosschip-name">{special ? label(b) : b.name}</span>}
                        {boardCount(draft, b.key) > 0 && <span className="rp-boss-dot" aria-hidden="true" />}
                    </button>
                );
            })}
        </nav>
    );
}
