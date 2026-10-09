// The head of every Kader page: which Kader (a picker with every Kader and "Neuer
// Kader"), who leads it and who is here right now (Presence.tsx), the Kader's
// activity log ("Aktivität"), the settings — and the status bar: how many players
// stand in each state (Pool → Vorauswahl → Vorläufig → Roster · Bench ·
// Tentative), each state with its icon and its count, the states of the open
// page marked. On the decision page the bar ends with the raid roster action
// (RosterLink.tsx, #658) and the example setups.
import { Fragment, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { KaderState } from "../../api";
import { ChevronDownIcon, ChevronRightIcon, ClockIcon, PlusIcon, SettingsIcon } from "../../components/ui/icons";
import { IconButton, IconTile, buttonClass } from "../../components/ui";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../i18n";
import { countStates } from "../../lib/kader/model";
import { StateIcon } from "./parts";
import { HeaderPeople } from "./Presence";
import RosterLink from "./RosterLink";
import { useKader, type KaderSub } from "./kaderContext";

/** Which page shows a state. */
const STATE_SUB: Record<KaderState, KaderSub> = { pool: "pool", selected: "vorauswahl", provisional: "roster", roster: "roster", bench: "roster", tentative: "roster" };
/** The steps before a decision, then the three states a decision leads to (one group). */
const FLOW: KaderState[] = ["pool", "selected", "provisional"];
const DECIDED: KaderState[] = ["roster", "bench", "tentative"];

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
                            <span className="kp-sub">{t("kader.header.countLine", { roster: k.counts.roster, total: Object.values(k.counts).reduce((a, b) => a + b, 0) })}</span>
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
    const { canWrite, open } = useKader();
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
                <HeaderPeople />
            </div>
            <span className="kp-top-act">
                <button type="button" className={buttonClass("ghost", "sm", true, "kp-logbtn")} data-tip={t("kader.log.activityTip")} onClick={() => open({ type: "activity" })}>
                    <ClockIcon />{t("kader.log.activity")}
                </button>
                {canWrite && <IconButton icon={<SettingsIcon />} tip={t("kader.header.settings")} onClick={() => open({ type: "settings" })} />}
            </span>
        </div>
    );
}

/** How many players stand in each state; the states of the open page stand out. */
export function StageNav({ sub }: { sub: KaderSub }) {
    const t = useT();
    const { kader } = useKader();
    const counts = countStates(kader);
    const segment = (s: KaderState) => {
        const active = STATE_SUB[s] === sub || (s === "selected" && sub === "uebersicht");
        const tip = t(`kader.nav.count.${s}`, { count: counts[s] });
        return (
            <Link key={s} to={`/kader/${kader.id}/${STATE_SUB[s]}`} className={`kp-stage kp-stage-${s}${active ? " kp-active" : ""}`}
                aria-current={active ? "page" : undefined} aria-label={tip} data-tip={tip}>
                <StateIcon state={s} />
                <span className="kp-stage-label">{t(`kader.state.${s}`)}</span>
                <span className="kp-stage-n" aria-hidden="true">{counts[s]}</span>
            </Link>
        );
    };
    return (
        <nav className="kp-stages" aria-label={t("kader.nav.aria")}>
            <span className="kicker kp-stages-kicker">{t("kader.nav.kicker")}</span>
            {FLOW.map((s) => (
                <Fragment key={s}>
                    {segment(s)}
                    <span className="kp-stage-arrow" aria-hidden="true"><ChevronRightIcon /></span>
                </Fragment>
            ))}
            <span className="kp-stage-group">{DECIDED.map(segment)}</span>
            {sub === "roster" && (
                <>
                    <span className="kp-grow" />
                    <RosterLink />
                    <Link to={`/kader/${kader.id}/setups`} className={buttonClass("ghost", "md", false, "kp-stage-act")}>{t("kader.nav.setups")}</Link>
                </>
            )}
        </nav>
    );
}
