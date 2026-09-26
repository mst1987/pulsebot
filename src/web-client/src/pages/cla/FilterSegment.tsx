import type { ClaFilter } from "../../api";
import Badge from "../../components/ui/Badge";
import { useT } from "../../i18n";
import { filterMeta, FILTERS } from "./shared";

// ---- the filter segment with a count per option ----

/**
 * The shared Segment's look (.seg / .seg-opt) with a round count badge per
 * option — the shared component takes plain string labels, so the counts
 * would not fit into it.
 */
export function FilterSegment({ value, counts, onChange }: {
    value: ClaFilter;
    counts: Record<ClaFilter, number>;
    onChange: (f: ClaFilter) => void;
}) {
    const t = useT();
    return (
        <div className="seg la-seg" role="radiogroup" aria-label={t("cla.filters.ariaLabel")}>
            {FILTERS.map((f) => {
                const active = f === value;
                const warn = (f === "open" || f === "unlinked") && counts[f] > 0;
                const meta = filterMeta(f);
                return (
                    <button
                        key={f}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`seg-opt${active ? " active" : ""}`}
                        data-tip={meta.tip}
                        data-tip-sub={meta.sub}
                        onClick={() => onChange(f)}
                    >
                        {meta.label}
                        <Badge count tone={warn ? "mid" : undefined}>{counts[f] ?? 0}</Badge>
                    </button>
                );
            })}
        </div>
    );
}
