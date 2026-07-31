// State that outlives the component holding it. Two kinds live here, and the
// difference matters:
//
//   * view preferences (open tab, filters, sort order, grouping) — kept in
//     localStorage, so the page looks the same on the next visit, days later.
//   * form drafts (a pasted loot export, a half-written recruitment text) —
//     kept in sessionStorage, so switching tabs, navigating away or reloading
//     keeps what was typed, but the next visit starts on a blank form instead
//     of resurrecting last week's paste.
//
// Keys share the "eh-" prefix ThemeToggle.tsx already uses; drafts add their own
// "eh-draft-" namespace so the two can never collide. Storage is best-effort
// throughout: private browsing, a disabled store or a value written by an older
// build must degrade to the default, not break the page.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const PREFIX = "eh-";
const DRAFT_PREFIX = "eh-draft-";

function store(session: boolean): Storage | null {
    try {
        return session ? window.sessionStorage : window.localStorage;
    } catch {
        return null;
    }
}

function read<T>(fullKey: string, fallback: T, session = false): T {
    try {
        const raw = store(session)?.getItem(fullKey);
        if (raw === null || raw === undefined) return fallback;
        const parsed = JSON.parse(raw) as unknown;
        // Objects keep their shape across releases by merging over the default,
        // so a stored state from before a filter existed still yields a complete
        // value instead of `undefined` fields.
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
            && fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
            return { ...fallback, ...(parsed as object) } as T;
        }
        return (typeof parsed === typeof fallback ? parsed : fallback) as T;
    } catch {
        return fallback;
    }
}

function write(fullKey: string, value: unknown, session = false): void {
    try {
        store(session)?.setItem(fullKey, JSON.stringify(value));
    } catch {
        // storage unavailable/full — the preference just won't persist
    }
}

function remove(fullKey: string, session = false): void {
    try {
        store(session)?.removeItem(fullKey);
    } catch {
        // same as above: losing the draft is bad, throwing over it would be worse
    }
}

/**
 * Like useState, but seeded from and written back to localStorage under
 * `eh-<key>`. `initial` doubles as the fallback whenever nothing valid is
 * stored, so callers never see `undefined`.
 */
export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [value, setValue] = useState<T>(() => read(PREFIX + key, initial));
    // Skip the write on mount: it would only rewrite what was just read, and on
    // a first visit it would persist the defaults before the user chose
    // anything.
    const mounted = useRef(false);

    useEffect(() => {
        if (!mounted.current) { mounted.current = true; return; }
        write(PREFIX + key, value);
    }, [key, value]);

    return [value, setValue];
}

/**
 * A form draft, kept in sessionStorage under `eh-draft-<key>`.
 *
 * Returns `[draft, patch, clear]`. `patch` merges a few fields at a time (the
 * forms here are flat objects of inputs), `clear` drops the stored draft and
 * resets to `initial` — call it once the form was submitted or abandoned, else
 * the finished content comes back the next time the form opens.
 *
 * `initial` is only read on mount, so a default that arrives with the server
 * data (e.g. a category's preferred loot tool) has to be in place before the
 * form renders; a draft the user actually typed always wins over it.
 */
export function useDraftState<T extends object>(key: string, initial: T): [T, (fields: Partial<T>) => void, () => void] {
    const fullKey = DRAFT_PREFIX + key;
    const [value, setValue] = useState<T>(() => read(fullKey, initial, true));
    const initialRef = useRef(initial);
    const mounted = useRef(false);
    // Set by clear() so the reset-to-defaults right after it isn't written
    // straight back into storage — a cleared draft has to stay cleared.
    const skipWrite = useRef(false);

    useEffect(() => {
        if (!mounted.current) { mounted.current = true; return; }
        if (skipWrite.current) { skipWrite.current = false; return; }
        write(fullKey, value, true);
    }, [fullKey, value]);

    const patch = (fields: Partial<T>) => setValue((v) => ({ ...v, ...fields }));
    const clear = () => {
        skipWrite.current = true;
        setValue(initialRef.current);
        remove(fullKey, true);
    };

    return [value, patch, clear];
}

/**
 * A view choice (the open tab, a list's sort column) that lives in the URL — so
 * it can be linked and survives a reload — *and* is remembered in localStorage,
 * so returning to the page later without a query string (via the sidebar) lands
 * on the same view instead of resetting to the default.
 *
 * An explicit param always wins over what was remembered, and a remembered value
 * that isn't in `allowed` (renamed tab, older build) falls back to the default
 * instead of selecting nothing.
 *
 * `set` keeps the other params (an event id, a character name) intact; pass
 * `mutate` to drop or rewrite the ones that must not survive the switch.
 */
export function usePersistedSearchParam<T extends string>(
    key: string,
    param: string,
    fallback: T,
    allowed: readonly T[],
): [T, (next: T, mutate?: (params: URLSearchParams) => void) => void] {
    const [searchParams, setSearchParams] = useSearchParams();
    const fullKey = PREFIX + key;

    const pick = (v: string | null): T | null => (v && (allowed as readonly string[]).includes(v) ? v as T : null);
    const value = pick(searchParams.get(param)) ?? pick(read<string>(fullKey, "")) ?? fallback;

    const set = (next: T, mutate?: (params: URLSearchParams) => void) => {
        write(fullKey, next);
        const params = new URLSearchParams(searchParams);
        // The default view carries no param, so its URL stays the clean one the
        // sidebar links to.
        if (next === fallback) params.delete(param); else params.set(param, next);
        if (mutate) mutate(params);
        setSearchParams(params);
    };

    return [value, set];
}
