import { useMemo, useState, type ReactNode } from "react";
import { Wand2 } from "lucide-react";
import type { Catalog, RaidplanAssignment, RaidplanBoard, RaidplanPlayer } from "../../../api";
import ClassPicker, { ClassCountChip } from "./ClassPicker";
import { Button, Modal } from "../../../components/ui";
import WowIcon from "../../../components/ui/WowIcon";
import { sectionsOf, filterItems, type FlyItem } from "../../../lib/flyout";
import { CLASS_IDS, classIconOf, classRefIcon, classRefLabel, classPlaceName, classesForType, patchAssignment, toggleAssignee } from "../../../lib/assign";
import { ANY, TANK_CLASSES, TANK_TYPES, candidatesOf, classGroups, expandClassRefs, impliedRole, isClassRef, parseClassRef, pickKey, refsOfClass, setClassCount } from "../../../lib/classRefs";
import { bindClassesToSlots, effectiveClasses, slotClassesOfRow } from "../../../lib/rosterAssign";
import { useT } from "../../../i18n";

export type PickOption = FlyItem & { node: ReactNode };

/**
 * One row of the assignments, edited in ONE centered dialog with everything on one page (no paging, no first-A-then-B):
 * the task and its spell, who does it, at what, and the preferred class(es). The dialog works on a copy of the board and
 * hands it back with "Fertig" (Enter, unless typing in a field); Esc / "Abbrechen" throw the changes away. Big lists are
 * grids of chips in sections side by side, so nothing scrolls.
 */
export default function AssignModal({ board, rowId, title, assigneeOptions, targetOptions, spellOptions, onTarget, onText, onSpell, onSuggest, onDone, onClose, isEvent, roster, catalog }: {
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
    /** The raid's players (empty in a template) and the catalog: who fills a class, which classes fit the task. */
    roster: RaidplanPlayer[];
    catalog: Catalog | null;
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
    const suggested = row ? classesForType(row.type, catalog) : [];
    // resolved with the whole board: the other rows of this task take their raiders first (round robin), so "now" is what the plan will show
    const filledRow = row ? expandClassRefs(tmp.assignments, tmp.slots, roster, tmp.roles).find((x) => x.id === rowId) || null : null;
    const asClasses = row.assignees.filter((r) => isClassRef(r));
    // a tanking row offers the general tanks ("any tank", "Tank (Warrior)" ...): chosen and counted in their own block, not twice among the classes
    const isTankRow = TANK_TYPES.indexOf(row.type) >= 0;
    const isGeneralTank = (ref: string) => { const q = parseClassRef(ref); return !!q && q.role === "tank" && TANK_CLASSES.indexOf(q.classId) >= 0; };
    const tankGroups = isTankRow ? classGroups(asClasses.filter(isGeneralTank)) : [];
    const atClasses = row.targets.filter((x) => x.kind === "class").map((x) => x.ref);
    /** The class references of this row with who fills them now, and who could (players of the class), for the hand-made choice. */
    const fillers = [
        ...row.assignees.map((r, i) => ({ key: pickKey("assignee", r), ref: r, now: filledRow ? filledRow.assignees[i] : r })).filter((x) => isClassRef(x.ref)),
        ...row.targets.map((x, i) => ({ x, i })).filter((o) => o.x.kind === "class").map((o) => ({ key: pickKey("class", o.x.ref), ref: o.x.ref, now: filledRow && filledRow.targets[o.i].kind === "player" ? `user:${filledRow.targets[o.i].ref}` : o.x.ref })),
    ];
    const setPick = (key: string, userId: string) => set((b) => { const cur = (b.assignments.find((x) => x.id === rowId) || { picks: {} }).picks || {}; const next = { ...cur }; if (userId) next[key] = userId; else delete next[key]; return patchAssignment(b, rowId, { picks: next }); });
    /** How many of a class (and role) the row asks for, read from the copy itself (two quick clicks both count). */
    const countIn = (b: RaidplanBoard, classId: string, role: string, target: boolean) => {
        const cur = b.assignments.find((x) => x.id === rowId);
        if (!cur) return 0;
        return refsOfClass(target ? cur.targets.filter((x) => x.kind === "class").map((x) => x.ref) : cur.assignees.filter((r) => isClassRef(r)), classId, role).length;
    };
    /** "x n" of a class: more takes the next running numbers of this task (over all its rows), fewer the highest of this row. */
    const setCount = (classId: string, role: string, count: number, target: boolean) => set((b) => ({ ...b, assignments: setClassCount(b.assignments, rowId, classId, role, count, target) }));
    const addOne = (classId: string, role: string, target: boolean) => set((b) => ({ ...b, assignments: setClassCount(b.assignments, rowId, classId, role, countIn(b, classId, role, target) + 1, target) }));
    const suggestClasses = () => set((b) => {
        let next = b;
        const role = impliedRole(row.type);
        for (const c of suggested) if (countIn(next, c, role, false) === 0) next = { ...next, assignments: setClassCount(next.assignments, rowId, c, role, 1, false) };
        return next;
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
                    <ClassPicker
                        label={t("raidBoard.class.title")} refs={isTankRow ? asClasses.filter((r) => !isGeneralTank(r)) : asClasses} suggested={suggested} defaultRole={impliedRole(row.type)}
                        onAdd={(c, role) => addOne(c, role, false)} onCount={(c, role, n) => setCount(c, role, n, false)}
                    />
                    {suggested.length > 0 && <Button variant="ghost" onClick={suggestClasses}><Wand2 size={15} /> {t("raidBoard.class.addSuggested")}</Button>}
                </section>
                <section className="rp-am-col" aria-label={t("raidBoard.assign.targets")}>
                    <h3 className="rp-kicker">{t("raidBoard.assign.targets")}</h3>
                    <input value={qTarget} placeholder={t("raidBoard.am.search")} aria-label={t("raidBoard.am.search")} onChange={(e) => setQTarget(e.target.value)} />
                    {grid(targets, (k) => set((b) => onTarget(b, rowId, k)))}
                    <ClassPicker
                        label={t("raidBoard.class.targetTitle")} refs={atClasses} suggested={[]}
                        onAdd={(c, role) => addOne(c, role, true)} onCount={(c, role, n) => setCount(c, role, n, true)}
                    />
                    <input
                        value={text} maxLength={60} placeholder={t("raidBoard.assign.textTarget")} aria-label={t("raidBoard.assign.textTarget")}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { e.preventDefault(); e.stopPropagation(); set((b) => onText(b, rowId, text.trim())); setText(""); } }}
                    />
                </section>
                <section className="rp-am-col rp-am-class" aria-label={t("raidBoard.am.classes")}>
                    {isTankRow && (
                        <div className="rp-cpick rp-gtanks" role="group" aria-label={t("raidBoard.class.generalTank")}>
                            <h3 className="rp-kicker" data-tip={t("raidBoard.class.generalTankTip")}>{t("raidBoard.class.generalTank")}</h3>
                            <span className="rp-am-chips">
                                {TANK_CLASSES.map((c) => (
                                    <button key={c} type="button" className="rp-fchip rp-gtank" data-tip={t("raidBoard.class.generalTankTip")} onClick={() => addOne(c, "tank", false)}>
                                        <WowIcon name={classRefIcon(c, "tank")} size={20} /><span>{c === ANY ? t("raidBoard.class.anyTank") : classPlaceName(c, "tank")}</span>
                                    </button>
                                ))}
                            </span>
                            {tankGroups.length > 0 && (
                                <span className="rp-am-chips">
                                    {tankGroups.map((g) => <ClassCountChip key={g.classId} classId={g.classId} role="tank" ns={g.ns} onCount={(n) => setCount(g.classId, "tank", n, false)} />)}
                                </span>
                            )}
                        </div>
                    )}
                    <h3 className="rp-kicker">{t("raidBoard.am.classes")}</h3>
                    <div className="rp-am-chips">
                        {CLASS_IDS.map((c) => (
                            <button key={c} type="button" className={`rp-fchip rp-classchip${classes.includes(c) ? " is-on" : ""}`} aria-pressed={classes.includes(c)} data-tip={t(`wow.class.${c}`)} aria-label={t(`wow.class.${c}`)} onClick={() => toggleClass(c)}>
                                <WowIcon name={classIconOf(c)} size={30} />
                            </button>
                        ))}
                    </div>
                    <span className="rp-muted">{t("raidBoard.am.classHint")}</span>
                    {(asClasses.length > 0 || atClasses.length > 0) && (
                        <label className="rp-check"><input type="checkbox" checked={!!row.allowMulti} onChange={(e) => set((b) => patchAssignment(b, rowId, { allowMulti: e.target.checked }))} /> {t("raidBoard.class.allowMulti")}</label>
                    )}
                    {roster.length > 0 && fillers.length > 0 && (
                        <div className="rp-cpick-fill">
                            <span className="rp-kicker">{t("raidBoard.class.fills")}</span>
                            {fillers.map((f) => {
                                const q = parseClassRef(f.ref) || { classId: "", role: "" };
                                const mine = candidatesOf(f.ref, row.type, roster, tmp.roles);
                                const manual = (row.picks || {})[f.key] || "";
                                const now = f.now.startsWith("user:") ? f.now.slice(5) : "";
                                return (
                                    <div key={f.key} className="rp-cpick-one">
                                        <span className="rp-cpick-name"><WowIcon name={classRefIcon(q.classId, q.role)} size={16} /> {classRefLabel(f.ref)}</span>
                                        <span className="rp-am-chips">
                                            <button type="button" className={`rp-fchip${manual === "" ? " is-on" : ""}`} aria-pressed={manual === ""} onClick={() => setPick(f.key, "")}>{t("raidBoard.class.auto")}</button>
                                            {mine.map((p) => <button key={p.userId} type="button" className={`rp-fchip${manual === p.userId ? " is-on" : ""}${manual === "" && now === p.userId ? " is-auto" : ""}`} aria-pressed={manual === p.userId} onClick={() => setPick(f.key, p.userId)}>{p.character}</button>)}
                                            {mine.length === 0 && <span className="rp-muted">{t("raidBoard.class.none", { cls: classPlaceName(q.classId, q.role) })}</span>}
                                            {mine.length > 0 && manual === "" && now === "" && <span className="rp-muted">{t("raidBoard.class.missing")}</span>}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
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
