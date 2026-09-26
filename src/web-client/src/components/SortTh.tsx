// The clickable table header every admin table sorts by. One component instead
// of the copy per table it used to be, so the arrow, the active state and the
// keyboard/screen-reader semantics are the same everywhere.
//
// `aria-sort` is what tells a screen reader that the column is sorted and in
// which direction — the chevron alone is decoration it never announces.
import type { Dir } from "../lib/tableSort";
import { ChevronDownIcon } from "./icons";

export type SortLabelProps<K extends string> = {
    sortKey: K;
    label: string;
    sort: K;
    dir: Dir;
    onSort: (key: K) => void;
    /** What the column means — shown in the tooltip box, not as a native title. */
    tip?: string;
    tipSub?: string;
};

/**
 * The button alone, for a sortable header that is not a `<th>` — the loot
 * council's roster is a list of blocks with a grid header above it, and a
 * table cell has no place there. Same chevron, same active state.
 */
export function SortLabel<K extends string>({ sortKey, label, sort, dir, onSort, tip, tipSub }: SortLabelProps<K>) {
    const active = sort === sortKey;
    return (
        <button
            type="button"
            className={`sort-link${active ? " active" : ""}${tip ? " tipped" : ""}`}
            data-tip={tip}
            data-tip-sub={tipSub}
            onClick={() => onSort(sortKey)}
        >
            {label}
            {active && <span className={`sort-chev${dir === "asc" ? " asc" : ""}`} aria-hidden="true"><ChevronDownIcon /></span>}
        </button>
    );
}

/** The direction a sorted column announces, "none" when it is not the active one. */
export function ariaSort<K extends string>(sortKey: K, sort: K, dir: Dir): "ascending" | "descending" | "none" {
    if (sort !== sortKey) return "none";
    return dir === "asc" ? "ascending" : "descending";
}

export function SortTh<K extends string>({ className, style, ...props }: SortLabelProps<K> & { className?: string; style?: React.CSSProperties }) {
    return (
        <th aria-sort={ariaSort(props.sortKey, props.sort, props.dir)} className={className} style={style}>
            <SortLabel {...props} />
        </th>
    );
}
