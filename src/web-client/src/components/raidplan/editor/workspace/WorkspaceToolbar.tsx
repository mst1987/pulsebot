import type { ReactNode } from "react";
import { Clapperboard, Image as ImageIcon, ListChecks } from "lucide-react";
import { useT } from "../../../../i18n";
import type { PlanView } from "../planView";

/**
 * "Aufgaben | Karte": the look of the UI kit's Segment (`seg sm`, radio buttons), written out here because the map option of
 * Standard / Allgemein is only `aria-disabled` - a really disabled button gets no hover in every browser, and its tooltip says
 * why there is no map.
 */
export function ViewSwitch({ view, onView, mapless }: { view: PlanView; onView: (view: PlanView) => void; mapless: boolean }) {
    const t = useT();
    const opt = (value: PlanView, label: string, icon: ReactNode, tip: string, off = false) => (
        <button
            type="button" role="radio" aria-checked={view === value} aria-disabled={off || undefined} className={`seg-opt${view === value ? " active" : ""}${off ? " rp-viewopt-off" : ""}`}
            data-tip={tip} onClick={() => { if (!off && view !== value) onView(value); }}
        >
            {icon}{label}
        </button>
    );
    return (
        <div className="seg sm rp-viewswitch" role="radiogroup" aria-label={t("raidBoard.views.label")}>
            {opt("tasks", t("raidBoard.views.tasks"), <ListChecks size={15} aria-hidden="true" />, t("raidBoard.views.tasksTip"))}
            {opt("map", t("raidBoard.views.map"), <ImageIcon size={15} aria-hidden="true" />, mapless ? t("raidBoard.views.noMap") : t("raidBoard.views.mapTip"), mapless)}
            {opt("anim", t("raidBoard.views.anim"), <Clapperboard size={15} aria-hidden="true" />, mapless ? t("raidBoard.views.noMap") : t("raidBoard.views.animTip"), mapless)}
        </div>
    );
}

/**
 * The working area's sticky head (Oct 2026): the unsaved strip, then ONE strip with the section choice (the parent's
 * `bossNav`: "◀ Teron Gorefiend · Boss 4 von 9 ▾ ▶" and its open assignments) at the left and, at the right, the view switch
 * "Aufgaben | Karte", the parent's status (draft / published, saved) and its actions (link, share, more). The same place in
 * both views. Under it, only in the view "Karte", the tool row (`tools`, MapToolRow).
 */
export function WorkspaceToolbar({ saveState, notice, view, onView, mapless, status, actions, bossNav, tools }: {
    saveState?: "clean" | "dirty" | "conflict";
    notice?: ReactNode;
    view: PlanView;
    onView: (view: PlanView) => void;
    /** Standard and Allgemein have no map: "Karte" is offered, disabled, with the reason as its tooltip */
    mapless: boolean;
    status?: ReactNode;
    actions?: ReactNode;
    bossNav: ReactNode;
    /** the tool row of the view "Karte" */
    tools?: ReactNode;
}) {
    const t = useT();
    return (
        <div className={`rp-sticky${saveState && saveState !== "clean" ? ` is-${saveState}` : ""}`}>
            {notice}
            <div className="rp-toolbar2 rp-strip" role="toolbar" aria-label={t("raidBoard.strip.label")}>
                {bossNav}
                <div className="rp-strip-right">
                    <ViewSwitch view={mapless ? "tasks" : view} onView={onView} mapless={mapless} />
                    <span className="rp-tool-sep" aria-hidden="true" />
                    <div className="rp-tool-status">{status}</div>
                    <div className="rp-tool-group rp-tool-actions">{actions}</div>
                </div>
            </div>
            {tools}
        </div>
    );
}
