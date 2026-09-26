import { saveLang } from "../api";
import { LANGS, setLang, useLang, useT, LANG_LABELS, type Lang } from "../i18n";

/**
 * The language switch in the top bar: a small two-part pill "DE | EN" with the
 * active language lit — which one is on is visible without a hover, and a click
 * on the other part switches. The choice is kept in this browser at once
 * (setLang → localStorage) and, for a logged-in menu user, saved for the
 * account so it follows them to another device. A failed save changes nothing
 * on the page — the browser still remembers it.
 */
export default function LangToggle({ account = false }: { account?: boolean }) {
    const lang = useLang();
    const t = useT();

    const pick = (next: Lang) => {
        if (next === lang) return;
        setLang(next);
        if (account) saveLang(next).catch(() => {});
    };

    return (
        <div className="lang-toggle" role="group" aria-label={t("shell.lang.tip")} data-tip={t("shell.lang.tip")}>
            {(LANGS as Lang[]).map((l) => (
                <button
                    key={l}
                    type="button"
                    lang={l}
                    className={l === lang ? "is-on" : undefined}
                    aria-pressed={l === lang}
                    aria-label={l === lang ? LANG_LABELS[l] : t("shell.lang.switchTo", { lang: LANG_LABELS[l] })}
                    onClick={() => pick(l)}
                >
                    {l.toUpperCase()}
                </button>
            ))}
        </div>
    );
}
