// The web client's translations — the React/browser half around ./core.ts.
//
// How to use it (docs/web-admin.md, "Sprache (i18n)"):
//   * in a component: `const t = useT();` then `t("raids.list.title")` or
//     `t("signups.count", { count: 3 })`. The hook subscribes the component, so
//     it re-renders when the language flips.
//   * in a plain lib function that a component calls while rendering: import
//     `t` from here — it reads the active language at call time. Never compute
//     a label at module load (`const LABEL = t(…)` at the top of a file): that
//     freezes the language the page was loaded in.
//   * dates and numbers: `locale()` gives "de-DE" / "en-GB".
//
// The texts live in ./locales/<lang>/<namespace>.json; a new namespace file is
// picked up by the glob below without touching this file. German is the
// fallback for any key English lacks, and test/web-client/i18n.test.js fails
// as soon as the two languages hold different keys.
import { useSyncExternalStore } from "react";
import { DEFAULT_LANG, LOCALES, flatten, normalizeLang, translate, type FlatDict, type Lang, type Params } from "./core";

export { LANGS, LANG_LABELS, type Lang, type Params } from "./core";

const STORAGE_KEY = "eh-lang";

const files = import.meta.glob("./locales/*/*.json", { eager: true, import: "default" });

function buildDicts(): Record<string, FlatDict> {
    const dicts: Record<string, FlatDict> = { de: {}, en: {} };
    for (const [file, tree] of Object.entries(files)) {
        const m = file.match(/\.\/locales\/(\w+)\/([\w-]+)\.json$/);
        if (!m || !dicts[m[1]]) continue;
        flatten(tree, m[2], dicts[m[1]]);
    }
    return dicts;
}

const DICTS = buildDicts();

function readStored(): Lang | null {
    try {
        return normalizeLang(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        return null;
    }
}

let current: Lang = readStored() || normalizeLang(DEFAULT_LANG) || "de";
const listeners = new Set<() => void>();
const reported = new Set<string>();

function applyToDocument(lang: Lang) {
    try {
        document.documentElement.setAttribute("lang", lang);
    } catch {
        // no document (tests, SSR) — nothing to label
    }
}
applyToDocument(current);

/** The active language. */
export function getLang(): Lang {
    return current;
}

/** "de-DE" / "en-GB" — for toLocaleString and Intl formatters. */
export function locale(): string {
    return LOCALES[current];
}

/**
 * Switches the language for the whole page, remembers it in this browser and
 * tells every subscribed component. Saving it for the account (so it follows
 * the user to another device) is the caller's business — see LangToggle.
 */
export function setLang(next: Lang): void {
    const lang = normalizeLang(next);
    if (!lang) return;
    try {
        window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        // storage unavailable — the choice lasts until the next reload
    }
    if (lang === current) return;
    current = lang;
    applyToDocument(lang);
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function onMissing(lang: Lang, key: string) {
    if (!import.meta.env.DEV) return;
    const id = `${lang}:${key}`;
    if (reported.has(id)) return;
    reported.add(id);
    console.warn(`[i18n] missing ${lang} text: ${key}`);
}

/** Translates `key` in the active language (German fallback, else the key). */
export function t(key: string, params?: Params): string {
    return translate(DICTS, current, key, params, onMissing);
}

/** Whether `key` exists in the active language or the German fallback. */
export function hasKey(key: string): boolean {
    return DICTS[current][key] !== undefined || DICTS.de[key] !== undefined;
}

/**
 * For a key built from data (`wow.class.${id}`, `shell.menu.${id}`): the text
 * when there is one, else `fallback` — usually the German label the server sent.
 */
export function tOr(key: string, fallback: string, params?: Params): string {
    return hasKey(key) ? t(key, params) : fallback;
}

export type TFunction = typeof t;

/** The active language, re-rendering the component when it changes. */
export function useLang(): Lang {
    return useSyncExternalStore(subscribe, getLang, getLang);
}

/** `t` for a component: same function, but the component re-renders on a switch. */
export function useT(): TFunction {
    useLang();
    return t;
}
