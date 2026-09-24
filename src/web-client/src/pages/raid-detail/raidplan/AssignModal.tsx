import { useMemo, useState, type ReactNode } from "react";
import { Wand2 } from "lucide-react";
import type { RaidplanAssignment, RaidplanBoard } from "../../../api";
import { Button, Modal } from "../../../components/ui";
import WowIcon from "../../../components/ui/WowIcon";
import { sectionsOf, filterItems, type FlyItem } from "../../../lib/flyout";
import { CLASS_IDS, classIconOf, patchAssignment, toggleAssignee } from "../../../lib/assign";
import { bindClassesToSlots, effectiveClasses, slotClassesOfRow } from "../../../lib/rosterAssign";
import { useT } from "../../../i18n";

export type PickOption = FlyItem & { node: ReactNode };

/**
 * One row of the assignments, edited in ONE centered dialog with everything on one page (no paging, no first-A-then-B):
 * the task and its spell, who does it, at what, and the preferred class(es). The dialog works on a copy of the board and
 * hands it back with "Fertig" (Enter, unless typing in a field); Esc / "Abbrechen" throw the changes away. Big lists are
 * grids of chips in sections side by side, so nothing scrolls.
 */
export default function AssignModal({ board, rowId, title, assigneeOptions, targetOptions, spellOptions, onTarget, onText, onSpell, onSuggest, onDone, onClose, isEvent }: {
    board: RaidplanBoard;
    rowId: string;
    title: string;
    assigneeOptions: (a: RaidplanAssignment) => PickOption[];
    targetOptions: (a: RaidplanAssignment) => PickOption[];
    spellOptions: (a: RaidplanAssignment) => PickOption[];
    /** A target chip was clicked (key = `kind|ref`): toggles it on the copy. */
    onTarget: (b: RaidplanBoard, id: string, key: string) => RaidplanBoard;
    onText: (b: RaidplanBoard, id: string, text: string) => RaidplanBoard;
    onSpell: (b: RaidplanBoard, id: string, key: string) => RaidplanBoard;
    /** The suggested assignees of a row for its classes (the server does the choosing). */
    onSuggest: (a: RaidplanAssignment) => Promise<string[] | null>;
    /** `slots` only when the classes were bound to slots in the dialog. */
    onDone: (row: RaidplanAssignment, slots?: RaidplanBoard["slots"]) => void;
    onClose: () => void;
    isEvent: boolean;
}) {
    const t = useT();
    const [tmp, setTmp] = useState<RaidplanBoard>(board);
    const [qWho, setQWho] = useState("");
    const [qTarget, setQTarget] = useState("");
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [bound, setBound] = useState(false);
    const row = tmp.assignments.find((a) => a.id === rowId);
    const set = (fn: (b: RaidplanBoard) => RaidplanBoard) => setTmp((b) => fn(b));
    const who = useMemo(() => (row ? filterItems(assigneeOptions(row), qWho, "") as PickOption[] : []), [row, qWho, assigneeOptions]);
    const targets = useMemo(() => (row ? filterItems(targetOptions(row), qTarget, "") as PickOption[] : []), [row, qTarget, targetOptions]);
    if (!row) return null;
    const spells = spellOptions(row);
    const classes = row.preferredClasses || [];
    const grid = (list: PickOption[], onPick: (k: string) => void, single = false) => (
        <div className="rp-am-grid">
            {sectionsOf(list).map((s) => (
                <div key={s.title} className="rp-am-sec">
                    <span className="rp-kicker">{s.title}</span>
                    <div className="rp-am-chips">
                        {(s.items as PickOption[]).map((o) => (
                            <button key={o.key} type="button" className={`rp-fchip${o.on ? " is-on" : ""}`} aria-pressed={o.on} data-single={single ? "1" : undefined} onClick={() => onPick(o.key)}>{o.node}</button>
                        ))}
                    </div>
                </div>
            ))}
            {list.length === 0 && <span className="rp-muted">{t("raidBoard.am.none")}</span>}
        </div>
    );
    // from the copy itself, not from this render's list: two quick clicks must both count
    const toggleClass = (c: string) => set((b) => {
        const cur = (b.assignments.find((x) => x.id === rowId) || { preferredClasses: [] as string[] }).preferredClasses || [];
        return patchAssignment(b, rowId, { preferredClasses: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] });
    });
    const suggest = async () => {
        setBusy(true);
        const refs = await onSuggest({ ...row, preferredClasses: effectiveClasses(tmp, row) });
        setBusy(false);
        if (refs) set((b) => patchAssignment(b, rowId, { assignees: refs }));
    };
    const done = () => onDone(row, bound ? tmp.slots : undefined);
    const slotRefs = row.assignees.filter((r) => r.indexOf("slot:") === 0);
    return (
        <Modal
            open onClose={onClose} title={title} width={1500} initialFocus=".rp-am input"
            footer={<><Button variant="ghost" onClick={onClose}>{t("raidBoard.am.cancel")}</Button><Button onClick={done}>{t("raidBoard.am.done")}</Button></>}
            hint={t("raidBoard.am.hint")}
        >
            <div className="rp-am" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName !== "TEXTAREA") { e.preventDefault(); done(); } }}>
                <section className="rp-am-col" aria-label={t("raidBoard.am.task")}>
                    <h3 className="rp-kicker">{t("raidBoard.am.task")}</h3>
                    <input value={row.title} maxLength={80} placeholder={t(`raidBoard.assign.type.${row.type}`)} aria-label={t("raidBoard.assign.task")} onChange={(e) => set((b) => patchAssignment(b, rowId, { title: e.target.value }))} />
                    {spells.length > 0 && (
                        <>
                            {grid(spells, (k) => set((b) => onSpell(b, rowId, k)), true)}
                        </>
                    )}
                </section>
                <section className="rp-am-col" aria-label={t("raidBoard.assign.assignees")}>
                    <h3 className="rp-kicker">{t("raidBoard.assign.assignees")}</h3>
                    <input value={qWho} placeholder={t("raidBoard.am.search")} aria-label={t("raidBoard.am.search")} onChange={(e) => setQWho(e.target.value)} />
                    {grid(who, (k) => set((b) => toggleAssignee(b, rowId, k)))}
                </section>
                <section className="rp-am-col" aria-label={t("raidBoard.assign.targets")}>
                    <h3 className="rp-kicker">{t("raidBoard.assign.targets")}</h3>
                    <input value={qTarget} placeholder={t("raidBoard.am.search")} aria-label={t("raidBoard.am.search")} onChange={(e) => setQTarget(e.target.value)} />
                    {grid(targets, (k) => set((b) => onTarget(b, rowId, k)))}
                    <input
                        value={text} maxLength={60} placeholder={t("raidBoard.assign.textTarget")} aria-label={t("raidBoard.assign.textTarget")}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { e.preventDefault(); e.stopPropagation(); set((b) => onText(b, rowId, text.trim())); setText(""); } }}
                    />
                </section>
                <section className="rp-am-col rp-am-class" aria-label={t("raidBoard.am.classes")}>
                    <h3 className="rp-kicker">{t("raidBoard.am.classes")}</h3>
                    <div className="rp-am-chips">
                        {CLASS_IDS.map((c) => (
                            <button key={c} type="button" className={`rp-fchip rp-classchip${classes.includes(c) ? " is-on" : ""}`} aria-pressed={classes.includes(c)} data-tip={t(`wow.class.${c}`)} aria-label={t(`wow.class.${c}`)} onClick={() => toggleClass(c)}>
                                <WowIcon name={classIconOf(c)} size={30} />
                            </button>
                        ))}
                    </div>
                    <label className="rp-check">
                        <input type="checkbox" checked={!!row.allowOthers} onChange={(e) => set((b) => patchAssignment(b, rowId, { allowOthers: e.target.checked }))} /> {t("raidBoard.am.allowOthers")}
                    </label>
                    <span className="rp-muted">{t("raidBoard.am.classHint")}</span>
                    {slotRefs.length > 0 && (
                        <Button variant="ghost" data-tip={t("raidBoard.am.bindTip")} onClick={() => { set((b) => bindClassesToSlots(b, row.assignees, row.preferredClasses || [])); setBound(true); }}>{t("raidBoard.am.bind")}</Button>
                    )}
                    {slotClassesOfRow(tmp, row).length > 0 && <span className="rp-muted">{t("raidBoard.am.boundTo", { cls: slotClassesOfRow(tmp, row).map((c) => t(`wow.class.${c}`)).join(", ") })}</span>}
                    {isEvent && (
                        <Button variant="ghost" onClick={suggest} disabled={busy}><Wand2 size={15} /> {t("raidBoard.am.suggest")}</Button>
                    )}
                </section>
            </div>
        </Modal>
    );
}
