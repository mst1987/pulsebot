// useState that survives a reload (and a tab switch inside the SPA, which
// unmounts the page component) by mirroring its value into localStorage. Used
// for view preferences — table filters, sort order, grouping — never for data
// the server owns.
//
// Keys share the "eh-" prefix ThemeToggle.tsx already uses. Storage is
// best-effort throughout: private browsing, a disabled store or a value written
// by an older build must degrade to the default, not break the page.
import { useEffect, useRef, useState } from "react";

const PREFIX = "eh-";

function read<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        if (raw === null) return fallback;
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

/**
 * Like useState, but seeded from and written back to localStorage under
 * `eh-<key>`. `initial` doubles as the fallback whenever nothing valid is
 * stored, so callers never see `undefined`.
 */
export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
    const [value, setValue] = useState<T>(() => read(key, initial));
    // Skip the write on mount: it would only rewrite what was just read, and on
    // a first visit it would persist the defaults before the user chose
    // anything.
    const mounted = useRef(false);

    useEffect(() => {
        if (!mounted.current) { mounted.current = true; return; }
        try {
            localStorage.setItem(PREFIX + key, JSON.stringify(value));
        } catch {
            // storage unavailable/full — the preference just won't persist
        }
    }, [key, value]);

    return [value, setValue];
}
