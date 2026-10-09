import { X } from "lucide-react";
import type { RaidplanPublicBoss } from "../../../api";
import type { AssignCtx } from "../../../lib/raidplan/assign";
import Mentions from "../../../components/raidplan/Mentions";
import ReadTables from "../../../components/raidplan/editor/ReadTables";
import ReadSteps from "../../../components/raidplan/editor/ReadSteps";
import { Switch } from "../../../components/ui";
import { useT } from "../../../i18n";

/**
 * "Alle Aufgaben" of the read view's stage (/p/<token>): the organiser's note, every table of the section (tanks, group healing, the
 * other types) and the tactic's steps - what the old left column showed, without the visitor's own part (that is "Deine Aufgaben").
 * A panel on the map's right side that closes again; in a section without a map it stands in the page's flow. "Karte daneben" (`push`,
 * remembered with the sheet layout) makes the map narrower beside it instead of lying over it; the switch is only there where the window
 * has room for both.
 */
export default function TasksPanel({ boss, title, ctx, meIds, names, loggedIn, loginHref, focusGroup, onFocusGroup, onClose, push = null }: {
    boss: RaidplanPublicBoss;
    title: string;
    ctx: AssignCtx;
    meIds: string[];
    names: string[];
    loggedIn: boolean;
    loginHref: string;
    focusGroup: number;
    onFocusGroup: (n: number) => void;
    /** the close button; without it (a section without a map) the panel is part of the page */
    onClose?: () => void;
    /** the switch "Karte daneben"; null where the window has no room to put the map beside the panel */
    push?: { on: boolean; toggle: () => void } | null;
}) {
    const t = useT();
    const steps = boss.steps || [];
    const empty = boss.assignments.length === 0 && steps.length === 0;
    return (
        <aside className={`rp-sheet-panel${onClose ? "" : " is-inline"}`} aria-label={t("raidBoard.stage.allTasks")}>
            <div className="rp-sheet-panel-head">
                <span className="rp-sheet-panel-title"><span className="rp-kicker">{t("raidBoard.stage.allTasks")}</span><strong>{title}</strong></span>
                {push && (
                    <Switch className="rp-sheet-panel-push" checked={push.on} onChange={push.toggle} label={t("raidBoard.stage.push")} tipHead={t("raidBoard.stage.push")} tip={t("raidBoard.stage.pushTip")} />
                )}
                {onClose && (
                    <button type="button" className="rp-sheet-iconbtn" aria-label={t("raidBoard.stage.close")} data-tip={t("raidBoard.stage.close")} onClick={onClose}>
                        <X size={18} aria-hidden="true" />
                    </button>
                )}
            </div>
            <div className="rp-sheet-panel-body">
                {boss.notes.trim() && <p className="rp-notes-text"><Mentions text={boss.notes} names={names} /></p>}
                {empty
                    ? <p className="rp-muted">{t("raidBoard.stage.noTasks")}</p>
                    : (
                        <>
                            <ReadTables assignments={boss.assignments} ctx={ctx} me={meIds} loggedIn={loggedIn} loginHref={loginHref} focusGroup={focusGroup} onFocusGroup={onFocusGroup} personal={false} />
                            <ReadSteps steps={steps} ctx={ctx} me={meIds} onlyMine={false} />
                        </>
                    )}
            </div>
        </aside>
    );
}
