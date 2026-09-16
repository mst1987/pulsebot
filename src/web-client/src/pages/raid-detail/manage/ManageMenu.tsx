// "Event verwalten" (#288): ONE button in the raid detail's head of an own
// event. It opens a short menu — the entries and their order come from
// lib/eventManage.ts' manageMenu() — and every entry opens a dialog or asks
// once. Each entry carries a small line saying what it does, so the logic is
// visible before the click.
import { useEffect, useRef, useState } from "react";
import { manageMenu, type ManageAction, type ManageState } from "../../../lib/eventManage";
import { Button } from "../../../components/ui/Button";
import WowIcon from "../../../components/ui/WowIcon";
import { ChevronDownIcon } from "../../../components/icons";

export default function ManageMenu({ state, onAction }: { state: ManageState; onAction: (action: ManageAction) => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return undefined;
        const close = (e: MouseEvent | KeyboardEvent) => {
            if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", close);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", close);
        };
    }, [open]);

    const entries = manageMenu(state);
    return (
        <div className="em-menu" ref={ref}>
            <Button
                variant="ghost" icon="inv_misc_note_05" aria-haspopup="menu" aria-expanded={open}
                className={open ? "em-open" : undefined}
                data-tip="Event verwalten" data-tip-sub="Bearbeiten, verschieben, Anmeldung schließen, Raider eintragen, absagen"
                onClick={() => setOpen((o) => !o)}
            >
                Verwalten<span className="em-chev" aria-hidden="true"><ChevronDownIcon /></span>
            </Button>
            {open && (
                <div className="em-pop" role="menu">
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
                </div>
            )}
        </div>
    );
}
