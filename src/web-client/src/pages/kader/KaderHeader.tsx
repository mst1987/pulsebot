// The head of every Kader page: which Kader (a picker with every Kader and "Neuer
// Kader"), who leads it, the settings — and the status bar of the four steps
// with their counts (Pool → Vorauswahl → Vorläufig → Roster; bench and tentative
// as a small line beside it).
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, SettingsIcon } from "../../components/icons";
import { IconButton, IconTile, buttonClass } from "../../components/ui";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../i18n";
import { countStates, STAGES } from "../../lib/kader/model";
import { Avatar } from "./parts";
import { useKader, type KaderSub } from "./kaderContext";

/** Where each step of the status bar leads. */
const STAGE_SUB: Record<string, KaderSub> = { pool: "pool", selected: "vorauswahl", provisional: "roster", roster: "roster" };

function KaderPicker() {
    const t = useT();
    const { view, kader, canWrite, open } = useKader();
    const [shown, setShown] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useDismiss(ref, shown, () => setShown(false));
    return (
        <div className="kp-picker" ref={ref}>
            <button type="button" className="kp-picker-btn" aria-haspopup="true" aria-expanded={shown} onClick={() => setShown(!shown)}>
                <span className="kp-picker-name">{kader.name}</span>
                <ChevronDownIcon />
            </button>
            {shown && (
                <div className="kp-menu kp-picker-menu" role="menu" aria-label={t("kader.header.pick")}>
                    {view.kaders.map((k) => (
                        <Link key={k.id} role="menuitemradio" aria-checked={k.id === kader.id} to={`/kader/${k.id}/pool`}
                            className={`kp-menuopt${k.id === kader.id ? " kp-current" : ""}`} onClick={() => setShown(false)}>
                            <span className="kp-grow">{k.name}</span>
                            <span className="kp-mono kp-muted" data-tip={t("kader.header.countTip")}>{k.counts.roster}/{Object.values(k.counts).reduce((a, b) => a + b, 0)}</span>
                        </Link>
                    ))}
                    {canWrite && (
                        <button type="button" role="menuitem" className="kp-menuopt kp-menu-add" onClick={() => { setShown(false); open({ type: "create" }); }}>
                            <PlusIcon />{t("kader.header.new")}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

export default function KaderHeader() {
    const t = useT();
    const { kader, canWrite, open } = useKader();
    return (
        <div className="kp-top">
            <IconTile icon="inv_misc_groupneedmore" tone="kader" size="lg" />
            <div className="kp-top-text">
                <span className="kicker kp-accent2">{t("kader.header.kicker")}</span>
                <KaderPicker />
            </div>
            <span className="kp-grow" />
            <div className="kp-leads">
                <span className="kicker">{t("kader.header.leads")}</span>
                <span className="kp-avatars">
                    {kader.leads.length ? kader.leads.map((id, i) => <Avatar key={id} userId={id} index={i} />) : <span className="kp-muted">{t("kader.header.noLeads")}</span>}
                </span>
            </div>
            {canWrite && <IconButton icon={<SettingsIcon />} tip={t("kader.header.settings")} onClick={() => open({ type: "settings" })} />}
        </div>
    );
}

/** The four steps with their counts; the step of the open page stands out. */
export function StageNav({ sub }: { sub: KaderSub }) {
    const t = useT();
    const { kader } = useKader();
    const counts = countStates(kader);
    const current = sub === "pool" ? "pool" : sub === "vorauswahl" || sub === "uebersicht" ? "selected" : "provisional";
    return (
        <nav className="kp-stages" aria-label={t("kader.nav.aria")}>
            {STAGES.map((stage, i) => (
                <span key={stage} className="kp-stage-wrap">
                    <Link to={`/kader/${kader.id}/${STAGE_SUB[stage]}`} className={`kp-stage${stage === current ? " kp-active" : ""}`} aria-current={stage === current ? "page" : undefined}>
                        <span className="kp-mono">{i + 1}</span>
                        <span className="kp-stage-label">{t(`kader.stage.${stage}`)}</span>
                        <span className="kp-mono kp-muted">{counts[stage]}</span>
                    </Link>
                    {i < STAGES.length - 1 && <span className="kp-stage-arrow" aria-hidden="true"><ChevronRightIcon /></span>}
                </span>
            ))}
            <span className="kp-stage-more">{t("kader.nav.more", { bench: counts.bench, tentative: counts.tentative })}</span>
            {sub === "roster" && (
                <>
                    <span className="kp-grow" />
                    <Link to={`/kader/${kader.id}/setups`} className={buttonClass("ghost", "md", false, "kp-stage-act")}>{t("kader.nav.setups")}</Link>
                </>
            )}
        </nav>
    );
}
