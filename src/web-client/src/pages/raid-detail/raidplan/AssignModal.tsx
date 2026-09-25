import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronLeft, ChevronRight, LayoutGrid, Minus, Plus, Search, Shield, Skull, Sparkles, Star, Swords, Trash2, Type, User, Wand2, X } from "lucide-react";
import type { Catalog, RaidplanAssignment, RaidplanBoard, RaidplanPlayer } from "../../../api";
import { Button, Modal } from "../../../components/ui";
import WowIcon from "../../../components/ui/WowIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { type FlyItem } from "../../../lib/flyout";
import { ROLE_REFS, ROLE_TONE, CLASS_IDS, ROLE_ICON, classIconOf, classPlaceNameFor, classRefIcon, classRefLabelFor, classesForType, iconForTask, moveAssignee, patchAssignment, quickTexts, resolveAssignee, resolveTarget, toggleAssignee, toggleTarget, type AssignCtx } from "../../../lib/assign";
import { ANY, ANY_SPEC, CLASS_COLOR, TANK_CLASSES, TANK_SPEC_CLASSES, TANK_TYPES, candidatesOf, defaultClassRole, effectiveRole, storedRole, classGroups, expandClassRefs, impliedRole, isClassRef, parseClassRef, pickKey, refsOfClass, setClassCount, setClassRole } from "../../../lib/classRefs";
import { BAR_SLOTS, CLASS_ROLE_CHOICES, PEOPLE_TABS, categoriesFor, chosenCounts, chosenKeys, classCount, filterPeople, nextSlot, peopleEntries, peopleGroups, previewLines, previewText, type PeopleEntry } from "../../../lib/assignModal";
import { bindClassesToSlots, effectiveClasses, slotClassesOfRow } from "../../../lib/rosterAssign";
import { mobCountOf, mobIconsOf, mobInstanceOf, setMobCount, setMobInstance } from "../../../lib/autoPlace";
import { MobIcon } from "./AssignPanel";
import { groupColor } from "../../../lib/groupStyle";
import { AssignChip } from "./AssignPanel";
import { useT } from "../../../i18n";

export type PickOption = FlyItem & { node: ReactNode };
type ClassGroup = { classId: string; role: string; refs: string[]; ns: number[] };

const CAT_ICON: Record<string, ReactNode> = {
    people: <User size={17} aria-hidden="true" />,
    classes: <Sparkles size={17} aria-hidden="true" />,
    roles: <Swords size={17} aria-hidden="true" />,
    groups: <LayoutGrid size={17} aria-hidden="true" />,
    marks: <Star size={17} aria-hidden="true" />,
    mobs: <Skull size={17} aria-hidden="true" />,
    spells: <Wand2 size={17} aria-hidden="true" />,
    text: <Type size={17} aria-hidden="true" />,
};

/**
 * One row of the assignments, edited in ONE centered dialog (design "Variante B" of the Raidplan canvas): the assignment bar on top with
 * three slots (who, at whom, task / spell; the active one is framed and a click in the grid fills it), the categories at the left with
 * their counters, ONE grid of the active category at the right, the sheet preview below and "Zeile entfernen / Abbrechen / Fertig" in the
 * foot. Nothing scrolls: the grids are multi-column and dense. It works on a copy of the board and hands the row back with "Fertig"
 * (Enter); Esc / "Abbrechen" throw the changes away. Pure logic in lib/assignModal.ts.
 */
export default function AssignModal({ board, rowId, title, targetOptions, spellOptions, onTarget, onText, onSpell, onSuggest, onDone, onClose, onRemove, isEvent, roster, catalog, players, initialSlot = "who", initialCat = "" }: {
    /** the slot and category the dialog opens on (the note icon of a row: task / free text) */
    initialSlot?: string;
    initialCat?: string;
    board: RaidplanBoard;
    rowId: string;
    title: string;
    /** kept for the callers; the people list is built here */
    assigneeOptions?: (a: RaidplanAssignment) => PickOption[];
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
    /** "Zeile entfernen" (the dialog closes). */
    onRemove?: () => void;
    isEvent: boolean;
    /** The raid's players (empty in a template) and the catalog: who fills a class, which classes fit the task. */
    roster: RaidplanPlayer[];
    catalog: Catalog | null;
    players?: Map<string, RaidplanPlayer>;
}) {
    const t = useT();
    const [tmp, setTmp] = useState<RaidplanBoard>(board);
    const [slot, setSlot] = useState(initialSlot);
    const [cats, setCats] = useState<Record<string, string>>(initialCat ? { [initialSlot]: initialCat } : {});
    const [tab, setTab] = useState("all");
    const [mode, setMode] = useState("slot");
    const [query, setQuery] = useState("");
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [bound, setBound] = useState(false);
    const byId = useMemo(() => players || new Map(roster.map((p) => [p.userId, p])), [players, roster]);
    const filledAll = useMemo(() => expandClassRefs(tmp.assignments, tmp.slots, roster, tmp.roles), [tmp.assignments, tmp.slots, roster, tmp.roles]);
    const row = tmp.assignments.find((a) => a.id === rowId);
    if (!row) return null;
    const spells = spellOptions(row);
    const targetOpts = targetOptions(row);
    const hasMobs = targetOpts.some((o) => o.key.indexOf("mob|") === 0);
    const type = row.type as string;
    const filled = filledAll.find((x) => x.id === rowId) || row;
    const ctx: AssignCtx = { slots: tmp.slots, players: byId, catalog, groupColors: tmp.groupColors, groupMarks: tmp.groupMarks, filled: filledAll, icons: tmp.icons };
    const set = (fn: (b: RaidplanBoard) => RaidplanBoard) => setTmp((b) => fn(b));
    const catList = categoriesFor(slot, type, hasMobs, spells.length > 0);
    const cat = cats[slot] && catList.indexOf(cats[slot]) >= 0 ? cats[slot] : catList[0];
    const setCat = (c: string) => setCats({ ...cats, [slot]: c });
    const counts = chosenCounts(row, slot);
    const typeName = t(`raidBoard.assign.type.${type}`);
    const target = slot === "at";
    const role = target ? "" : impliedRole(type);
    // a tanking row: the general tanks ("any tank", "Tank (Krieger)" ...) are its classes; a plain class tile would only repeat them
    const tankRow = TANK_TYPES.indexOf(type) >= 0 && !target;
    // a row whose task is tanking by itself: the three tanking classes are the general tanks; the class tiles are the OTHER classes, any spec (a mage tank)
    const impliedTank = tankRow && role === "tank";
    const classTiles = impliedTank ? CLASS_IDS.filter((c) => TANK_SPEC_CLASSES.indexOf(c) < 0) : CLASS_IDS;
    /** The role a class tile adds and counts with: the task's (healing -> healers), on a tanking row any spec for a non-tank class. */
    const tileRole = (c: string) => (target ? "" : defaultClassRole(c, type));
    const countRole = (c: string) => { const e = effectiveRole(tileRole(c), target ? "other" : type); return e === ANY_SPEC ? "" : e; };

    // ---- editing on the copy ----
    const toggleWho = (ref: string) => set((b) => toggleAssignee(b, rowId, ref));
    const ownClassRefs = (a: RaidplanAssignment | undefined, tgt: boolean) => (a ? (tgt ? a.targets.filter((x) => x.kind === "class").map((x) => x.ref) : a.assignees.filter((x) => isClassRef(x))) : []);
    const setCount = (classId: string, r: string, n: number, tgt: boolean) => set((b) => ({ ...b, assignments: setClassCount(b.assignments, rowId, classId, r, n, tgt) }));
    const setRole = (classId: string, from: string, to: string, tgt: boolean) => set((b) => ({ ...b, assignments: setClassRole(b.assignments, rowId, classId, from, to, tgt) }));
    /** A class tile: adds one of the class (the task's role), or takes the class out again when it is chosen (not its general-tank refs). */
    const toggleClassTile = (classId: string) => set((b) => {
        const own = ownClassRefs(b.assignments.find((x) => x.id === rowId), target);
        const groups = classGroups(own).filter((g) => g.classId === classId && !(tankRow && g.role === "tank"));
        let next = b.assignments;
        if (groups.length > 0) for (const g of groups) next = setClassCount(next, rowId, classId, g.role, 0, target);
        else next = setClassCount(next, rowId, classId, tileRole(classId), refsOfClass(own, classId, tileRole(classId)).length + 1, target);
        return { ...b, assignments: next };
    });
    const setPick = (key: string, userId: string) => set((b) => {
        const cur = (b.assignments.find((x) => x.id === rowId) || { picks: {} }).picks || {};
        const next = { ...cur };
        if (userId) next[key] = userId; else delete next[key];
        return patchAssignment(b, rowId, { picks: next });
    });
    const togglePref = (c: string) => set((b) => {
        const cur = (b.assignments.find((x) => x.id === rowId) || { preferredClasses: [] as string[] }).preferredClasses || [];
        return patchAssignment(b, rowId, { preferredClasses: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] });
    });
    const suggestedClasses = classesForType(type, catalog);
    const takeSuggested = () => set((b) => {
        let next = b.assignments;
        for (const c of suggestedClasses) if (refsOfClass(ownClassRefs(next.find((x) => x.id === rowId), false), c, role).length === 0) next = setClassCount(next, rowId, c, role, 1, false);
        return { ...b, assignments: next };
    });
    const suggest = async () => {
        setBusy(true);
        const refs = await onSuggest({ ...row, preferredClasses: effectiveClasses(tmp, row) });
        setBusy(false);
        if (refs) set((b) => patchAssignment(b, rowId, { assignees: refs }));
    };
    const done = () => onDone(row, bound ? tmp.slots : undefined);
    const pickEntry = (key: string) => {
        if (slot === "who") toggleWho(key);
        else if (slot === "at") set((b) => onTarget(b, rowId, key));
        else set((b) => onSpell(b, rowId, key));
    };
    const chosen = chosenKeys(row, slot);
    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
        const tag = (e.target as HTMLElement).tagName;
        if (e.key === "Enter" && !e.shiftKey && tag !== "TEXTAREA" && (tag !== "BUTTON" || e.ctrlKey || e.metaKey)) { e.preventDefault(); done(); }
    };
    const focusId = (id: string) => { const el = document.getElementById(id); if (el) el.focus(); };
    const barKey = (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const s = nextSlot(slot, e.key === "ArrowLeft" ? -1 : 1);
        setSlot(s);
        focusId(`rp-amb-slot-${s}`);
    };
    const navKey = (e: KeyboardEvent<HTMLButtonElement>) => {
        const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
        if (!back && e.key !== "ArrowDown" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const next = catList[(catList.indexOf(cat) + (back ? catList.length - 1 : 1)) % catList.length];
        setCat(next);
        focusId(`rp-amb-cat-${next}`);
    };

    // ---- the bar ----
    const classChip = (g: ClassGroup, tgt: boolean) => (
        <span key={`${g.classId}|${g.role}`} className="rp-amb-chip is-class" style={{ ["--cc" as string]: CLASS_COLOR[g.classId] }}>
            <WowIcon name={classRefIcon(g.classId, g.role)} size={18} />
            <b>{classPlaceNameFor(g.classId, g.role, type)}</b><span className="rp-amb-x">x{g.refs.length}</span>
            <button type="button" className="rp-achip-x" aria-label={`${t("raidBoard.assign.remove")}: ${classPlaceNameFor(g.classId, g.role, type)}`} onClick={(e) => { e.stopPropagation(); setCount(g.classId, g.role, 0, tgt); }}><X size={12} /></button>
        </span>
    );
    const slotContent = (s: string): ReactNode => {
        if (s === "who") {
            const plain = row.assignees.map((ref, i) => ({ ref, i })).filter((x) => !isClassRef(x.ref));
            const groups = classGroups(row.assignees.filter((r) => isClassRef(r)));
            if (plain.length === 0 && groups.length === 0) return <span className="rp-muted">{t("raidBoard.amb.empty")}</span>;
            return (
                <>
                    {plain.map((x) => {
                        const rotation = type === "kick" && row.assignees.length > 1;
                        return (
                            <span key={x.ref} className="rp-amb-rot">
                                {rotation && <button type="button" className="rp-amb-rotbtn" aria-label={t("raidBoard.assign.earlier")} disabled={x.i === 0} onClick={(e) => { e.stopPropagation(); set((b) => moveAssignee(b, rowId, x.ref, -1)); }}><ChevronLeft size={12} /></button>}
                                <AssignChip ctx={ctx} r={resolveAssignee(x.ref, ctx)} extra={rotation ? <span className="rp-achip-no">{x.i + 1}</span> : null} onRemove={() => toggleWho(x.ref)} />
                                {rotation && <button type="button" className="rp-amb-rotbtn" aria-label={t("raidBoard.assign.later")} disabled={x.i === row.assignees.length - 1} onClick={(e) => { e.stopPropagation(); set((b) => moveAssignee(b, rowId, x.ref, 1)); }}><ChevronRight size={12} /></button>}
                            </span>
                        );
                    })}
                    {groups.map((g) => classChip(g, false))}
                </>
            );
        }
        if (s === "at") {
            const plain = row.targets.filter((x) => x.kind !== "class");
            const groups = classGroups(row.targets.filter((x) => x.kind === "class").map((x) => x.ref));
            if (plain.length === 0 && groups.length === 0) return <span className="rp-muted">{t("raidBoard.amb.empty")}</span>;
            return (
                <>
                    {plain.map((tg) => <AssignChip key={`${tg.kind}|${tg.ref}|${tg.n || 0}|${tg.oid || ""}`} ctx={ctx} r={resolveTarget(tg, ctx)} onRemove={() => set((b) => (tg.kind === "mob" && (tg.n || tg.oid) ? patchAssignment(b, rowId, { targets: row.targets.filter((x) => x !== tg) }) : toggleTarget(b, rowId, tg)))} />)}
                    {groups.map((g) => classChip(g, true))}
                </>
            );
        }
        return (
            <>
                <input className="rp-amb-title" value={row.title} maxLength={80} placeholder={typeName} aria-label={t("raidBoard.assign.task")} onClick={(e) => e.stopPropagation()} onFocus={() => setSlot("task")} onChange={(e) => set((b) => patchAssignment(b, rowId, { title: e.target.value }))} />
                {row.spell && (
                    <span className="rp-amb-chip">
                        <WowIcon name={row.spell.icon || iconForTask(row)} size={18} /><span>{row.spell.name}</span>
                        <button type="button" className="rp-achip-x" aria-label={t("raidBoard.assign.remove")} onClick={(e) => { e.stopPropagation(); set((b) => patchAssignment(b, rowId, { spell: null })); }}><X size={12} /></button>
                    </span>
                )}
            </>
        );
    };

    // ---- the grids ----
    const tile = (key: string, on: boolean, body: ReactNode, label: string, extra = "") => (
        <button key={key} type="button" className={`rp-amb-tile${on ? " is-on" : ""}${extra ? ` ${extra}` : ""}`} aria-pressed={on} aria-label={label} onClick={() => pickEntry(key)}>
            {body}{on && <Check size={14} className="rp-amb-check" aria-hidden="true" />}
        </button>
    );
    const personBody = (e: PeopleEntry) => (
        <>
            {e.player ? <TokenIcon player={e.player} size="sm" /> : <WowIcon name={ROLE_ICON[e.kind] || ROLE_ICON.dps} size={20} />}
            {e.n > 0 && <span className="rp-amb-n">{e.n}</span>}
            {e.player ? <PlayerName player={e.player} className="rp-amb-name" /> : <span className="rp-amb-name rp-muted">{t(`raidBoard.slot.kind.${e.kind}`)} · {t("raidBoard.amb.openSlot")}</span>}
        </>
    );
    const peoplePanel = () => {
        const list = filterPeople(peopleEntries(tmp.slots, roster, isEvent ? mode : "slot", slot), tab, query);
        return (
            <>
                <div className="rp-amb-tools">
                    <label className="rp-amb-search"><Search size={15} aria-hidden="true" /><input value={query} placeholder={t("raidBoard.am.search")} aria-label={t("raidBoard.am.search")} onChange={(e) => setQuery(e.target.value)} /></label>
                    <span className="rp-amb-seg" role="radiogroup" aria-label={t("raidBoard.amb.filter")}>
                        {PEOPLE_TABS.map((x) => <button key={x} type="button" role="radio" aria-checked={tab === x} className={tab === x ? "is-on" : ""} onClick={() => setTab(x)}>{t(`raidBoard.amb.tabs.${x}`)}</button>)}
                    </span>
                    {isEvent && (
                        <span className="rp-amb-seg" role="radiogroup" aria-label={t("raidBoard.amb.mode")}>
                            <button type="button" role="radio" aria-checked={mode === "slot"} className={mode === "slot" ? "is-on" : ""} data-tip={t("raidBoard.amb.modeSlotTip")} onClick={() => setMode("slot")}>{t("raidBoard.amb.modeSlot")}</button>
                            <button type="button" role="radio" aria-checked={mode === "player"} className={mode === "player" ? "is-on" : ""} data-tip={t("raidBoard.amb.modePlayerTip")} onClick={() => setMode("player")}>{t("raidBoard.amb.modePlayer")}</button>
                        </span>
                    )}
                </div>
                <div className="rp-amb-groups">
                    {peopleGroups(list).map((g) => (
                        <div key={g.group} className={`rp-amb-pgroup is-${g.group}`}>
                            <span className="rp-kicker">{t(`raidBoard.amb.tabs.${g.group}`)} <span className="rp-muted">{g.entries.length}</span></span>
                            <div className="rp-amb-grid rp-amb-grid-people">
                                {g.entries.map((e) => tile(e.key, chosen.indexOf(e.key) >= 0, personBody(e), e.player ? `${e.player.character}${e.n ? ` (${t(`raidBoard.slot.kind.${e.kind}`)} ${e.n})` : ""}` : `${t(`raidBoard.slot.kind.${e.kind}`)} ${e.n}`))}
                            </div>
                        </div>
                    ))}
                    {list.length === 0 && <span className="rp-muted">{t("raidBoard.am.none")}</span>}
                </div>
            </>
        );
    };
    const optionsPanel = (list: PickOption[], extra = "") => (
        <div className={`rp-amb-grid ${extra}`}>
            {list.map((o) => tile(o.key, o.on, o.node, o.label))}
            {list.length === 0 && <span className="rp-muted">{t("raidBoard.am.none")}</span>}
        </div>
    );
    const resolution = (g: ClassGroup) => (
        <div className="rp-amb-res">
            {g.refs.map((ref) => {
                const key = target ? pickKey("class", ref) : pickKey("assignee", ref);
                const idx = target ? row.targets.findIndex((x) => x.kind === "class" && x.ref === ref) : row.assignees.indexOf(ref);
                const res = target ? filled.targets[idx] : null;
                const now = target ? (res && res.kind === "player" ? res.ref : "") : ((filled.assignees[idx] || "").indexOf("user:") === 0 ? filled.assignees[idx].slice(5) : "");
                const manual = (row.picks || {})[key] || "";
                const pool = candidatesOf(ref, type, roster, tmp.roles);
                const q = parseClassRef(ref) || { classId: "", role: "" };
                return (
                    <div key={ref} className="rp-amb-resline">
                        <span className="rp-amb-resref">{classRefLabelFor(ref, type)}</span>
                        <ArrowRight size={14} aria-hidden="true" className="rp-muted" />
                        {now ? (
                            <span className="rp-amb-picks" role="radiogroup" aria-label={classRefLabelFor(ref, type)}>
                                {pool.map((p) => <button key={p.userId} type="button" role="radio" aria-checked={now === p.userId} className={`rp-amb-pick${now === p.userId ? " is-on" : ""}${manual === p.userId ? " is-hand" : ""}`} onClick={() => setPick(key, manual === p.userId ? "" : p.userId)}><PlayerName player={p} /></button>)}
                            </span>
                        ) : <span className="rp-amb-open"><AlertTriangle size={12} aria-hidden="true" /> {pool.length === 0 ? t("raidBoard.class.noneInRaid", { cls: effectiveRole(q.role, type) === ANY_SPEC ? t(`wow.class.${q.classId}`) : classPlaceNameFor(q.classId, q.role, type) }) : pool.length < g.refs.length ? t("raidBoard.amb.openShort", { n: `${pool.length} ${classPlaceNameFor(q.classId, q.role, type)}` }) : t("raidBoard.amb.openBusy")}</span>}
                    </div>
                );
            })}
        </div>
    );
    const classCard = (g: ClassGroup) => {
        // the role filter: every spec of the class, or a role it can play (the task's own role always listed, so a mage on a healing row shows why nobody fills it)
        const implied = target ? "" : impliedRole(type);
        const roles = g.classId === ANY ? [] : [ANY_SPEC, ...(CLASS_ROLE_CHOICES[g.classId] || []), implied].filter((r, i, all) => !!r && all.indexOf(r) === i);
        const eff = effectiveRole(g.role, target ? "other" : type);
        const name = classPlaceNameFor(g.classId, g.role, type);
        return (
            <div key={`${g.classId}|${g.role}`} className="rp-amb-card" style={{ ["--cc" as string]: CLASS_COLOR[g.classId] }}>
                <div className="rp-amb-card-head">
                    <WowIcon name={classRefIcon(g.classId, g.role)} size={22} />
                    <b className="rp-amb-card-name">{name}</b>
                    <span className="rp-amb-step" role="group" aria-label={`${t("raidBoard.amb.count")}: ${name}`}>
                        <button type="button" aria-label={t("raidBoard.class.fewer")} disabled={g.refs.length <= 1} onClick={() => setCount(g.classId, g.role, g.refs.length - 1, target)}><Minus size={14} /></button>
                        <b aria-live="polite">{g.refs.length}</b>
                        <button type="button" aria-label={t("raidBoard.class.more")} onClick={() => setCount(g.classId, g.role, g.refs.length + 1, target)}><Plus size={14} /></button>
                    </span>
                    <button type="button" className="rp-amb-card-x" aria-label={`${t("raidBoard.amb.removeClass")}: ${name}`} onClick={() => setCount(g.classId, g.role, 0, target)}><X size={14} /></button>
                </div>
                {roles.length > 1 && (
                    <span className="rp-amb-seg sm" role="radiogroup" aria-label={t("raidBoard.amb.role")}>
                        {roles.map((r) => <button key={r} type="button" role="radio" aria-checked={eff === r} className={eff === r ? "is-on" : ""} onClick={() => { if (eff !== r) setRole(g.classId, g.role, storedRole(r, target ? "other" : type), target); }}>{t(`raidBoard.class.roles.${r}`)}</button>)}
                    </span>
                )}
                {roster.length > 0 && resolution(g)}
            </div>
        );
    };
    const classesPanel = () => {
        const own = ownClassRefs(row, target);
        const groups = classGroups(own);
        return (
            <>
                {tankRow && (
                    <div className="rp-amb-block">
                        <span className="rp-kicker" data-tip={t("raidBoard.class.generalTankTip")}>{t("raidBoard.amb.tankBlock")}</span>
                        <div className="rp-amb-grid rp-amb-grid-tank">
                            {TANK_CLASSES.map((c) => {
                                const on = groups.some((g) => g.classId === c && g.role === "tank");
                                return (
                                    <button key={c} type="button" className={`rp-amb-tile rp-amb-class${on ? " is-on" : ""}`} aria-pressed={on} style={{ ["--cc" as string]: CLASS_COLOR[c] }} onClick={() => setCount(c, "tank", on ? 0 : 1, false)}>
                                        {c !== ANY && <Shield size={14} aria-hidden="true" className="rp-amb-shield" />}<WowIcon name={classRefIcon(c, "tank")} size={20} />
                                        <span className="rp-amb-cname">{c === ANY ? t("raidBoard.class.anyTank") : t(`wow.class.${c}`)}</span>
                                        {roster.length > 0 && <span className="rp-amb-cnt" data-tip={t("raidBoard.amb.classCountTip")}>{classCount(roster, c, "tank", tmp.roles)}</span>}
                                        {on && <Check size={14} className="rp-amb-check" aria-hidden="true" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                {impliedTank && <span className="rp-kicker">{t("raidBoard.class.otherTank")}</span>}
                <div className={`rp-amb-grid rp-amb-grid-class${impliedTank ? " is-six" : ""}`}>
                    {classTiles.map((c) => {
                        const on = groups.some((g) => g.classId === c && !(tankRow && g.role === "tank"));
                        const n = classCount(roster, c, countRole(c), tmp.roles);
                        const none = roster.length > 0 && n === 0;
                        const label = impliedTank ? t("raidBoard.class.classTank", { cls: t(`wow.class.${c}`) }) : t(`wow.class.${c}`);
                        return (
                            <button key={c} type="button" className={`rp-amb-tile rp-amb-class${on ? " is-on" : ""}${none ? " is-absent" : ""}${suggestedClasses.indexOf(c) >= 0 ? " is-suggested" : ""}`} aria-pressed={on} aria-label={none ? `${label}: ${t("raidBoard.class.noneInRaid", { cls: t(`wow.class.${c}`) })}` : label} style={{ ["--cc" as string]: CLASS_COLOR[c] }} onClick={() => toggleClassTile(c)} data-tip={none ? t("raidBoard.class.noneInRaid", { cls: t(`wow.class.${c}`) }) : suggestedClasses.indexOf(c) >= 0 ? t("raidBoard.class.suggested") : undefined}>
                                <WowIcon name={classIconOf(c)} size={22} />
                                <span className="rp-amb-cname">{label}</span>
                                {roster.length > 0 && (none ? <span className="rp-amb-cnt is-none"><AlertTriangle size={13} aria-hidden="true" /> 0</span> : <span className="rp-amb-cnt" data-tip={t("raidBoard.amb.classCountTip")}>{n}</span>)}
                                {on && <Check size={14} className="rp-amb-check" aria-hidden="true" />}
                            </button>
                        );
                    })}
                </div>
                {groups.length > 0 && <div className="rp-amb-cards">{groups.map((g) => classCard(g))}</div>}
                {groups.length > 0 && <p className="rp-muted rp-amb-note">{t("raidBoard.amb.noFallback")}</p>}
                {!target && (
                    <div className="rp-amb-classfoot">
                        {own.length > 0 && <label className="rp-check"><input type="checkbox" checked={!!row.allowMulti} onChange={(e) => set((b) => patchAssignment(b, rowId, { allowMulti: e.target.checked }))} /> {t("raidBoard.class.allowMulti")}</label>}
                        <span className="rp-amb-pref" role="group" aria-label={t("raidBoard.amb.forSuggest")}>
                            <span className="rp-muted" data-tip={t("raidBoard.am.classHint")}>{t("raidBoard.amb.forSuggest")}</span>
                            {CLASS_IDS.map((c) => {
                                const on = (row.preferredClasses || []).indexOf(c) >= 0;
                                return <button key={c} type="button" className={`rp-amb-mini${on ? " is-on" : ""}`} aria-pressed={on} aria-label={t(`wow.class.${c}`)} data-tip={t(`wow.class.${c}`)} onClick={() => togglePref(c)}><WowIcon name={classIconOf(c)} size={18} /></button>;
                            })}
                        </span>
                        {suggestedClasses.length > 0 && !impliedTank && <Button variant="ghost" size="sm" icon={<Wand2 size={14} />} onClick={takeSuggested}>{t("raidBoard.class.addSuggested")}</Button>}
                        {row.assignees.some((r) => r.indexOf("slot:") === 0) && <Button variant="ghost" size="sm" data-tip={t("raidBoard.am.bindTip")} onClick={() => { set((b) => bindClassesToSlots(b, row.assignees, row.preferredClasses || [])); setBound(true); }}>{t("raidBoard.am.bind")}</Button>}
                        {slotClassesOfRow(tmp, row).length > 0 && <span className="rp-muted">{t("raidBoard.am.boundTo", { cls: slotClassesOfRow(tmp, row).map((c) => t(`wow.class.${c}`)).join(", ") })}</span>}
                    </div>
                )}
            </>
        );
    };
    const textPanel = () => (
        <div className="rp-amb-textpanel">
            {slot === "task" && (
                <label className="rp-amb-field rp-amb-mobile-only"><span className="rp-kicker">{t("raidBoard.assign.task")}</span>
                    <input value={row.title} maxLength={80} placeholder={typeName} onChange={(e) => set((b) => patchAssignment(b, rowId, { title: e.target.value }))} />
                </label>
            )}
            {slot === "at" && (
                <>
                    <label className="rp-amb-field"><span className="rp-kicker">{t("raidBoard.amb.textTarget")}</span>
                        <input value={text} maxLength={60} placeholder={t("raidBoard.assign.textTarget")} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { e.preventDefault(); e.stopPropagation(); set((b) => onText(b, rowId, text.trim())); setText(""); } }} />
                    </label>
                    {quickTexts(type).length > 0 && (
                        <div className="rp-amb-block">
                            <span className="rp-kicker">{t("raidBoard.amb.quick")}</span>
                            <div className="rp-amb-grid">
                                {quickTexts(type).map((q) => { const on = row.targets.some((x) => x.kind === "text" && x.ref === q); return <button key={q} type="button" className={`rp-amb-tile${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => set((b) => toggleTarget(b, rowId, { kind: "text", ref: q }))}><span className="rp-amb-name">{q}</span>{on && <Check size={14} className="rp-amb-check" aria-hidden="true" />}</button>; })}
                            </div>
                        </div>
                    )}
                </>
            )}
            <label className="rp-amb-field"><span className="rp-kicker">{t("raidBoard.amb.note")}</span>
                <input value={row.note} maxLength={200} placeholder={t("raidBoard.assign.note")} onChange={(e) => set((b) => patchAssignment(b, rowId, { note: e.target.value }))} />
            </label>
        </div>
    );
    /**
     * Several mobs of one kind ("Flame of Azzinoth" x2): per chosen mob of a tank row its "Anzahl" (numbered targets, one tank each) and,
     * for a single one, its "Nr." (which of them; "eigene" = the row's own, numbered by the rows in order). What the map puts there follows.
     */
    const mobCounts = () => {
        // a mob placed twice or more on the map is chosen icon by icon (its tiles say "Flame 1", "Flame 2"): no count / number of its own then
        const refs = row.targets.filter((x) => x.kind === "mob" && !x.oid && mobIconsOf(tmp, x.ref).length < 2).map((x) => x.ref).filter((r, i, all) => all.indexOf(r) === i);
        if (refs.length === 0 || TANK_TYPES.indexOf(type) < 0) return null;
        return (
            <div className="rp-amb-block rp-amb-mobcount">
                <span className="rp-kicker" data-tip={t("raidBoard.auto.severalTip")}>{t("raidBoard.auto.several")}</span>
                {refs.map((ref) => {
                    const tg = row.targets.find((x) => x.kind === "mob" && x.ref === ref);
                    const count = mobCountOf(row, ref);
                    const inst = mobInstanceOf(row, ref);
                    const name = (tg && tg.name) || ref;
                    return (
                        <div key={ref} className="rp-amb-mobline">
                            <MobIcon icon={(tg && tg.icon) || ""} size={22} />
                            <b className="rp-amb-card-name">{name}</b>
                            <span className="rp-amb-step" role="group" aria-label={`${t("raidBoard.auto.count")}: ${name}`}>
                                <button type="button" aria-label={t("raidBoard.class.fewer")} disabled={count <= 1} onClick={() => set((b) => ({ ...b, assignments: setMobCount(b.assignments, rowId, ref, count - 1) }))}><Minus size={14} /></button>
                                <b aria-live="polite">{count}</b>
                                <button type="button" aria-label={t("raidBoard.class.more")} disabled={count >= 20} onClick={() => set((b) => ({ ...b, assignments: setMobCount(b.assignments, rowId, ref, count + 1) }))}><Plus size={14} /></button>
                            </span>
                            {count === 1 && ref.indexOf("b:") !== 0 && (
                                <span className="rp-amb-seg sm" role="radiogroup" aria-label={`${t("raidBoard.auto.inst")}: ${name}`}>
                                    <span className="rp-muted">{t("raidBoard.auto.inst")}</span>
                                    {[0, 1, 2, 3, 4].map((n) => <button key={n} type="button" role="radio" aria-checked={inst === n} className={inst === n ? "is-on" : ""} onClick={() => set((b) => ({ ...b, assignments: setMobInstance(b.assignments, rowId, ref, n) }))}>{n === 0 ? t("raidBoard.auto.instOwn") : n}</button>)}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };
    /** "Rollen": a whole role group ("Melees -> Boss", "Ranged soaken hier"), never split into players, never a count or a fallback. */
    const rolesPanel = () => (
        <>
            <div className="rp-amb-grid rp-amb-grid-wide">
                {ROLE_REFS.map((r) => {
                    const key = slot === "who" ? `role:${r}` : `role|${r}`;
                    return tile(key, chosen.indexOf(key) >= 0, <><span className="rp-rolechip-ico" style={{ ["--rc" as string]: ROLE_TONE[r] }}><WowIcon name={ROLE_ICON[r] || ROLE_ICON.dps} size={22} /></span><span className="rp-amb-name">{t(`raidBoard.roleGroup.${r}`)}</span></>, t(`raidBoard.roleGroup.${r}`));
                })}
            </div>
            <p className="rp-muted rp-amb-note">{t("raidBoard.roleGroupUi.refHint")}</p>
        </>
    );
    const byPrefix = (c: string) => targetOpts.filter((o) => o.key.indexOf(c === "groups" ? "group|" : c === "marks" ? "mark|" : "mob|") === 0);
    const panel = () => {
        if (cat === "people") return peoplePanel();
        if (cat === "classes") return classesPanel();
        if (cat === "roles") return rolesPanel();
        if (cat === "spells") return optionsPanel(spells, "rp-amb-grid-wide");
        if (cat === "text") return textPanel();
        if (cat === "mobs") return <>{optionsPanel(byPrefix(cat), "rp-amb-grid-wide")}{mobCounts()}</>;
        return optionsPanel(byPrefix(cat), cat === "marks" ? "rp-amb-grid-marks" : "");
    };
    const catCount = (c: string): string => {
        if (c === "people") return String(isEvent && mode === "player" ? roster.length : peopleEntries(tmp.slots, roster, "slot", slot).length);
        if (c === "classes") return String((impliedTank ? TANK_CLASSES.length : 0) + classTiles.length);
        if (c === "roles") return String(ROLE_REFS.length);
        if (c === "spells") return String(spells.length);
        if (c === "text") return "";
        return String(byPrefix(c).length);
    };

    // ---- the preview ----
    const lines = previewLines(row, filled, ctx);
    const openWord = t("raidBoard.amb.openSlot");
    const taskIcon = row.spell && row.spell.icon ? row.spell.icon : iconForTask(row);

    return (
        <Modal
            open onClose={onClose} title={row.title || title} kicker={t("raidBoard.amb.kicker", { type: typeName })} icon={taskIcon}
            width={1320} className="rp-amb dlg-flush dlg-sheet" initialFocus={`#rp-amb-slot-${slot}`}
            hint={t("raidBoard.amb.hint")}
            footer={(
                <>
                    {onRemove && <Button variant="ghost" className="rp-amb-remove" icon={<Trash2 size={16} />} onClick={onRemove}>{t("raidBoard.amb.removeRow")}</Button>}
                    <Button variant="ghost" onClick={onClose}>{t("raidBoard.am.cancel")}</Button>
                    <Button icon={<Check size={16} />} onClick={done}>{t("raidBoard.am.done")}</Button>
                </>
            )}
        >
            <div className="rp-amb-body" onKeyDown={onKey}>
                <div className="rp-amb-bar" role="tablist" aria-label={t("raidBoard.amb.bar")}>
                    {BAR_SLOTS.map((s) => (
                        <div key={s} className={`rp-amb-slot is-${s}${s === slot ? " is-on" : ""}`} onClick={() => setSlot(s)}>
                            <button
                                type="button" id={`rp-amb-slot-${s}`} role="tab" aria-selected={s === slot} aria-controls="rp-amb-panel" tabIndex={s === slot ? 0 : -1}
                                className="rp-amb-slot-tab" onKeyDown={barKey} onClick={(e) => { e.stopPropagation(); setSlot(s); }}
                            >
                                <span className="rp-kicker">{t(`raidBoard.amb.slot.${s}`)}</span>
                                {s === slot && <span className="rp-amb-slot-hint">· {t("raidBoard.amb.activeHint")}</span>}
                                <span className="rp-amb-slot-count">{chosenKeys(row, s).length || ""}</span>
                            </button>
                            {s === "who" && isEvent && (
                                <button type="button" className="rp-amb-suggest" disabled={busy} data-tip={t("raidBoard.am.suggest")} aria-label={t("raidBoard.am.suggest")} onClick={(e) => { e.stopPropagation(); suggest(); }}><Wand2 size={15} /></button>
                            )}
                            <div className="rp-amb-slot-chips">{slotContent(s)}</div>
                        </div>
                    ))}
                </div>
                <div className="rp-amb-main">
                    <div className="rp-amb-nav" role="tablist" aria-orientation="vertical" aria-label={t("raidBoard.amb.nav")}>
                        <span className="rp-kicker rp-amb-navhead">{t("raidBoard.amb.nav")}</span>
                        {catList.map((c) => (
                            <button key={c} id={`rp-amb-cat-${c}`} type="button" role="tab" aria-selected={c === cat} aria-controls="rp-amb-panel" tabIndex={c === cat ? 0 : -1} className={`rp-amb-navbtn${c === cat ? " is-on" : ""}`} onClick={() => setCat(c)} onKeyDown={navKey}>
                                {CAT_ICON[c]}<span className="rp-amb-navlabel">{t(`raidBoard.amb.cat.${c}`)}</span>{counts[c] ? <span className="rp-amb-navcnt is-chosen" aria-label={t("raidBoard.amb.chosen", { n: counts[c] })}><Check size={12} aria-hidden="true" />{counts[c]}</span> : <span className="rp-amb-navcnt">{catCount(c)}</span>}
                            </button>
                        ))}
                    </div>
                    <section id="rp-amb-panel" className={`rp-amb-panel is-${cat}`} role="tabpanel" aria-labelledby={`rp-amb-cat-${cat}`}>
                        {panel()}
                    </section>
                </div>
                <div className="rp-amb-preview" role="group" aria-label={t("raidBoard.amb.preview")}>
                    <span className="rp-kicker">{t("raidBoard.amb.preview")}</span>
                    <div className="rp-amb-pcard">
                        <span className="rp-amb-ptask"><WowIcon name={taskIcon} size={26} /><b>{row.title || typeName}</b></span>
                        <div className="rp-amb-plines">
                            {lines.length === 0 && <span className="rp-muted">{t("raidBoard.amb.previewEmpty")}</span>}
                            {lines.map((l) => (
                                <span key={`${l.order}`} className={`rp-amb-pline${l.open ? " is-open" : ""}`} aria-label={previewText(l, openWord)}>
                                    {type === "kick" && lines.length > 1 && <span className="rp-achip-no">{l.order}</span>}
                                    {l.who.player ? <><TokenIcon player={l.who.player} size="sm" /><PlayerName player={l.who.player} /></> : <><WowIcon name={l.who.icon || ROLE_ICON[l.who.role] || ROLE_ICON.dps} size={18} /><span>{l.who.label}{l.who.kind === "role" ? "" : ` · ${openWord}`}</span></>}
                                    {l.targets.length > 0 && <ArrowRight size={14} aria-hidden="true" className="rp-muted" />}
                                    {l.targets.slice(0, 3).map((tg) => <span key={`${tg.kind}${tg.ref}`} className={`rp-amb-ptarget${tg.kind === "group" ? " is-group" : ""}`} style={tg.kind === "group" ? { borderLeftColor: groupColor(tmp.groupColors, tg.group) } : undefined}>{tg.player ? <PlayerName player={tg.player} /> : tg.label}</span>)}
                                    {l.targets.length > 3 && <span className="rp-muted">+{l.targets.length - 3}</span>}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
