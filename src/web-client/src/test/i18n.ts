// The real translations in a test: libs and components call `t` from
// ../i18n as they do in the browser (German by default). For an English case,
// switch the page language and wait until its texts are loaded:
//
//   beforeAll(() => switchLang("en"));
//   afterAll(() => switchLang("de"));
import { langReady, setLang, type Lang } from "../i18n";

export async function switchLang(lang: Lang): Promise<void> {
    setLang(lang);
    await langReady();
}

/** Runs `fn` with the page in `lang`, then switches back to German. */
export async function inLang<T>(lang: Lang, fn: () => T): Promise<T> {
    await switchLang(lang);
    try {
        return fn();
    } finally {
        await switchLang("de");
    }
}
