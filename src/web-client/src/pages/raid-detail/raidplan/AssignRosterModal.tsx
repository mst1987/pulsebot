import { useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Wand2 } from "lucide-react";
import type { RaidplanBoard, RaidplanPlayer, RaidplanSlot } from "../../../api";
import { Button, Modal } from "../../../components/ui";
import WowIcon from "../../../components/ui/WowIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { CLASS_IDS, ROLE_ICON, classIconOf } from "../../../lib/raidplan/assign";
import { ROLE_SLOT_KINDS, assignOrSwap, classStatus, clearAllSlots, clearSlot, fillOpenSlots, roleSlots, slotCandidates, toggleSlotClass } from "../../../lib/raidplan/rosterAssign";
import { useT } from "../../../i18n";

/**
 * "Besetzung zuweisen": every roster slot of the raid (Tank | Heiler | Melee | Ranged | DPS) with the player in it, and next to it
 * the players to give it to — all on one page, nothing scrolls. Click a slot, click a player (a player who stands elsewhere
 * SWAPS with the slot's occupant), or drag a player onto a slot; each assignment is one undo step and shows everywhere at once. A
 * slot can ask for a class (the icons): the template then fills it from the raid's players of that class. In a template there
 * are no players, only the classes.
 */
export default function AssignRosterModal({ board, roster, isEvent, canWrite, edit, onClose }: {
    board: RaidplanBoard;
    roster: RaidplanPlayer[];
    isEvent: boolean;
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard) => void;
    onClose: () => void;
}) {
    const t = useT();
    const slots = useMemo(() => roleSlots(board), [board]);
    const [sel, setSel] = useState(() => (slots[0] ? slots[0].id : ""));
    const [query, setQuery] = useState("");
    const [cls, setCls] = useState("");
    const [note, setNote] = useState("");
    const [drag, setDrag] = useState<{ userId: string; x: number; y: number; moved: boolean } | null>(null);
    const dragRef = useRef(drag);
    dragRef.current = drag;
    const slot = slots.find((s) => s.id === sel) || null;
    const players = useMemo(() => new Map(roster.map((p) => [p.userId, p])), [roster]);
    const label = (s: RaidplanSlot) => t(`raidBoard.slot.${s.kind}`, { n: s.n });
    const cands = useMemo(() => (slot ? slotCandidates(board, slot, roster) : []), [board, slot, roster]);
    const shown = cands.filter((c) => (!cls || c.player.classId === cls) && (!query.trim() || `${c.player.character} ${c.player.rhName || ""}`.toLowerCase().indexOf(query.trim().toLowerCase()) >= 0));

    /** Gives the selected slot (or the one a drag ended on) to a player, swapping when he stands elsewhere; then moves on to the next slot. */
    const give = (slotId: string, userId: string) => {
        const target = slots.find((s) => s.id === slotId);
        if (!target || !canWrite) return;
        const from = slots.find((s) => s.userId === userId && s.id !== slotId);
        setNote(from && target.userId && players.get(target.userId) && players.get(userId) ? t("raidBoard.roster.swapped", { a: (players.get(userId) as RaidplanPlayer).character, b: (players.get(target.userId) as RaidplanPlayer).character }) : "");
        edit((b) => assignOrSwap(b, slotId, userId));
        const i = slots.findIndex((s) => s.id === slotId);
        if (slots[i + 1] && slotId === sel) setSel(slots[i + 1].id);
    };

    // drag a player onto a slot (Pointer Events, so a finger works too)
    useEffect(() => {
        if (!drag) return undefined;
        const move = (e: PointerEvent) => setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, moved: d.moved || Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4 } : d));
        const up = (e: PointerEvent) => {
            const d = dragRef.current;
            setDrag(null);
            if (!d || !d.moved) return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const row = el ? el.closest("[data-slotrow]") : null;
            if (row) give(row.getAttribute("data-slotrow") || "", d.userId);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drag !== null]);

    const rowKeys = (e: React.KeyboardEvent, i: number) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const next = slots[i + (e.key === "ArrowDown" ? 1 : -1)];
            if (next) { setSel(next.id); const el = document.querySelector<HTMLElement>(`[data-slotrow="${next.id}"]`); if (el) el.focus(); }
        } else if (e.key === "Enter" && isEvent) {
            e.preventDefault();
            const chip = document.querySelector<HTMLElement>(".rp-ar-players .rp-fchip");
            if (chip) chip.focus();
        } else if ((e.key === "Delete" || e.key === "Backspace") && canWrite) {
            e.preventDefault();
            edit((b) => clearSlot(b, slots[i].id));
        }
    };

    const kinds = ROLE_SLOT_KINDS.filter((k) => slots.some((s) => s.kind === k));
    const fitting = shown.filter((c) => c.fits);
    const others = shown.filter((c) => !c.fits);
    const chip = (c: { player: RaidplanPlayer; at: RaidplanSlot | null }) => (
        <button
            key={c.player.userId} type="button" className={`rp-fchip${slot && slot.userId === c.player.userId ? " is-on" : ""}${c.at && (!slot || c.at.id !== slot.id) ? " is-used" : ""}`}
            aria-pressed={!!slot && slot.userId === c.player.userId} disabled={!canWrite || !slot}
            onClick={() => slot && give(slot.id, c.player.userId)}
            onPointerDown={(e) => { if (canWrite && e.button === 0) setDrag({ userId: c.player.userId, x: e.clientX, y: e.clientY, moved: false }); }}
        >
            <span className="rp-pchip"><TokenIcon player={c.player} size="sm" /><PlayerName player={c.player} /></span>
            {c.at && (!slot || c.at.id !== slot.id) && <span className="rp-ar-at">{label(c.at)}</span>}
        </button>
    );

    return (
        <Modal
            open onClose={onClose} title={t("raidBoard.roster.title")} width={1500} initialFocus=".rp-ar-row.is-sel"
            footer={<Button onClick={onClose}>{t("raidBoard.am.done")}</Button>}
            hint={<span>{t("raidBoard.roster.hint")}</span>}
        >
            <div className="rp-ar">
                <section className="rp-ar-slots" aria-label={t("raidBoard.bes.title")}>
                    {isEvent && canWrite && (
                        <div className="rp-ar-actions">
                            <Button variant="ghost" onClick={() => edit((b) => fillOpenSlots(b, roster))}><Wand2 size={15} /> {t("raidBoard.roster.fill")}</Button>
                            <Button variant="ghost" onClick={() => edit((b) => clearAllSlots(b))}><Eraser size={15} /> {t("raidBoard.roster.clearAll")}</Button>
                        </div>
                    )}
                    <div className="rp-ar-cols">
                        {kinds.map((k) => (
                            <div key={k} className="rp-ar-col">
                                <h3 className="rp-kicker"><WowIcon name={ROLE_ICON[k]} size={16} /> {t(`raidBoard.slot.kind.${k}`)} · {slots.filter((s) => s.kind === k).length}</h3>
                                {slots.filter((s) => s.kind === k).map((s) => {
                                    const p = s.userId ? players.get(s.userId) || null : null;
                                    const st = classStatus(s, roster, board);
                                    const i = slots.indexOf(s);
                                    return (
                                        <button
                                            key={s.id} type="button" data-slotrow={s.id} className={`rp-ar-row${s.id === sel ? " is-sel" : ""}${drag && drag.moved ? " is-target" : ""}`}
                                            aria-pressed={s.id === sel} onClick={() => setSel(s.id)} onKeyDown={(e) => rowKeys(e, i)}
                                        >
                                            <span className="rp-ar-n">{s.n}</span>
                                            {p ? <span className="rp-pchip"><TokenIcon player={p} size="sm" /><PlayerName player={p} /></span> : <span className="rp-muted">{t("raidBoard.slot.open")}</span>}
                                            {(s.preferredClasses || []).length > 0 && (
                                                <span className={`rp-ar-cls is-${st}`} data-tip={st === "missing" ? t("raidBoard.roster.classMissing", { cls: (s.preferredClasses || []).map((c) => t(`wow.class.${c}`)).join(", ") }) : (s.preferredClasses || []).map((c) => t(`wow.class.${c}`)).join(", ")}>
                                                    {(s.preferredClasses || []).map((c) => <WowIcon key={c} name={classIconOf(c)} size={16} />)}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                        {kinds.length === 0 && <p className="rp-muted">{t("raidBoard.roster.noSlots")}</p>}
                    </div>
                </section>

                <section className="rp-ar-pick" aria-label={t("raidBoard.roster.pick")}>
                    {slot ? (
                        <>
                            <div className="rp-ar-head">
                                <strong>{label(slot)}</strong>
                                {slot.userId && canWrite && <Button variant="ghost" onClick={() => edit((b) => clearSlot(b, slot.id))}><Eraser size={15} /> {t("raidBoard.roster.clear")}</Button>}
                            </div>
                            <div className="rp-ar-wish">
                                <span className="rp-kicker">{t("raidBoard.roster.wish")}</span>
                                <span className="rp-am-chips">
                                    {CLASS_IDS.map((c) => {
                                        const on = (slot.preferredClasses || []).indexOf(c) >= 0;
                                        return (
                                            <button key={c} type="button" className={`rp-fchip rp-classchip${on ? " is-on" : ""}`} aria-pressed={on} disabled={!canWrite} data-tip={t(`wow.class.${c}`)} aria-label={t(`wow.class.${c}`)} onClick={() => edit((b) => toggleSlotClass(b, slot.id, c))}>
                                                <WowIcon name={classIconOf(c)} size={26} />
                                            </button>
                                        );
                                    })}
                                </span>
                                <span className="rp-muted">{t("raidBoard.roster.wishHint")}</span>
                            </div>
                            {isEvent && (
                                <>
                                    <div className="rp-ar-filter">
                                        <input value={query} placeholder={t("raidBoard.am.search")} aria-label={t("raidBoard.am.search")} onChange={(e) => setQuery(e.target.value)} />
                                        <span className="rp-am-chips">
                                            {CLASS_IDS.map((c) => (
                                                <button key={c} type="button" className={`rp-fchip rp-classchip${cls === c ? " is-on" : ""}`} aria-pressed={cls === c} data-tip={t(`wow.class.${c}`)} aria-label={`${t("raidBoard.roster.onlyClass")} ${t(`wow.class.${c}`)}`} onClick={() => setCls(cls === c ? "" : c)}>
                                                    <WowIcon name={classIconOf(c)} size={22} />
                                                </button>
                                            ))}
                                        </span>
                                    </div>
                                    {note && <p className="rp-ar-note" role="status">{note}</p>}
                                    <div className="rp-ar-players">
                                        {fitting.length > 0 && <div><span className="rp-kicker">{t("raidBoard.bes.fitting")}</span><div className="rp-am-chips">{fitting.map(chip)}</div></div>}
                                        {others.length > 0 && <div><span className="rp-kicker">{t("raidBoard.bes.others")}</span><div className="rp-am-chips">{others.map(chip)}</div></div>}
                                        {shown.length === 0 && <span className="rp-muted">{t("raidBoard.am.none")}</span>}
                                    </div>
                                </>
                            )}
                        </>
                    ) : <p className="rp-muted">{t("raidBoard.roster.noSlots")}</p>}
                </section>
            </div>
            {drag && drag.moved && players.get(drag.userId) && (
                <div className="rp-ghost" style={{ "--rp-x": `${drag.x}px`, "--rp-y": `${drag.y}px` } as React.CSSProperties} aria-hidden="true"><TokenIcon player={players.get(drag.userId) as RaidplanPlayer} /></div>
            )}
        </Modal>
    );
}
