// The Kaderplaner without any Kader yet: the flow from Discord to the roster in
// six steps and the four rules behind it, and the button for the first Kader.
import { Button, IconTile } from "../../components/ui";
import { ChevronRightIcon, PlusIcon, RecruitmentIcon, SheetIcon } from "../../components/ui/icons";
import { useT } from "../../i18n";
import { StateIcon } from "./parts";

const STEPS = [
    { key: "import", kind: "action" },
    { key: "pool", kind: "state" },
    { key: "selected", kind: "state" },
    { key: "overview", kind: "view" },
    { key: "provisional", kind: "state" },
    { key: "roster", kind: "state" },
] as const;
const RULES = ["state", "questions", "history", "internal"] as const;

function StepIcon({ step }: { step: typeof STEPS[number]["key"] }) {
    if (step === "import") return <span className="kp-sico" aria-hidden="true"><RecruitmentIcon /></span>;
    if (step === "overview") return <span className="kp-sico" aria-hidden="true"><SheetIcon /></span>;
    return <StateIcon state={step} />;
}

export default function KaderStart({ canWrite, onCreate }: { canWrite: boolean; onCreate: () => void }) {
    const t = useT();
    return (
        <div className="kp-page kp-startpage">
            <div className="kp-top">
                <IconTile icon="inv_misc_groupneedmore" tone="kader" size="lg" />
                <div className="kp-top-text">
                    <span className="kicker kp-accent2">{t("kader.start.kicker")}</span>
                    <h1 className="kp-start-title">{t("kader.start.title")}</h1>
                </div>
                <span className="kp-grow" />
                {canWrite && <Button icon={<PlusIcon />} onClick={onCreate}>{t("kader.start.create")}</Button>}
            </div>
            <ol className="kp-flow">
                {STEPS.map((s, i) => (
                    <li key={s.key} className={`kp-flow-step kp-flow-${s.kind}`}>
                        <span className="kp-flow-kind"><StepIcon step={s.key} /><span className="kicker">{t(`kader.start.kind.${s.kind}`)}</span></span>
                        <span className="kp-flow-title">{t(`kader.start.step.${s.key}.title`)}</span>
                        <span className="kp-flow-what">{t(`kader.start.step.${s.key}.what`)}</span>
                        {i < STEPS.length - 1 && <span className="kp-flow-arrow" aria-hidden="true"><ChevronRightIcon /></span>}
                    </li>
                ))}
            </ol>
            <ul className="kp-rules">
                {RULES.map((r) => (
                    <li key={r}>
                        <span className="kicker">{t(`kader.start.rule.${r}.k`)}</span>
                        <span>{t(`kader.start.rule.${r}.t`)}</span>
                    </li>
                ))}
            </ul>
            {!canWrite && <p className="kp-hint">{t("kader.start.readOnly")}</p>}
        </div>
    );
}
