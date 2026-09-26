import type { ApiError } from "../api";

// The state of one request as a page sees it (hooks/useApi.ts), and the pure
// rules that move it — kept out of the hook so the race protection can be
// tested without React: a call is numbered when it starts, and its answer
// counts only while it is still the newest call. An older answer arriving
// after a newer request was sent, after the inputs changed or after the page
// left changes nothing.

/** What a page knows about one request: the last answer, the last error, whether a call is in flight. */
export type AsyncState<T> = { data: T | null; error: ApiError | null; loading: boolean };

/** How a call ended. */
export type Outcome<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/**
 * Before the first answer: `loading` from the start when a request is about to
 * go out, so the page never flashes "nothing"; `initial` is an answer kept
 * from last time (shown until the fresh one lands).
 */
export function initialState<T>(enabled: boolean, initial: T | null = null): AsyncState<T> {
    return { data: initial, error: null, loading: enabled };
}

/** A call went out: the last answer and error stay on screen until the new one lands. */
export function started<T>(state: AsyncState<T>): AsyncState<T> {
    return state.loading ? state : { ...state, loading: true };
}

/**
 * Call `ticket` answered while `latest` is the newest call issued. A stale
 * answer (`ticket` < `latest`) is dropped; a fresh success replaces the data
 * and clears the error, a fresh failure keeps the data and records the error.
 */
export function settled<T>(state: AsyncState<T>, ticket: number, latest: number, outcome: Outcome<T>): AsyncState<T> {
    if (ticket !== latest) return state;
    if (outcome.ok === false) return { ...state, error: outcome.error, loading: false };
    return { data: outcome.data, error: null, loading: false };
}

/** Nothing is awaited any more (the request was switched off): the spinner goes, data and error stay. */
export function stopped<T>(state: AsyncState<T>): AsyncState<T> {
    return state.loading ? { ...state, loading: false } : state;
}
