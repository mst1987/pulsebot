import type { SystemStatus } from "../../api";
import { useT } from "../../i18n";
import { findingText } from "../../lib/system/findings";
import { AlertIcon, CheckIcon } from "../../components/ui/icons";

// The verdict at the top of the page: one headline in large type, then one
// sentence per finding with the numbers it rests on and a recommendation. The
// colour is the only traffic light on the page that is always there.

/** Findings shown at once; the rest are worse-first anyway and would only repeat the picture. */
const SHOWN = 3;

export default function Verdict({ status }: { status: SystemStatus }) {
    const t = useT();
    const { level, findings, warmingUp } = status.assessment;
    const shown = findings.slice(0, SHOWN).map((f) => ({ f, ...findingText(f) }));
    const head = level === "bad" ? t("system.verdict.bad") : level === "warn" ? t("system.verdict.warn") : t("system.verdict.ok");
    return (
        <section className={`sy-verdict sy-${level}`} aria-live="polite" aria-label={t("system.verdict.aria")}>
            <span className="sy-verdict-ic" aria-hidden="true">{level === "ok" ? <CheckIcon /> : <AlertIcon />}</span>
            <div className="sy-verdict-body">
                <h2 className="sy-verdict-head">{head}</h2>
                {shown.length === 0 && (
                    <p className="sy-verdict-text">{warmingUp ? t("system.verdict.warmingUp") : t("system.verdict.okText")}</p>
                )}
                {shown.map(({ f, text, advice, detail }) => (
                    <div key={f.id} className={`sy-finding sy-${f.level}`}>
                        <p className="sy-verdict-text">{text}</p>
                        {detail && <p className="sy-verdict-detail">{detail}</p>}
                        {advice && <p className="sy-verdict-advice"><span className="sy-label">{t("system.verdict.advice")}</span> {advice}</p>}
                    </div>
                ))}
                {shown.length > 0 && warmingUp && <p className="sy-verdict-detail">{t("system.verdict.warmingUpPartial")}</p>}
            </div>
        </section>
    );
}
