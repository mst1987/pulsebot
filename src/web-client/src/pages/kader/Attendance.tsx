// Attendance in the Kaderplaner (docs/kaderplaner.md): a player's attendance
// over the raid categories the Kader picked — the value with each category's
// share in the tooltip ("Mo Raid 9/11 · Do Raid 7/10"), the nights in the
// account dialog, the pick itself as a checklist (the Kader's settings) and as
// a small menu in the head of the Pool's attendance column. The pick is saved
// on the Kader, so every lead sees the same numbers; without one every value is
// "—" and the head asks for it — there is no silent fallback.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { updateKader, type KaderPlayer, type KaderView } from "../../api";
import Popover from "../../components/ui/Popover";
import { AlertIcon, CheckIcon, ChevronDownIcon } from "../../components/ui/icons";
import { useT } from "../../i18n";
import { formatDayMonth } from "../../lib/format";
import { belowStartPlacement } from "../../lib/popoverPosition";
import { attendanceCategoriesOf, attendanceOf, attPartsText, attText, categoryLabel, togglePick } from "../../lib/kader/model";
import { useKader } from "./kaderContext";

const belowStart = belowStartPlacement();

/** What the value of a player says, in words: the tooltip and its second line. */
function useAttendanceWords(userId: string): { text: string; tip: string; sub: string; counted: boolean } {
    const t = useT();
    const { view, kader, players, canWrite } = useKader();
    const cats = attendanceCategoriesOf(view, kader);
    const att = attendanceOf(view, kader, players.get(userId));
    if (!cats.length) return { text: attText(null), tip: t("kader.att.noneTip"), sub: t(canWrite ? "kader.att.noneSub" : "kader.att.noneSubRead"), counted: false };
    if (!att) {
        return { text: attText(null), tip: t("kader.att.notCounted"), sub: t("kader.att.notCountedSub", { cats: cats.map((c) => categoryLabel(view, c)).join(", ") }), counted: false };
    }
    return { text: attText(att), tip: t("kader.att.tip", { attended: att.attended, counted: att.counted }), sub: attPartsText(att), counted: true };
}

/** A player's attendance over the Kader's categories: "76 %" or "—", what it is made of in the tooltip. */
export function AttendanceValue({ userId }: { userId: string }) {
    const words = useAttendanceWords(userId);
    return <span className="kp-mono" data-tip={words.tip} data-tip-sub={words.sub}>{words.text}</span>;
}

/**
 * The same written out where there is room (the Vorläufig drawer): the word
 * and the value, below it what it is made of — "16 von 21 Raidabenden da · Mo
 * Raid 9/11 · Do Raid 7/10".
 */
export function AttendanceLine({ userId, label }: { userId: string; label: string }) {
    const words = useAttendanceWords(userId);
    return (
        <div className="kp-attline">
            <span className="kp-muted">{label}</span>
            <b className="kp-mono">{words.text}</b>
            <span className="kp-sub kp-wrap">{words.counted ? `${words.tip} · ${words.sub}` : words.tip}</span>
        </div>
    );
}

/**
 * The account dialog's attendance: the percent large, which categories it is
 * made of, one square per counted night (date and category in the tooltip) and
 * the nights in words. A hint instead while the Kader picked no category or
 * none of them counted a night.
 */
export function AttendanceNights({ player }: { player: KaderPlayer }) {
    const t = useT();
    const { view, kader } = useKader();
    const words = useAttendanceWords(player.userId);
    const att = attendanceOf(view, kader, player);
    if (!att) {
        return (
            <div className="kp-attblock">
                <div className="kp-between"><span className="kp-muted">{t("kader.account.attendance")}</span><span className="kp-big kp-mono">{words.text}</span></div>
                <p className="kp-hint">{words.tip}. {words.sub}</p>
            </div>
        );
    }
    return (
        <div className="kp-attblock">
            <div className="kp-between"><span className="kp-muted">{t("kader.account.attendance")}</span><span className="kp-big kp-mono">{attText(att)}</span></div>
            <span className="kp-sub kp-wrap">{t("kader.att.from", { cats: attPartsText(att) })}</span>
            <div className="kp-nights">
                {att.nights.map((n, i) => (
                    <i key={`${n.date}-${n.category}-${i}`} className={n.attended ? "on" : "off"}
                        data-tip={`${t("kader.att.nightTip", { date: n.date ? formatDayMonth(Date.parse(`${n.date}T12:00:00Z`)) : "", category: n.category })} · ${n.title}`}
                        data-tip-sub={n.attended ? t("kader.account.there") : (n.reason || t("kader.account.missed"))} />
                ))}
            </div>
            <span className="kp-sub kp-wrap">{t("kader.account.nights", { n: att.counted, there: att.attended, missed: att.counted - att.attended })}</span>
        </div>
    );
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
 * read-only sees the names. Without a pick it says so in the warning colour.
 */
export function AttendanceSource() {
    const t = useT();
    const { view, kader, canWrite, run } = useKader();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const anchor = useRef<HTMLButtonElement>(null);
    const box = useRef<HTMLDivElement>(null);
    const names = attendanceCategoriesOf(view, kader).map((c) => categoryLabel(view, c)).join(", ");

    // the first category gets the focus when the menu opens
    useEffect(() => {
        if (open && box.current) box.current.querySelector<HTMLButtonElement>("[role=menuitemcheckbox]")?.focus();
    }, [open]);

    if (!canWrite) {
        return (
            <span className={`kp-attsrc kp-static${names ? "" : " kp-attsrc-none"}`} data-tip={names ? t("kader.att.from", { cats: names }) : t("kader.att.noneTip")}>
                <span className="kp-ellipsis">{names || t("kader.att.noneShort")}</span>
            </span>
        );
    }
    const close = () => {
        setOpen(false);
        anchor.current?.focus();
    };
    // one change at a time: the next pick builds on the answer of the last (the focus stays on the row)
    const toggle = async (id: string) => {
        if (busy) return;
        setBusy(true);
        await run(updateKader(kader.id, { attendanceCategories: togglePick(view, kader.attendanceCategories, id) }));
        setBusy(false);
    };
    const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
        const items = Array.from(box.current ? box.current.querySelectorAll<HTMLButtonElement>("[role=menuitemcheckbox]") : []);
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
        if (to === null) {
            if (e.key === "Escape" || e.key === "Tab") close();
            return;
        }
        e.preventDefault();
        items[(to + items.length) % items.length]?.focus();
    };
    return (
        <>
            <button ref={anchor} type="button" className={`kp-attsrc${names ? "" : " kp-attsrc-none"}`} aria-haspopup="menu" aria-expanded={open}
                aria-label={names ? t("kader.att.fromChange", { cats: names }) : t("kader.att.pickLong")}
                data-tip={names ? t("kader.att.from", { cats: names }) : t("kader.att.pickLong")} onClick={() => setOpen(!open)}
                onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}>
                {!names && <AlertIcon />}
                <span className="kp-ellipsis">{names || t("kader.att.pick")}</span>
                <ChevronDownIcon />
            </button>
            {open && (
                <Popover anchor={anchor} place={belowStart} follow="reposition" onClose={() => setOpen(false)} boxRef={box}
                    className="kp-wmenu kp-attmenu" role="menu" aria-label={t("kader.att.menuTitle")} onKeyDown={onMenuKey}>
                    <span className="kicker kp-attmenu-head" aria-hidden="true">{t("kader.att.menuTitle")}</span>
                    <CategoryChecklist view={view} picked={kader.attendanceCategories} onToggle={(id) => void toggle(id)} menu />
                    <p className="kp-note kp-attmenu-note">{t("kader.att.menuHint")}</p>
                </Popover>
            )}
        </>
    );
}
