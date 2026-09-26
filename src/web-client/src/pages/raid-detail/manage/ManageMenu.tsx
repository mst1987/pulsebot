// "Event verwalten" (#288): ONE button in the raid detail's head of an own
// event. It opens a short menu — the entries and their order come from
// lib/eventManage.ts' manageMenu() — and every entry opens a dialog or asks
// once. Each entry carries a small line saying what it does, so the logic is
// visible before the click.
//
// The menu is portalled into <body> and placed under the button: the head is a
// clipped panel, and a popover inside it would be cut off after three entries.
import { useRef, useState } from "react";
import { manageMenu, type ManageAction, type ManageMenuEntry, type ManageState } from "../../../lib/eventManage";
import { Button } from "../../../components/ui/Button";
import WowIcon from "../../../components/ui/WowIcon";
import { ChevronDownIcon } from "../../../components/icons";
import { useT } from "../../../i18n";
import Popover from "../../../components/ui/Popover";
import { belowEndPlacement } from "../../../lib/popoverPosition";

/** `entries` replaces the own event's menu (a Raid-Helper event has only its raid plan switch); `tipSub` the button's second line. */
export default function ManageMenu({ state, entries: given, tipSub, onAction }: { state?: ManageState; entries?: ManageMenuEntry[]; tipSub?: string; onAction: (action: ManageAction) => void }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLDivElement>(null);

    const entries = given || (state ? manageMenu(state) : []);
    return (
        <div className="em-menu" ref={anchor}>
            <Button
                variant="ghost" icon="inv_misc_note_05" aria-haspopup="menu" aria-expanded={open}
                className={open ? "em-open" : undefined}
                data-tip={open ? undefined : t("raidDetail.manage.tip")}
                data-tip-sub={open ? undefined : tipSub || t("raidDetail.manage.tipSub")}
                onClick={() => setOpen((o) => !o)}
            >
                {t("raidDetail.manage.button")}<span className="em-chev" aria-hidden="true"><ChevronDownIcon /></span>
            </Button>
            {open && (
                <Popover anchor={anchor} place={belowEndPlacement()} follow="reposition" onClose={() => setOpen(false)} className="em-pop" role="menu">
                    {entries.map((entry, i) => entry === "sep"
                        ? <div key={`sep-${i}`} className="em-sep" role="separator" />
                        : (
                            <button
                                key={entry.id} type="button" role="menuitem" className={`em-item${entry.danger ? " danger" : ""}`}
                                onClick={() => { setOpen(false); onAction(entry.id); }}
                            >
                                <WowIcon name={entry.icon} size={24} />
                                <span className="em-item-text">
                                    <span className="em-item-label">{entry.label}</span>
                                    <span className="em-item-sub">{entry.sub}</span>
                                </span>
                            </button>
                        ))}
                </Popover>
            )}
        </div>
    );
}
