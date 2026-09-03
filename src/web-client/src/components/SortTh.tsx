// The clickable table header every admin table sorts by. One component instead
// of the copy per table it used to be, so the arrow, the active state and the
// keyboard/screen-reader semantics are the same everywhere.
//
// `aria-sort` is what tells a screen reader that the column is sorted and in
// which direction — the ▲/▼ glyph alone is decoration it never announces.
import type { Dir } from "../lib/tableSort";

export type SortLabelProps<K extends string> = {
    sortKey: K;
    label: string;
    sort: K;
    dir: Dir;
    onSort: (key: K) => void;
    title?: string;
};

/**
 * The button alone, for a sortable header that is not a `<th>` — the loot
 * council's roster is a list of blocks with a grid header above it, and a
 * table cell has no place there. Same glyph, same active state.
 */
export function SortLabel<K extends string>({ sortKey, label, sort, dir, onSort, title }: SortLabelProps<K>) {
    const active = sort === sortKey;
    return (
        <button
            type="button"
            className={`sort-link${active ? " active" : ""}`}
            title={title}
            onClick={() => onSort(sortKey)}
        >
            {label}{active ? (dir === "asc" ? " ▲" : " ▼") : ""}
        </button>
    );
}

/** The direction a sorted column announces, "none" when it is not the active one. */
export function ariaSort<K extends string>(sortKey: K, sort: K, dir: Dir): "ascending" | "descending" | "none" {
    if (sort !== sortKey) return "none";
    return dir === "asc" ? "ascending" : "descending";
}

export function SortTh<K extends string>({ style, ...props }: SortLabelProps<K> & { style?: React.CSSProperties }) {
    return (
        <th aria-sort={ariaSort(props.sortKey, props.sort, props.dir)} style={style}>
            <SortLabel {...props} />
        </th>
    );
}
