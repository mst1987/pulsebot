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
// fallback for any key English lacks, and src/web-client/src/i18n/core.test.ts fails
// as soon as the two languages hold different keys.
import { useSyncExternalStore } from "react";
import { DEFAULT_LANG, LOCALES, flatten, normalizeLang, translate, translateParts, type FlatDict, type Lang, type Params } from "./core";

export { LANGS, LANG_LABELS, type Lang, type Params } from "./core";

const STORAGE_KEY = "eh-lang";

// Only the active language is downloaded (#436). German is the fallback of
// every other language, so it is always there, bundled with this module; any
// other language is a chunk of its own that arrives when it is switched to.
// (The glob needs a literal pattern, hence "de" and not DEFAULT_LANG.)
const fallbackFiles = import.meta.glob("./locales/de/*.json", { eager: true, import: "default" });
const lazyFiles = import.meta.glob(["./locales/*/*.json", "!./locales/de/*.json"], { import: "default" });

const FILE_RE = /\.\/locales\/(\w+)\/([\w-]+)\.json$/;

function fillDict(into: FlatDict, file: string, tree: unknown): void {
    const m = file.match(FILE_RE);
    if (m) flatten(tree, m[2], into);
}

const DICTS: Record<string, FlatDict> = { de: {}, en: {} };
for (const [file, tree] of Object.entries(fallbackFiles)) fillDict(DICTS.de, file, tree);

const loaded = new Set<Lang>(["de"]);
const loading = new Map<Lang, Promise<void>>();

/** Downloads one language's files once; a failed download leaves it unloaded (German stays). */
function loadLang(lang: Lang): Promise<void> {
    if (loaded.has(lang)) return Promise.resolve();
    let promise = loading.get(lang);
    if (!promise) {
        const own = Object.entries(lazyFiles).filter(([file]) => file.match(FILE_RE)?.[1] === lang);
        promise = Promise.all(own.map(([file, load]) => load().then((tree) => [file, tree] as const)))
            .then((trees) => {
                const dict: FlatDict = {};
                for (const [file, tree] of trees) fillDict(dict, file, tree);
                DICTS[lang] = dict;
                loaded.add(lang);
            })
            .catch((err) => {
                console.warn(`[i18n] could not load ${lang}:`, err);
            })
            .finally(() => { loading.delete(lang); });
        loading.set(lang, promise);
    }
    return promise;
}

function readStored(): Lang | null {
    try {
        return normalizeLang(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        return null;
    }
}

// The page starts in German and switches once the chosen language is loaded —
// main.tsx waits for that (langReady) before it draws anything, so a visitor
// never sees the German texts flash first.
let current: Lang = normalizeLang(DEFAULT_LANG) || "de";
/** The language asked for last; it becomes `current` once its texts are there. */
let wanted: Lang = readStored() || current;
let switching: Promise<void> = Promise.resolve();
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

/**
 * Makes `wanted` the active language as soon as its texts are loaded. A later
 * switch wins over one still downloading: only the language asked for last is
 * applied.
 */
function switchToWanted(): Promise<void> {
    const lang = wanted;
    switching = loadLang(lang).then(() => {
        if (wanted !== lang || lang === current || !loaded.has(lang)) return;
        current = lang;
        applyToDocument(lang);
        for (const listener of listeners) listener();
    });
    return switching;
}
if (wanted !== current) switchToWanted();

/**
 * Resolves once the language asked for last is loaded and active (at once when
 * it already is). main.tsx waits for it before the first render, and the menu
 * waits for it after the account's saved language was applied (App.tsx).
 */
export function langReady(): Promise<void> {
    return switching;
}

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
 * tells every subscribed component — once the language's texts are loaded (the
 * page keeps the old language until then, it never shows half of each).
 * Saving it for the account (so it follows the user to another device) is the
 * caller's business — see LangToggle.
 */
export function setLang(next: Lang): void {
    const lang = normalizeLang(next);
    if (!lang) return;
    try {
        window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        // storage unavailable — the choice lasts until the next reload
    }
    wanted = lang;
    if (lang === current) return;
    switchToWanted();
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

/**
 * `t` as pieces for JSX children — `<Badge>{tParts("x.open", { count })}</Badge>`
 * renders the same text nodes as the former `<Badge>{count} offen</Badge>`, so
 * a counter badge keeps its exact look (a text in one node is drawn a subpixel
 * apart from the same text in two).
 */
export function tParts(key: string, params?: Params): string[] {
    return translateParts(DICTS, current, key, params, onMissing);
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
