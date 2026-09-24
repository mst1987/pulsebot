import { Eye, EyeOff } from "lucide-react";
import { boardCount, sheetIncluded } from "../../../lib/raidplan";
import type { RaidplanBoard, RaidplanBoss } from "../../../api";
import { useT } from "../../../i18n";

/**
 * The bosses of the plan as one compact row of chips (icon and number; the chosen
 * one also shows its name, the others carry it in the tooltip), so the board keeps
 * the width. A dot marks a boss that already holds something.
 */
export default function BossNav({ bosses, selected, draft, onSelect, onSheet }: {
    bosses: RaidplanBoss[];
    selected: string;
    draft: Record<string, Partial<RaidplanBoard>>;
    onSelect: (key: string) => void;
    /** switches a section in or out of the shared sheet (missing = no such switch, e.g. read-only) */
    onSheet?: (key: string, on: boolean) => void;
}) {
    const t = useT();
    const label = (b: RaidplanBoss) => (b.defaults ? t("raidBoard.defaults.title") : b.general ? t("raidBoard.assign.general") : b.trash ? `${b.instanceName ? `${b.instanceName}: ` : ""}${t("raidBoard.assign.trash")}` : b.name);
    return (
        <nav className="rp-bossnav" aria-label={t("raidBoard.bosses.title")}>
            {bosses.map((b, idx) => {
                const on = b.key === selected;
                const special = !!b.trash || !!b.general || !!b.defaults;
                const i = bosses.slice(0, idx).filter((x) => !x.trash && !x.general && !x.defaults).length;
                const inSheet = b.defaults ? true : sheetIncluded(draft, b.key);
                return (
                    <span key={b.key} className={`rp-bosschip-wrap${inSheet ? "" : " is-out"}`}>
                    <button
                        type="button" className={`rp-bosschip${on ? " is-on" : ""}${inSheet ? "" : " is-out"}`} aria-current={on ? "true" : undefined}
                        aria-label={special ? label(b) : `${i + 1}. ${b.name}`} data-tip={special ? label(b) : `${i + 1}. ${b.name}`}
                        onClick={() => onSelect(b.key)}
                        onContextMenu={onSheet && !b.defaults ? (e) => { e.preventDefault(); onSheet(b.key, !inSheet); } : undefined}
                    >
                        <img src={b.iconUrl} alt="" width={24} height={24} loading="lazy" />
                        {!special && <span className="rp-bosschip-no">{i + 1}</span>}
                        {on && <span className="rp-bosschip-name">{special ? label(b) : b.name}</span>}
                        {boardCount(draft, b.key) > 0 && <span className="rp-boss-dot" aria-hidden="true" />}
                    </button>
                    {onSheet && !b.defaults && (
                        <button
                            type="button" className="rp-bosschip-eye" aria-pressed={!inSheet} aria-label={inSheet ? t("raidBoard.sheet.outAction") : t("raidBoard.sheet.inAction")}
                            data-tip={inSheet ? t("raidBoard.sheet.outAction") : t("raidBoard.sheet.notInSheet")} onClick={() => onSheet(b.key, !inSheet)}
                        >
                            {inSheet ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>
                    )}
                    </span>
                );
            })}
        </nav>
    );
}
