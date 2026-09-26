import { useCallback, useEffect, useRef, useState, type DependencyList, type SetStateAction } from "react";
import type { ApiError } from "../api";
import { initialState, settled, started, stopped, type AsyncState } from "../lib/asyncState";

/**
 * One request and its state — the one way a page loads what it shows (#437).
 *
 *   const roster = useApi(() => getRoster(), []);
 *   <AsyncView state={roster} loading={<RaidLoader text={…} />}>{(data) => …}</AsyncView>
 *
 * `fn` runs when the component mounts and again whenever `deps` change (the
 * request's inputs — an id from the url, a filter); `reload()` runs it again by
 * hand after a change was saved. The newest call always wins: an answer to an
 * older call, to a call whose inputs have since changed or to a call the page
 * left behind is dropped (lib/asyncState.ts). A failed reload keeps the last
 * data and records the error; a successful one clears it. `setData` changes
 * the loaded data in place — for an answer the page already knows (an
 * optimistic edit, the result a save returned).
 *
 * `enabled: false` sends nothing and shows nothing as loading (a request that
 * waits for another one's answer, or for a right the user may not have);
 * `initial` shows an answer the page kept from last time until the fresh one.
 */
export type UseApi<T> = AsyncState<T> & {
    /** Runs the request again; settles when its answer is on screen (or was superseded). */
    reload: () => Promise<void>;
    /** Changes the loaded data in place. */
    setData: (next: SetStateAction<T | null>) => void;
};

export type UseApiOptions<T> = {
    /** false = send nothing (and show nothing as loading) until it turns true. */
    enabled?: boolean;
    /** Data to show until the first answer — the last answer kept by the page module, so coming back draws at once. */
    initial?: T | null;
};

export function useApi<T>(fn: () => Promise<T>, deps: DependencyList, { enabled = true, initial = null }: UseApiOptions<T> = {}): UseApi<T> {
    const [state, setState] = useState<AsyncState<T>>(() => initialState<T>(enabled, initial));
    // The number of the newest call; an answer carrying an older number is stale.
    const latest = useRef(0);
    // The newest `fn` — a reload after the deps changed must not run an old closure.
    const fnRef = useRef(fn);
    fnRef.current = fn;

    const reload = useCallback((): Promise<void> => {
        const ticket = ++latest.current;
        setState(started);
        return fnRef.current().then(
            (data) => setState((s) => settled(s, ticket, latest.current, { ok: true, data })),
            (error: ApiError) => setState((s) => settled(s, ticket, latest.current, { ok: false, error })),
        );
    }, []);

    useEffect(() => {
        // the counter itself, not its value: the cleanup must bump whatever it is by then
        const counter = latest;
        if (!enabled) {
            counter.current++;
            setState(stopped);
            return undefined;
        }
        reload();
        // an answer that lands after the inputs changed or the page left is stale
        return () => { counter.current++; };
        // the caller's deps are the request's inputs; `reload` never changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, ...deps]);

    const setData = useCallback((next: SetStateAction<T | null>) => {
        setState((s) => ({ ...s, data: typeof next === "function" ? (next as (prev: T | null) => T | null)(s.data) : next }));
    }, []);

    return { ...state, reload, setData };
}
