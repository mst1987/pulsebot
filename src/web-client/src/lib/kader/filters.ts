// The filter menus of the Kaderplaner's lists (Pool, Vorauswahl · Übersicht):
// each menu is a set of options with a test; several picks inside one menu are
// "any of", the menus together "all of". Every option counts how many would
// remain with the other menus applied. Pure.
import type { Tone } from "./colors";

/** What an option shows beside its label: a WoW icon of a class, spec or role. */
export type FilterIcon = { kind: "class" | "spec" | "role"; key: string };

/** `tone`: an answer option's colour (weekday or palette), drawn as a dot before the label. */
export type FilterOption<T> = { value: string; label: string; test: (item: T) => boolean; icon?: FilterIcon; color?: string; tone?: Tone;
    /** An interviewer: the option shows their coloured initial ("" = nobody assigned). */
    lead?: string;
};
export type FilterDef<T> = { key: string; label: string; options: FilterOption<T>[] };
/** The picks per menu key. */
export type FilterState = Record<string, string[]>;

/** Whether an item passes every menu (except `skip`, for that menu's own counts). */
export function passes<T>(item: T, defs: FilterDef<T>[], state: FilterState, skip = ""): boolean {
    return defs.every((def) => {
        if (def.key === skip) return true;
        const picked = state[def.key] || [];
        if (!picked.length) return true;
        return def.options.some((o) => picked.includes(o.value) && o.test(item));
    });
}

/** How many items an option would leave, with the other menus applied. */
export function countFor<T>(items: T[], defs: FilterDef<T>[], state: FilterState, def: FilterDef<T>, option: FilterOption<T>): number {
    return items.filter((item) => option.test(item) && passes(item, defs, state, def.key)).length;
}

export function toggle(state: FilterState, key: string, value: string): FilterState {
    const list = state[key] || [];
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    const out = { ...state, [key]: next };
    if (!next.length) delete out[key];
    return out;
}

/** The active picks as chips: `{ key, value, label }` with the menu's name in front. */
export function chipsOf<T>(defs: FilterDef<T>[], state: FilterState): { key: string; value: string; label: string }[] {
    const out: { key: string; value: string; label: string }[] = [];
    for (const def of defs) {
        for (const value of state[def.key] || []) {
            const option = def.options.find((o) => o.value === value);
            if (option) out.push({ key: def.key, value, label: `${def.label}: ${option.label}` });
        }
    }
    return out;
}

/** A stored state, repaired: only menus and options that exist today. */
export function cleanState<T>(defs: FilterDef<T>[], raw: unknown): FilterState {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const out: FilterState = {};
    for (const def of defs) {
        const list = Array.isArray(src[def.key]) ? (src[def.key] as unknown[]).map(String) : [];
        const valid = list.filter((v) => def.options.some((o) => o.value === v));
        if (valid.length) out[def.key] = valid;
    }
    return out;
}

export const pickedCount = (state: FilterState): number => Object.values(state).reduce((n, l) => n + l.length, 0);
