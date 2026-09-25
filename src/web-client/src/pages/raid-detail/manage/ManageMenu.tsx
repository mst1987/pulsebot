// "Event verwalten" (#288): ONE button in the raid detail's head of an own
// event. It opens a short menu — the entries and their order come from
// lib/eventManage.ts' manageMenu() — and every entry opens a dialog or asks
// once. Each entry carries a small line saying what it does, so the logic is
// visible before the click.
//
// The menu is portalled into <body> and placed under the button: the head is a
// clipped panel, and a popover inside it would be cut off after three entries.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { manageMenu, type ManageAction, type ManageMenuEntry, type ManageState } from "../../../lib/eventManage";
import { Button } from "../../../components/ui/Button";
import WowIcon from "../../../components/ui/WowIcon";
import { ChevronDownIcon } from "../../../components/icons";
import { useT } from "../../../i18n";

type Place = { top: number; right: number };

/** `entries` replaces the own event's menu (a Raid-Helper event has only its raid plan switch); `tipSub` the button's second line. */
export default function ManageMenu({ state, entries: given, tipSub, onAction }: { state?: ManageState; entries?: ManageMenuEntry[]; tipSub?: string; onAction: (action: ManageAction) => void }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const [place, setPlace] = useState<Place | null>(null);
    const anchor = useRef<HTMLDivElement>(null);
    const pop = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (!open || !anchor.current) return undefined;
        const measure = () => {
            const r = anchor.current!.getBoundingClientRect();
            setPlace({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
        };
        measure();
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return () => {
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const close = (e: MouseEvent | KeyboardEvent) => {
            if (e instanceof KeyboardEvent) {
                if (e.key === "Escape") setOpen(false);
                return;
            }
            const target = e.target as Node;
            if (!anchor.current?.contains(target) && !pop.current?.contains(target)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", close);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", close);
        };
    }, [open]);

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
            {open && place && createPortal(
                <div className="em-pop" role="menu" ref={pop} style={{ top: place.top, right: place.right }}>
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
                </div>,
                document.body,
            )}
        </div>
    );
}
