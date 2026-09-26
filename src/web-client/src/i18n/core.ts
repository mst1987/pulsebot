// The pure half of the web client's translations: no React, no Vite, no DOM.
// src/web-client/src/i18n/core.test.ts runs this file as it is (the types stripped), so
// keep its TypeScript to `export type` lines and one-line signatures.
//
// A dictionary is a namespace file under ./locales/<lang>/<ns>.json. Nested
// objects are flattened to dotted keys with the namespace in front, so
// locales/en/raids.json { "list": { "title": "Raids" } } answers "raids.list.title".
// A leaf is either a string or a plural object { one, other } (optionally
// `zero`), picked with Intl.PluralRules by the `count` param.

export type Lang = "de" | "en";
export type Params = Record<string, string | number | null | undefined>;
export type Leaf = string | Record<string, string>;
export type FlatDict = Record<string, Leaf>;

export const LANGS = ["de", "en"];
// German stays the default until the English texts cover every page.
export const DEFAULT_LANG = "de";
export const LOCALES = { de: "de-DE", en: "en-GB" };
export const LANG_LABELS = { de: "Deutsch", en: "English" };

const PLURAL_FORMS = ["zero", "one", "two", "few", "many", "other"];

/** "en", "EN", "en-US" -> "en"; anything unknown -> null. */
export function normalizeLang(raw: unknown): Lang | null {
    const clean = String(raw || "").trim().toLowerCase().slice(0, 2);
    if (clean === "de" || clean === "en") return clean;
    return null;
}

/** A plural leaf: an object whose keys are all plural forms and that has `other`. */
export function isPluralLeaf(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    return keys.length > 0 && keys.includes("other") && keys.every((k) => PLURAL_FORMS.includes(k));
}

/** { a: { b: "x" } } -> { "<prefix>.a.b": "x" }; plural objects stay one leaf. */
export function flatten(tree: unknown, prefix: string, into?: FlatDict): FlatDict {
    const out = into || {};
    if (!tree || typeof tree !== "object") return out;
    for (const [key, value] of Object.entries(tree)) {
        const full = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "string" || isPluralLeaf(value)) out[full] = value;
        else flatten(value, full, out);
    }
    return out;
}

/** "Hallo {name}" + { name: "Ann" } -> "Hallo Ann"; an unknown {x} stays as it is. */
export function interpolate(text: string, params?: Params): string {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => {
        const value = params[name];
        return value === undefined || value === null ? match : String(value);
    });
}

/** The plural form of `count` in `lang` ("one", "other", …). */
export function pluralForm(lang: Lang, count: number): string {
    try {
        return new Intl.PluralRules(LOCALES[lang] || LOCALES.de).select(count);
    } catch {
        return count === 1 ? "one" : "other";
    }
}

/** A leaf as text: a plural object picks its form by params.count. */
export function renderLeaf(leaf: Leaf, lang: Lang, params?: Params): string {
    if (typeof leaf === "string") return interpolate(leaf, params);
    const count = Number(params && params.count);
    const forms = leaf;
    let form = forms.other;
    if (count === 0 && forms.zero !== undefined) form = forms.zero;
    else {
        const picked = forms[pluralForm(lang, Number.isFinite(count) ? count : 0)];
        if (picked !== undefined) form = picked;
    }
    return interpolate(form, params);
}

/**
 * Looks `key` up in the active language, then in German, and at last answers
 * the key itself — a visible "raids.list.title" on the page is how a missing
 * text gets noticed. `onMissing` is told about every key the active language
 * lacks (the German fallback included), so dev and tests can list them.
 */
export function translate(dicts: Record<string, FlatDict>, lang: Lang, key: string, params?: Params, onMissing?: (lang: Lang, key: string) => void): string {
    const own = dicts[lang] && dicts[lang][key];
    if (own !== undefined) return renderLeaf(own, lang, params);
    if (onMissing) onMissing(lang, key);
    const fallback = lang !== DEFAULT_LANG && dicts[DEFAULT_LANG] ? dicts[DEFAULT_LANG][key] : undefined;
    if (fallback !== undefined) return renderLeaf(fallback, "de", params);
    return key;
}

/** Keys one dictionary has and the other lacks, both ways — the parity check. */
export function keyDiff(a: FlatDict, b: FlatDict): { onlyA: string[]; onlyB: string[] } {
    const onlyA = Object.keys(a).filter((k) => !(k in b)).sort();
    const onlyB = Object.keys(b).filter((k) => !(k in a)).sort();
    return { onlyA, onlyB };
}

/** The {params} a text uses, sorted — both languages must use the same ones. */
export function placeholders(leaf: Leaf): string[] {
    const texts = typeof leaf === "string" ? [leaf] : Object.values(leaf);
    const names = new Set();
    for (const text of texts) for (const m of text.matchAll(/\{(\w+)\}/g)) names.add(m[1]);
    return Array.from(names, String).sort();
}
