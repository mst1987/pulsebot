// The head of every Kader page, after the report head of Warcraft Logs: three fixed
// lines with one job each, direct children of the page so that the middle one can
// stick to the page and not to a short wrapper.
// 1. Title: back to all Kader, the Kader's icon and name with its picker (long names
//    are cut, never wrapped), right the leads and who is here (Presence.tsx), the
//    activity log and the settings.
// 2. Tabs: how many players stand in each state (Pool → Vorauswahl → Vorläufig | Roster
//    · Bench · Tentative) and the planning pages, which fold into a menu in a narrow
//    page. Only this line sticks, right under the topbar (--topbar-h, Shell.tsx). On the
//    decision page Pool and Vorauswahl also take a dropped card.
// 3. Tools of the page, on the decision and the composition page: RosterLink.tsx with
//    the one green button of TakeoverWizard.tsx. Every other page keeps only the line
//    of a taken-over Kader there.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { KaderState } from "../../api";
import { ArrowLeftIcon, ChevronDownIcon, PlusIcon, SettingsIcon } from "../../components/ui/icons/icons";
import { IconButton, WowIcon, buttonClass } from "../../components/ui";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../i18n";
import { countStates } from "../../lib/kader/model";
import { useDropZone } from "./dnd";
import { useMovePlayer } from "./useMovePlayer";
import { HeaderPeople } from "./live/Presence";
import RosterLink, { BarMenu } from "./RosterLink";
import { TakeoverLine } from "./modals/TakeoverWizard";
import { useKader, type KaderSub } from "./kaderContext";

/** Which page shows a state. */
const STATE_SUB: Record<KaderState, KaderSub> = { pool: "pool", selected: "vorauswahl", provisional: "roster", roster: "roster", bench: "roster", tentative: "roster" };
/** The tabs in their order: the steps before a decision, then the three states a decision leads to. */
const STATES: KaderState[] = ["pool", "selected", "provisional", "roster", "bench", "tentative"];
/** The sign in front of a tab: an arrow between the steps, a line before the decided states. */
const TAB_MARK: Partial<Record<KaderState, string>> = { selected: " kp-htab-arrow", provisional: " kp-htab-arrow", roster: " kp-htab-line" };
/** The states the composition page counts (lib/kader/composition BASE_STATES). */
const COMPOSED: KaderState[] = ["provisional", "roster"];
/** The states a card can be dropped on in the tabs: straight back from the decision page. */
const DROP_BACK: KaderState[] = ["pool", "selected"];

function KaderPicker() {
    const t = useT();
    const { view, kader, canWrite, open } = useKader();
    const [shown, setShown] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useDismiss(ref, shown, () => setShown(false));
    return (
        <div className="kp-picker" ref={ref}>
            <button type="button" className="kp-picker-btn" aria-haspopup="true" aria-expanded={shown} data-tip={kader.name} onClick={() => setShown(!shown)}>
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

/**
 * One state as a tab, always a link. On the decision page the steps before it also
 * take a dropped card; only there, because the setup page drags the same kind of
 * card for something else.
 */
function StateTab({ state, sub, count }: { state: KaderState; sub: KaderSub; count: number }) {
    const t = useT();
    const { kader, canWrite } = useKader();
    const move = useMovePlayer();
    const drop = useDropZone((userId) => void move(userId, state), sub === "roster" && canWrite && DROP_BACK.includes(state));
    const active = STATE_SUB[state] === sub || (state === "selected" && sub === "uebersicht") || (sub === "zusammensetzung" && COMPOSED.includes(state));
    const tip = t(`kader.nav.count.${state}`, { count });
    return (
        <Link to={`/kader/${kader.id}/${STATE_SUB[state]}`} className={`kp-htab${TAB_MARK[state] || ""}${active ? " kp-active" : ""}${drop.over ? " kp-over" : ""}`}
            aria-current={active ? "page" : undefined} aria-label={tip} data-tip={tip} {...drop.props}>
            <span>{t(`kader.state.${state}`)}</span>
            <span className="kp-htab-n" aria-hidden="true">{count}</span>
        </Link>
    );
}

/** The sticky line: the states with their counts and the planning pages. */
function KaderTabs({ sub }: { sub: KaderSub }) {
    const t = useT();
    const { kader } = useKader();
    const counts = countStates(kader);
    const composing = sub === "zusammensetzung";
    const composition = `/kader/${kader.id}/zusammensetzung`;
    const setups = `/kader/${kader.id}/setups`;
    return (
        <nav className="kp-htabs" aria-label={t("kader.nav.aria")}>
            <div className="kp-htabs-in">
                <div className="kp-status">
                    {STATES.map((s) => <StateTab key={s} state={s} sub={sub} count={counts[s]} />)}
                </div>
                <div className="kp-plan">
                    <Link to={composition} className={`kp-htab${composing ? " kp-active" : ""}`} aria-current={composing ? "page" : undefined}>{t("kader.nav.composition")}</Link>
                    <Link to={setups} className="kp-htab" data-tip={t("kader.nav.setupsTip")}>{t("kader.nav.setups")}</Link>
                </div>
                <BarMenu label={t("kader.nav.planGroup")} className="kp-plan-menu" buttonClass={`kp-htab kp-htab-btn${composing ? " kp-active" : ""}`}>
                    {(close) => (
                        <>
                            <Link role="menuitem" to={composition} className="kp-menuopt" aria-current={composing ? "page" : undefined} onClick={close}>{t("kader.nav.composition")}</Link>
                            <Link role="menuitem" to={setups} className="kp-menuopt" data-tip={t("kader.nav.setupsTip")} onClick={close}>{t("kader.nav.setups")}</Link>
                        </>
                    )}
                </BarMenu>
            </div>
        </nav>
    );
}

export default function KaderHeader({ sub }: { sub: KaderSub }) {
    const t = useT();
    const { canWrite, open } = useKader();
    return (
        <>
            <div className="kp-title">
                <div className="kp-title-in">
                    <Link to="/kader" className="kp-back"><ArrowLeftIcon />{t("kader.header.all")}</Link>
                    <div className="kp-title-name">
                        <WowIcon name="kader" size={30} />
                        <KaderPicker />
                    </div>
                    <div className="kp-title-meta">
                        <div className="kp-leads">
                            <span className="kp-lab">{t("kader.header.leads")}</span>
                            <HeaderPeople />
                        </div>
                        <button type="button" className={buttonClass("ghost", "sm", false, "kp-txtbtn")} data-tip={t("kader.log.activityTip")} onClick={() => open({ type: "activity" })}>
                            {t("kader.log.activity")}
                        </button>
                        {canWrite && <IconButton icon={<SettingsIcon />} size="sm" tip={t("kader.header.settings")} onClick={() => open({ type: "settings" })} />}
                    </div>
                </div>
            </div>
            {sub !== "fragen" && sub !== "setups" && <KaderTabs sub={sub} />}
            {sub === "roster" || sub === "zusammensetzung" ? <RosterLink /> : <TakeoverLine />}
        </>
    );
}
