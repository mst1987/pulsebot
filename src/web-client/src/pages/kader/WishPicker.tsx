// The spec a player stands for, picked from their wishes — in wish order and
// across classes (1 Paladin · Vergeltung, 2 Magier · Feuer, …). The same menu in
// the setup slots and in the drawer's decision, so both look alike. The trigger
// shows the chosen spec's icon (with the class in its colour when there is
// room) and a chevron; the menu: rank, spec icon, class in class colour, the
// full "Klasse · Spec" as tooltip and label, a check on the current one. A
// decision that is none of the wishes (a roster player) comes first, labelled
// "Entscheidung". Keyboard: Enter, Space or ArrowDown opens, the arrows move,
// Enter picks, Escape closes and the focus returns to the trigger.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { KaderEntry, KaderWish } from "../../api";
import Popover from "../../components/ui/Popover";
import { CheckIcon, ChevronDownIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { belowStartPlacement } from "../../lib/popoverPosition";
import { wishLabel, wishOptions, type WishOption } from "../../lib/kader/model";
import { PickIcon, PickLabel, StateIcon } from "./parts";
import { useKader } from "./kaderContext";

/** The menu under its trigger, left edges aligned (the trigger sits at a slot's left), above it when there is no room below. */
const belowStart = belowStartPlacement();

export default function WishPicker({ entry, value, onChange, label, disabled = false, compact = false, wide = false }: {
    entry: KaderEntry;
    /** The chosen spec key. */
    value: string;
    onChange: (pick: KaderWish) => void;
    /** What is picked, for the accessible name ("Spec von Brakk"). */
    label: string;
    disabled?: boolean;
    /** Only the icon on the trigger (a setup slot). */
    compact?: boolean;
    /** The trigger fills its row (the drawer). */
    wide?: boolean;
}) {
    const t = useT();
    const { view } = useKader();
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLButtonElement>(null);
    const box = useRef<HTMLDivElement>(null);
    const options = wishOptions(entry, value);
    const current = options.find((o) => o.pick.spec === value) || null;
    const rankText = (o: WishOption) => (o.rank > 0 ? t("kader.picker.rank", { n: o.rank }) : o.rank === 0 ? t("kader.picker.decision") : t("kader.picker.before"));
    const fullLabel = (o: WishOption) => `${rankText(o)}: ${wishLabel(view.classes, o.pick)}`;

    // the checked entry (or the first) gets the focus when the menu opens
    useEffect(() => {
        if (!open || !box.current) return;
        const items = Array.from(box.current.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"));
        (items.find((b) => b.getAttribute("aria-checked") === "true") || items[0])?.focus();
    }, [open]);

    const close = () => {
        setOpen(false);
        anchor.current?.focus();
    };
    const choose = (o: WishOption) => {
        close();
        if (o.pick.spec !== value) onChange(o.pick);
    };
    const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
        const items = Array.from(box.current ? box.current.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") : []);
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
        if (to === null) {
            if (e.key === "Escape" || e.key === "Tab") close();
            return;
        }
        e.preventDefault();
        items[(to + items.length) % items.length]?.focus();
    };
    const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
        }
    };

    if (options.length < 2) {
        // nothing to choose: the one spec, as it would stand on the trigger
        return (
            <span className={`kp-wpick kp-static${compact ? " kp-compact" : ""}${wide ? " kp-wide" : ""}`}>
                <PickIcon pick={current ? current.pick : null} size={compact ? 20 : 24} />
                {!compact && current && <PickLabel pick={current.pick} className="kp-ellipsis" />}
            </span>
        );
    }
    return (
        <>
            <button ref={anchor} type="button" className={`kp-wpick${compact ? " kp-compact" : ""}${wide ? " kp-wide" : ""}`} disabled={disabled}
                aria-haspopup="menu" aria-expanded={open} aria-label={current ? `${label}: ${fullLabel(current)}` : label}
                data-tip={current ? fullLabel(current) : undefined} onClick={() => setOpen(!open)} onKeyDown={onTriggerKey}>
                <PickIcon pick={current ? current.pick : null} size={compact ? 20 : 24} />
                {!compact && current && <PickLabel pick={current.pick} className="kp-ellipsis kp-grow" />}
                <ChevronDownIcon />
            </button>
            {open && (
                <Popover anchor={anchor} place={belowStart} follow="reposition" onClose={() => setOpen(false)} boxRef={box}
                    className="kp-wmenu" role="menu" aria-label={label} onKeyDown={onMenuKey}>
                    {options.map((o) => {
                        const on = o.pick.spec === value;
                        return (
                            <button key={`${o.rank}-${o.pick.spec}`} type="button" role="menuitemradio" aria-checked={on} aria-label={fullLabel(o)}
                                data-tip={wishLabel(view.classes, o.pick)} className={`kp-wopt${on ? " kp-on" : ""}`} onClick={() => choose(o)}>
                                <span className="kp-wopt-rank">{o.rank > 0 ? o.rank : <StateIcon state={o.rank === 0 ? "roster" : "pool"} />}</span>
                                <PickIcon pick={o.pick} size={22} />
                                <PickLabel pick={o.pick} className="kp-grow kp-ellipsis" />
                                {o.rank <= 0 && <span className="kp-sub">{rankText(o)}</span>}
                                <span className="kp-wopt-check" aria-hidden="true">{on && <CheckIcon />}</span>
                            </button>
                        );
                    })}
                </Popover>
            )}
        </>
    );
}
