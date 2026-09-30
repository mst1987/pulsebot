// Attendance in the Kaderplaner (docs/kaderplaner.md): a player's attendance
// over the raid categories the Kader picked — the value with each category's
// share in the tooltip ("Mo Raid 9/11 · Do Raid 7/10"), the pick itself as a
// checklist (the Kader's settings) and as a small menu in the head of the
// Pool's attendance column. The pick is saved on the Kader, so every lead sees
// the same numbers; without one every value is "—" and the head asks for it.
import { useEffect, useRef, useState } from "react";
import { updateKader, type KaderView } from "../../api";
import Popover from "../../components/ui/Popover";
import { CheckIcon, ChevronDownIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { belowStartPlacement } from "../../lib/popoverPosition";
import { attendanceCategoriesOf, attendanceOf, attPartsText, attText, categoryLabel, togglePick } from "../../lib/kader/model";
import { useKader } from "./kaderContext";

const belowStart = belowStartPlacement();

/** A player's attendance over the Kader's categories: "82 %" or "—", what it is made of in the tooltip. */
export function AttendanceValue({ userId, className: extra = "" }: { userId: string; className?: string }) {
    const t = useT();
    const { view, kader, players, canWrite } = useKader();
    const cats = attendanceCategoriesOf(view, kader);
    const att = attendanceOf(view, kader, players.get(userId));
    let tip: string;
    let sub: string;
    if (!cats.length) {
        tip = t("kader.att.noneTip");
        sub = t(canWrite ? "kader.att.noneSub" : "kader.att.noneSubRead");
    } else if (!att) {
        tip = t("kader.att.notCounted");
        sub = t("kader.att.notCountedSub", { cats: cats.map((c) => categoryLabel(view, c)).join(", ") });
    } else {
        tip = t("kader.att.tip", { attended: att.attended, counted: att.counted });
        sub = attPartsText(att);
    }
    return <span className={`kp-mono${extra ? ` ${extra}` : ""}`} data-tip={tip} data-tip-sub={sub}>{attText(att)}</span>;
}

/**
 * The server's raid categories to tick: the name (with the game version while
 * the categories play different ones) and how many nights each counts. As
 * `menu` its rows are menu items (the column head), else checkboxes (the
 * settings). Reads only its props: the settings dialog renders it too.
 */
export function CategoryChecklist({ view, picked, onToggle, disabled = false, menu = false }: {
    view: KaderView;
    picked: string[];
    onToggle: (id: string) => void;
    disabled?: boolean;
    menu?: boolean;
}) {
    const t = useT();
    if (!view.raidCategories.length) return <p className="kp-hint">{t("kader.att.noCategories")}</p>;
    return (
        <div className="kp-catlist" role={menu ? undefined : "group"} aria-label={menu ? undefined : t("kader.att.menuTitle")}>
            {view.raidCategories.map((c) => {
                const on = picked.includes(c.id);
                return (
                    <button key={c.id} type="button" role={menu ? "menuitemcheckbox" : "checkbox"} aria-checked={on} disabled={disabled}
                        className={`kp-catopt${on ? " kp-on" : ""}`} onClick={() => onToggle(c.id)}>
                        <span className={`kp-check${on ? " kp-on" : ""}`} aria-hidden="true">{on && <CheckIcon />}</span>
                        <span className="kp-grow kp-ellipsis">{categoryLabel(view, c)}</span>
                        <span className="kp-sub">{t("kader.att.nights", { count: c.nights })}</span>
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Below the head of the attendance column: which categories count. A lead
 * opens it as a menu and ticks them (saved at once, for the whole Kader);
 * read-only sees the names.
 */
export function AttendanceSource() {
    const t = useT();
    const { view, kader, canWrite, run } = useKader();
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLButtonElement>(null);
    const box = useRef<HTMLDivElement>(null);
    const names = attendanceCategoriesOf(view, kader).map((c) => categoryLabel(view, c)).join(", ");

    // the first category gets the focus when the menu opens
    useEffect(() => {
        if (open && box.current) box.current.querySelector<HTMLButtonElement>("[role=menuitemcheckbox]")?.focus();
    }, [open]);

    if (!canWrite) {
        return <span className="kp-attsrc kp-static kp-ellipsis" data-tip={names ? t("kader.att.from", { cats: names }) : t("kader.att.noneTip")}>{names || t("kader.att.noneShort")}</span>;
    }
    const close = () => {
        setOpen(false);
        anchor.current?.focus();
    };
    const toggle = (id: string) => void run(updateKader(kader.id, { attendanceCategories: togglePick(view, kader.attendanceCategories, id) }));
    return (
        <>
            <button ref={anchor} type="button" className={`kp-attsrc${names ? "" : " kp-empty"}`} aria-haspopup="menu" aria-expanded={open}
                aria-label={names ? t("kader.att.fromChange", { cats: names }) : t("kader.att.pickLong")}
                data-tip={names ? t("kader.att.from", { cats: names }) : t("kader.att.pickLong")} onClick={() => setOpen(!open)}>
                <span className="kp-ellipsis">{names || t("kader.att.pick")}</span>
                <ChevronDownIcon />
            </button>
            {open && (
                <Popover anchor={anchor} place={belowStart} follow="reposition" onClose={close} boxRef={box}
                    className="kp-wmenu kp-attmenu" role="menu" aria-label={t("kader.att.menuTitle")}>
                    <span className="kicker kp-attmenu-head" aria-hidden="true">{t("kader.att.menuTitle")}</span>
                    <CategoryChecklist view={view} picked={kader.attendanceCategories} onToggle={toggle} menu />
                    <p className="kp-note kp-attmenu-note">{t("kader.att.menuHint")}</p>
                </Popover>
            )}
        </>
    );
}
