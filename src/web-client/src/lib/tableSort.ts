// One sort implementation for every admin table.
//
// Before this, each table brought its own comparator, its own asc/desc toggle
// and its own copy of the sortable <th> — five of them, drifting apart in the
// details (which direction a column starts in, whether a stored key from an
// older build is still trusted). The pieces here are the shared answer:
//
//   * `sortRows()` — the comparator, so "Datum" sorts the same everywhere,
//   * `useTableSort()` — the remembered sort state for a table that has no view
//     state of its own,
//   * `components/SortTh.tsx` — the header button that drives them.
//
// Tables that already persist a whole view object (filters + sort in one key,
// e.g. the Items tab) keep that and only use `sortRows()` + `SortTh` — moving
// their sort into a second storage key would forget what admins had set.
import { usePersistedState } from "./persistedState";

export type Dir = "asc" | "desc";

/** What a column sorts by. Strings compare case-insensitively by convention —
 *  lowercase them in the value function, as every caller does. */
export type SortValue = string | number;

/**
 * Rows in the order a column asks for. Never mutates the input (React state is
 * handed in directly) and keeps equal rows in their original order, so a table
 * sorted by a column half the rows share doesn't reshuffle on every render.
 */
export function sortRows<T>(rows: T[], value: (row: T) => SortValue, dir: Dir): T[] {
    const mul = dir === "asc" ? 1 : -1;
    return rows
        .map((row, index) => ({ row, index, key: value(row) }))
        .sort((a, b) => {
            if (a.key < b.key) return -1 * mul;
            if (a.key > b.key) return 1 * mul;
            return a.index - b.index;
        })
        .map((e) => e.row);
}

export type TableSort<K extends string> = {
    sort: K;
    dir: Dir;
    /** Toggles the direction on the active column, else switches to `key` in
     *  that column's natural direction (names ascending, dates descending). */
    onSort: (key: K) => void;
    /** The rows in the current order; `value` gets the active column. */
    apply: <T>(rows: T[], value: (row: T, key: K) => SortValue) => T[];
};

/**
 * A table's remembered sort. `defaults` lists every sortable column with the
 * direction its first click picks — a column of names starts "asc", one of
 * dates or counts "desc", which is what someone clicking it actually wants.
 *
 * The stored value is untrusted: a key from a build where that column still
 * existed falls back to `initial` instead of sorting by nothing.
 *
 * `initialDir` overrides the column's natural direction for the very first
 * view — the same "Termin" column leads with the next raid on a list of coming
 * ones and with the latest on a list of past ones.
 */
export function useTableSort<K extends string>(storageKey: string, defaults: Record<K, Dir>, initial: K, initialDir?: Dir): TableSort<K> {
    const [state, setState] = usePersistedState<{ sort: K; dir: Dir }>(storageKey, { sort: initial, dir: initialDir || defaults[initial] });
    const sort: K = defaults[state.sort] ? state.sort : initial;
    const dir: Dir = state.dir === "asc" ? "asc" : "desc";

    const onSort = (key: K) => {
        if (key === sort) { setState({ sort, dir: dir === "asc" ? "desc" : "asc" }); return; }
        setState({ sort: key, dir: defaults[key] });
    };

    return {
        sort,
        dir,
        onSort,
        apply: (rows, value) => sortRows(rows, (row) => value(row, sort), dir),
    };
}
