import { saveLang } from "../api";
import { setLang, useLang, useT, LANG_LABELS, type Lang } from "../i18n";

/**
 * The language switch in the top bar: one small button showing the active
 * language ("DE" / "EN"); a click flips to the other one. The choice is kept in
 * this browser at once (setLang → localStorage) and, for a logged-in menu user,
 * saved for the account so it follows them to another device. A failed save
 * changes nothing on the page — the browser still remembers it.
 */
export default function LangToggle({ csrfToken }: { csrfToken?: string | null }) {
    const lang = useLang();
    const t = useT();
    const next: Lang = lang === "de" ? "en" : "de";

    const toggle = () => {
        setLang(next);
        if (csrfToken) saveLang(csrfToken, next).catch(() => {});
    };

    return (
        <button
            type="button"
            className="ibtn lang-toggle"
            onClick={toggle}
            aria-label={t("shell.lang.switchTo", { lang: LANG_LABELS[next] })}
            data-tip={t("shell.lang.tip")}
            data-tip-sub={t("shell.lang.switchTo", { lang: LANG_LABELS[next] })}
        >
            {lang.toUpperCase()}
        </button>
    );
}
