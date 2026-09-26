import type { ClaFilter } from "../../api";
import Badge from "../../components/ui/Badge";
import { FILTER_META, FILTERS } from "./shared";

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
    return (
        <div className="seg la-seg" role="radiogroup" aria-label="Logs filtern">
            {FILTERS.map((f) => {
                const active = f === value;
                const warn = (f === "open" || f === "unlinked") && counts[f] > 0;
                return (
                    <button
                        key={f}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`seg-opt${active ? " active" : ""}`}
                        data-tip={FILTER_META[f].tip}
                        data-tip-sub={FILTER_META[f].sub}
                        onClick={() => onChange(f)}
                    >
                        {FILTER_META[f].label}
                        <Badge count tone={warn ? "mid" : undefined}>{counts[f] ?? 0}</Badge>
                    </button>
                );
            })}
        </div>
    );
}
