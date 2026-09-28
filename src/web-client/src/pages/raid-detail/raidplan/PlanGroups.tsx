import { RotateCcw, Users } from "lucide-react";
import type { IncludedGroups, RaidplanPlayer } from "../../../api";
import { BENCH, groupChoices, isDefaultSelection, planRoster, toggleIncluded } from "../../../lib/raidplan/planGroups";
import { useT } from "../../../i18n";

/**
 * "Gruppen im Plan" (#529): small chips 1..n (+ "Bank") in the head of the raid plan. Which setup groups the plan picks its raiders
 * from - the Besetzung, the class references and priorities, the suggestions, the auto tokens, "Nicht platziert" and the read view.
 * Default: the groups up to the raid's size, the bench off. A plan-wide setting, written at once (`onChange`, null = the default).
 */
export default function PlanGroups({ roster, groupCount, included, canWrite, busy, onChange }: {
    /** the whole lineup (with the bench), before the plan's filter */
    roster: RaidplanPlayer[];
    groupCount: number;
    included: IncludedGroups;
    canWrite: boolean;
    busy: boolean;
    onChange: (next: IncludedGroups | null) => void;
}) {
    const t = useT();
    const choices = groupChoices(roster, groupCount);
    if (roster.length === 0 || choices.length === 0) return null;
    const planned = planRoster(roster, included).filter((p) => !p.gone).length;
    const isDefault = isDefaultSelection(included, groupCount);
    return (
        <span className="rp-pgroups" role="group" aria-label={t("raidBoard.groups.title")}>
            <span className="rp-pgroups-label" data-tip={t("raidBoard.groups.tip")}><Users size={13} aria-hidden="true" />{t("raidBoard.groups.label")}</span>
            {choices.map((c) => {
                const on = included.indexOf(c.key) >= 0;
                const bench = c.key === BENCH;
                const tip = bench ? t("raidBoard.groups.benchTip", { count: c.count }) : t("raidBoard.groups.groupTip", { n: c.key, count: c.count });
                return (
                    <button
                        key={c.key} type="button" className={`rp-pgroups-chip${on ? " is-on" : ""}${bench ? " is-bench" : ""}`} aria-pressed={on}
                        aria-label={tip} data-tip={`${tip} · ${on ? t("raidBoard.groups.on") : t("raidBoard.groups.off")}`} disabled={!canWrite || busy}
                        onClick={() => onChange(toggleIncluded(included, c.key))}
                    >
                        {bench ? t("raidBoard.groups.bench") : c.key}
                    </button>
                );
            })}
            <span className="rp-pgroups-count" data-tip={t("raidBoard.groups.countTip", { count: planned })}>{planned}</span>
            {canWrite && !isDefault && (
                <button type="button" className="rp-pgroups-reset" aria-label={t("raidBoard.groups.reset")} data-tip={t("raidBoard.groups.reset")} disabled={busy} onClick={() => onChange(null)}>
                    <RotateCcw size={12} />
                </button>
            )}
        </span>
    );
}
