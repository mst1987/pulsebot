import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Minus, Plus, Search, Trash2, X } from "lucide-react";
import type { Catalog, RaidplanAssignment, RaidplanBoard, RaidplanMobRef, RaidplanPlayer, RaidplanStep, RaidplanStepTarget, RaidplanTiming } from "../../../api";
import { Button, Modal } from "../../../components/ui";
import WowIcon from "../../../components/ui/WowIcon";
import { MarkIcon } from "../../../components/raidplan/MarkIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { ActionIcon, TimingIcon } from "../../../components/raidplan/ActionIcon";
import { ALL_MARKS, CLASS_IDS, ROLE_ICON, classIconOf, classPlaceNameFor, classRefIcon, type AssignCtx } from "../../../lib/assign";
import { ANY_SPEC, CLASS_COLOR, classGroups, classRef, defaultClassRole, effectiveRole, impliedRole, isClassRef, nextClassN, setClassCount, setClassRole, storedRole } from "../../../lib/classRefs";
import { CLASS_ROLE_CHOICES, classCount, filterPeople, peopleEntries } from "../../../lib/assignModal";
import { ACTIONS, MAX_SENTENCE, TASK_OF, applyMention, fillSuggestion, mentionAt, mentionMatches, resolveParticipants, suggestionsFor, type MentionEntry } from "../../../lib/steps";
import { groupColor } from "../../../lib/groupStyle";
import { MobIcon } from "./AssignPanel";
import { StepPeople, StepSentence, TimingChip } from "./StepParts";
import { useT } from "../../../i18n";

const TIMING_KINDS = ["pull", "phase", "hp", "interval", "now", "text"];
const MAX_PEOPLE = 12;

/**
 * One step of a tactic in ONE dialog without scrolling (design "Taktik · Details"): 1 the action (icon grid), 2 who (the chosen chips,
 * tabs players / role slots / classes / groups with a search; classes like the assignment dialog: count and role filter incl. "Alle
 * Specs"), 3 the sentence (suggestions of the action; "@" names a raider or a mob as chips under the field — a raider joins the
 * participants, a mob the targets), 4 when and at what (chips, numbers, free text), the preview "So steht es im Plan" and the foot
 * "Schritt entfernen / Abbrechen / Fertig" (Ctrl+Enter = Fertig, Esc = Abbrechen).
 */
export default function StepModal({ step, index, bossName, board, roster, players, isEvent, catalog, sectionMobs, groupCount, onDone, onRemove, onClose }: {
    step: RaidplanStep;
    /** the step's number (1 ...), 0 for a new one */
    index: number;
    bossName: string;
    board: RaidplanBoard;
    roster: RaidplanPlayer[];
    players: Map<string, RaidplanPlayer>;
    isEvent: boolean;
    catalog: Catalog | null;
    sectionMobs: RaidplanMobRef[];
    groupCount: number;
    onDone: (step: RaidplanStep) => void;
    onRemove?: () => void;
    onClose: () => void;
}) {
    const t = useT();
    const [s, setS] = useState<RaidplanStep>(step);
    const [tab, setTab] = useState(isEvent ? "players" : "slots");
    const [query, setQuery] = useState("");
    const [caret, setCaret] = useState(step.sentence.length);
    const [sel, setSel] = useState(0);
    const [zone, setZone] = useState("");
    // on a phone the four questions are tabs (one at a time), so nothing scrolls there either
    const [part, setPart] = useState(1);
    const cur = (n: number) => (part === n ? " is-cur" : "");
    const input = useRef<HTMLInputElement>(null);
    const ctx: AssignCtx = { slots: board.slots, players, catalog, groupColors: board.groupColors, groupMarks: board.groupMarks };
    const task = TASK_OF[s.action] || "other";
    const filled = useMemo(() => resolveParticipants(s, board.slots, roster, board.roles || {}), [s, board.slots, board.roles, roster]);
    const groups = Array.from({ length: Math.max(1, groupCount) }, (_, i) => i + 1);
    const patch = (p: Partial<RaidplanStep>) => setS((cur) => ({ ...cur, ...p }));

    // ---- participants ----
    const has = (ref: string) => s.participants.indexOf(ref) >= 0;
    const toggle = (ref: string) => setS((cur) => ({ ...cur, participants: cur.participants.indexOf(ref) >= 0 ? cur.participants.filter((r) => r !== ref) : cur.participants.length >= MAX_PEOPLE ? cur.participants : [...cur.participants, ref] }));
    /** Class counts and roles through the same functions as the assignment dialog, on the step as a one-row list. */
    const viaRow = (fn: (rows: RaidplanAssignment[]) => RaidplanAssignment[]) => setS((cur) => {
        const grp = cur.participants.filter((r) => r.indexOf("group:") === 0);
        const row: RaidplanAssignment = { id: "step", type: task, title: "", spell: null, assignees: cur.participants.filter((r) => r.indexOf("group:") !== 0), targets: [], note: "", suggested: false };
        const out = fn([row])[0];
        return { ...cur, participants: [...out.assignees, ...grp].slice(0, MAX_PEOPLE) };
    });
    const classRefs = s.participants.filter((r) => isClassRef(r));
    const cGroups = classGroups(classRefs);
    const toggleClass = (c: string) => {
        const mine = cGroups.filter((g) => g.classId === c);
        if (mine.length > 0) { viaRow((rows) => { let r = rows; for (const g of mine) r = setClassCount(r, "step", c, g.role, 0, false); return r; }); return; }
        const role = defaultClassRole(c, task);
        toggle(classRef(c, nextClassN(classRefs, c, role), role));
    };

    // ---- sentence and @ ----
    const mention = mentionAt(s.sentence, caret);
    const entries: MentionEntry[] = useMemo(() => [
        ...(isEvent ? roster.map((p) => ({ key: `user:${p.userId}`, kind: "player", label: p.character, ref: `user:${p.userId}`, icon: "" })) : []),
        ...sectionMobs.map((m) => ({ key: `mob:${m.id}`, kind: "mob", label: m.name, ref: m.id, icon: m.icon })),
    ], [isEvent, roster, sectionMobs]);
    const matches = mention ? mentionMatches(mention.query, entries, 6) : [];
    const pickMention = (e: MentionEntry) => {
        if (!mention) return;
        const text = applyMention(s.sentence, mention.start, caret, e.label).slice(0, MAX_SENTENCE);
        const next: Partial<RaidplanStep> = { sentence: text };
        if (e.kind === "player" && !has(e.ref)) next.participants = [...s.participants, e.ref].slice(0, MAX_PEOPLE);
        if (e.kind === "mob") {
            const m = sectionMobs.find((x) => x.id === e.ref);
            if (m && !s.targets.some((x) => x.kind === "mob" && x.ref === m.id)) next.targets = [...s.targets, { kind: "mob", ref: m.id, name: m.name, icon: m.icon }];
        }
        patch(next);
        setCaret(text.length);
        setSel(0);
        requestAnimationFrame(() => { if (input.current) { input.current.focus(); input.current.setSelectionRange(text.length, text.length); } });
    };
    const onSentenceKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (matches.length === 0) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSel((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length); }
        else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); pickMention(matches[Math.min(sel, matches.length - 1)]); }
    };
    const firstTarget = s.targets.find((x) => x.kind === "mob");

    // ---- timing and targets ----
    const setTiming = (tm: Partial<RaidplanTiming>) => patch({ timing: { ...s.timing, ...tm } });
    const pickKind = (k: string) => {
        if (s.timing.kind === k) { patch({ timing: { kind: "", from: null, to: null, text: "" } }); return; }
        const from = k === "phase" ? 2 : k === "hp" ? 30 : k === "interval" ? 30 : null;
        patch({ timing: { kind: k as RaidplanTiming["kind"], from, to: null, text: "" } });
    };
    const hasTarget = (tg: RaidplanStepTarget) => s.targets.some((x) => x.kind === tg.kind && x.ref === tg.ref);
    const toggleTarget = (tg: RaidplanStepTarget) => patch({ targets: hasTarget(tg) ? s.targets.filter((x) => !(x.kind === tg.kind && x.ref === tg.ref)) : [...s.targets, tg].slice(0, 8) });
    const zones = [...new Set([t("raidBoard.steps.target.arena"), ...board.zones.map((z) => z.label.trim()).filter(Boolean)])];

    const done = () => onDone({ ...s, sentence: s.sentence.trim() });
    const onKey = (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(); } };

    // ---- the lists of the "who" tabs ----
    const list = tab === "players" || tab === "slots" ? filterPeople(peopleEntries(board.slots, roster, tab === "players" ? "player" : "slot", "who"), "all", query) : [];
    const tabs = [...(isEvent ? ["players"] : []), "slots", "classes", "groups"];
    const count = (k: string) => (k === "players" ? roster.length : k === "slots" ? peopleEntries(board.slots, roster, "slot", "who").length : k === "classes" ? CLASS_IDS.length : groups.length);
    const personChip = (key: string, player: RaidplanPlayer | null, label: string, kind: string, n: number) => (
        <button key={key} type="button" className={`rp-amb-tile rp-st-pick${has(key) ? " is-on" : ""}`} aria-pressed={has(key)} onClick={() => toggle(key)}>
            {player ? <TokenIcon player={player} size="sm" /> : <WowIcon name={ROLE_ICON[kind] || ROLE_ICON.dps} size={18} />}
            {n > 0 && <span className="rp-amb-n">{n}</span>}
            {player ? <PlayerName player={player} className="rp-amb-name" /> : <span className="rp-amb-name rp-muted">{label}</span>}
            {has(key) && <Check size={13} className="rp-amb-check" aria-hidden="true" />}
        </button>
    );

    return (
        <Modal
            open onClose={onClose} width={860} className="rp-stm dlg-flush dlg-sheet" initialFocus=".rp-stm-act.is-on, .rp-stm-act"
            icon={<ActionIcon action={s.action} size={36} />} kicker={t("raidBoard.steps.kicker", { boss: bossName })}
            title={index > 0 ? t("raidBoard.steps.editN", { n: index }) : t("raidBoard.steps.newStep")}
            hint={t("raidBoard.steps.hint")}
            footer={(
                <>
                    {onRemove && <Button variant="ghost" className="rp-amb-remove" icon={<Trash2 size={16} />} onClick={onRemove}>{t("raidBoard.steps.remove")}</Button>}
                    <Button variant="ghost" onClick={onClose}>{t("raidBoard.am.cancel")}</Button>
                    <Button icon={<Check size={16} />} onClick={done}>{t("raidBoard.am.done")}</Button>
                </>
            )}
        >
            <div className="rp-stm-body" onKeyDown={onKey}>
                <div className="rp-stm-parts rp-amb-seg" role="tablist" aria-label={t("raidBoard.steps.parts")}>
                    {[1, 2, 3, 4].map((n) => <button key={n} type="button" role="tab" aria-selected={part === n} className={part === n ? "is-on" : ""} onClick={() => setPart(n)}>{n} {t(`raidBoard.steps.sec.${["", "action", "who", "sentence", "whenOnly"][n]}`)}</button>)}
                </div>
                <section className={`rp-stm-sec${cur(1)}`} aria-labelledby="rp-stm-l1">
                    <h3 id="rp-stm-l1" className="rp-kicker"><span className="rp-stm-no">1</span>{t("raidBoard.steps.sec.action")} <span className="rp-muted">· {t("raidBoard.steps.sec.actionHint")}</span></h3>
                    <div className="rp-stm-acts" role="radiogroup" aria-label={t("raidBoard.steps.sec.action")}>
                        {ACTIONS.map((a) => (
                            <button key={a} type="button" role="radio" aria-checked={s.action === a} data-tip={t(`raidBoard.steps.actions.${a}`)} className={`rp-stm-act${s.action === a ? " is-on" : ""}`} onClick={() => patch({ action: a })}>
                                <ActionIcon action={a} size={28} /><span>{t(`raidBoard.steps.actions.${a}`)}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className={`rp-stm-sec${cur(2)}`} aria-labelledby="rp-stm-l2">
                    <h3 id="rp-stm-l2" className="rp-kicker"><span className="rp-stm-no">2</span>{t("raidBoard.steps.sec.who")} <span className="rp-muted">· {t("raidBoard.steps.sec.whoHint")}</span></h3>
                    <div className="rp-stm-chosen">
                        {s.participants.length === 0 ? <span className="rp-muted">{t("raidBoard.amb.empty")}</span> : (
                            <>
                                <StepPeople step={s} filled={filled} ctx={ctx} isEvent={isEvent} />
                                <button type="button" className="rp-stm-clear" aria-label={t("raidBoard.steps.clearWho")} data-tip={t("raidBoard.steps.clearWho")} onClick={() => patch({ participants: [] })}><X size={13} /></button>
                            </>
                        )}
                    </div>
                    <div className="rp-stm-tabs">
                        <span className="rp-amb-seg" role="tablist" aria-label={t("raidBoard.steps.sec.who")}>
                            {tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "is-on" : ""} onClick={() => setTab(k)}>{t(`raidBoard.steps.tabs.${k}`)} <span className="rp-muted">{count(k)}</span></button>)}
                        </span>
                        {(tab === "players" || tab === "slots") && <label className="rp-amb-search"><Search size={15} aria-hidden="true" /><input value={query} placeholder={t("raidBoard.am.search")} aria-label={t("raidBoard.am.search")} onChange={(e) => setQuery(e.target.value)} /></label>}
                    </div>
                    <div className="rp-stm-grid" role="tabpanel">
                        {(tab === "players" || tab === "slots") && list.map((e) => personChip(e.key, e.player, `${t(`raidBoard.slot.kind.${e.kind}`)} · ${t("raidBoard.amb.openSlot")}`, e.kind, e.n))}
                        {(tab === "players" || tab === "slots") && list.length === 0 && <span className="rp-muted">{t("raidBoard.am.none")}</span>}
                        {tab === "groups" && groups.map((g) => {
                            const key = `group:${g}`;
                            return <button key={key} type="button" className={`rp-amb-tile rp-st-pick${has(key) ? " is-on" : ""}`} aria-pressed={has(key)} onClick={() => toggle(key)}><span className="rp-gdot" aria-hidden="true" style={{ background: groupColor(board.groupColors, g) }} /><span className="rp-amb-name">{t("raidBoard.slot.group", { n: g })}</span>{has(key) && <Check size={13} className="rp-amb-check" aria-hidden="true" />}</button>;
                        })}
                        {tab === "classes" && CLASS_IDS.map((c) => {
                            const on = cGroups.some((g) => g.classId === c);
                            const role = effectiveRole(defaultClassRole(c, task), task);
                            const n = classCount(roster, c, role === ANY_SPEC ? "" : role, board.roles || {});
                            return (
                                <button key={c} type="button" className={`rp-amb-tile rp-st-pick${on ? " is-on" : ""}${roster.length > 0 && n === 0 ? " is-absent" : ""}`} aria-pressed={on} style={{ ["--cc" as string]: CLASS_COLOR[c] }} onClick={() => toggleClass(c)}>
                                    <WowIcon name={classIconOf(c)} size={18} /><span className="rp-amb-cname">{t(`wow.class.${c}`)}</span>
                                    {roster.length > 0 && <span className={`rp-amb-cnt${n === 0 ? " is-none" : ""}`}>{n}</span>}
                                    {on && <Check size={13} className="rp-amb-check" aria-hidden="true" />}
                                </button>
                            );
                        })}
                    </div>
                    {tab === "classes" && cGroups.length > 0 && (
                        <div className="rp-stm-cls">
                            {cGroups.map((g) => {
                                const roles = [ANY_SPEC, ...(CLASS_ROLE_CHOICES[g.classId] || []), impliedRole(task)].filter((r, i, all) => !!r && all.indexOf(r) === i);
                                const eff = effectiveRole(g.role, task);
                                const name = classPlaceNameFor(g.classId, g.role, task);
                                return (
                                    <div key={`${g.classId}|${g.role}`} className="rp-stm-cl" style={{ ["--cc" as string]: CLASS_COLOR[g.classId] }}>
                                        <WowIcon name={classRefIcon(g.classId, g.role)} size={18} /><b className="rp-amb-card-name">{name}</b>
                                        <span className="rp-amb-step" role="group" aria-label={`${t("raidBoard.amb.count")}: ${name}`}>
                                            <button type="button" aria-label={t("raidBoard.class.fewer")} disabled={g.refs.length <= 1} onClick={() => viaRow((r) => setClassCount(r, "step", g.classId, g.role, g.refs.length - 1, false))}><Minus size={13} /></button>
                                            <b aria-live="polite">{g.refs.length}</b>
                                            <button type="button" aria-label={t("raidBoard.class.more")} onClick={() => viaRow((r) => setClassCount(r, "step", g.classId, g.role, g.refs.length + 1, false))}><Plus size={13} /></button>
                                        </span>
                                        {roles.length > 1 && (
                                            <span className="rp-amb-seg sm" role="radiogroup" aria-label={t("raidBoard.amb.role")}>
                                                {roles.map((r) => <button key={r} type="button" role="radio" aria-checked={eff === r} className={eff === r ? "is-on" : ""} onClick={() => { if (eff !== r) viaRow((rows) => setClassRole(rows, "step", g.classId, g.role, storedRole(r, task), false)); }}>{t(`raidBoard.class.roles.${r}`)}</button>)}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                <div className="rp-stm-two">
                    <section className={`rp-stm-sec${cur(3)}`} aria-labelledby="rp-stm-l3">
                        <h3 id="rp-stm-l3" className="rp-kicker"><span className="rp-stm-no">3</span>{t("raidBoard.steps.sec.sentence")} <span className="rp-muted">· {t("raidBoard.steps.sec.sentenceHint")}</span></h3>
                        <input
                            ref={input} className="rp-stm-input" value={s.sentence} maxLength={MAX_SENTENCE} placeholder={t("raidBoard.steps.sentencePlaceholder")} aria-label={t("raidBoard.steps.sec.sentence")}
                            role="combobox" aria-expanded={matches.length > 0} aria-controls="rp-stm-mentions" aria-autocomplete="list"
                            onChange={(e) => { patch({ sentence: e.target.value }); setCaret(e.target.selectionStart || e.target.value.length); setSel(0); }}
                            onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart || 0)} onKeyDown={onSentenceKey}
                        />
                        {matches.length > 0 ? (
                            <div id="rp-stm-mentions" className="rp-stm-row" role="listbox" aria-label={t("raidBoard.steps.mentionHint")}>
                                {matches.map((e, i) => {
                                    const p = e.kind === "player" ? players.get(e.ref.slice(5)) || null : null;
                                    return (
                                        <button key={e.key} type="button" role="option" aria-selected={i === sel} className={`rp-amb-tile rp-st-pick${i === sel ? " is-on" : ""}`} onMouseDown={(ev) => ev.preventDefault()} onClick={() => pickMention(e)}>
                                            {p ? <TokenIcon player={p} size="sm" /> : <MobIcon icon={e.icon} size={18} />}
                                            {p ? <PlayerName player={p} className="rp-amb-name" /> : <span className="rp-amb-name">{e.label}</span>}
                                        </button>
                                    );
                                })}
                                <span className="rp-muted">{t("raidBoard.steps.mentionHint")}</span>
                            </div>
                        ) : suggestionsFor(s.action).length > 0 && (
                            <div className="rp-stm-row">
                                <span className="rp-muted">{t("raidBoard.steps.suggestions")}</span>
                                {suggestionsFor(s.action).map((x) => <button key={x} type="button" className="rp-stm-sug" onClick={() => { const text = fillSuggestion(x, firstTarget ? firstTarget.name || "" : bossName); patch({ sentence: text }); setCaret(text.length); }}>{x}</button>)}
                            </div>
                        )}
                    </section>
                    <section className={`rp-stm-sec${cur(4)}`} aria-labelledby="rp-stm-l4">
                        <h3 id="rp-stm-l4" className="rp-kicker"><span className="rp-stm-no">4</span>{t("raidBoard.steps.sec.when")} <span className="rp-muted">· {t("raidBoard.steps.sec.whenHint")}</span></h3>
                        <div className="rp-stm-row" role="group" aria-label={t("raidBoard.steps.sec.whenOnly")}>
                            {TIMING_KINDS.map((k) => <button key={k} type="button" aria-pressed={s.timing.kind === k} className={`rp-tmchip is-btn${s.timing.kind === k ? " is-on" : ""}`} onClick={() => pickKind(k)}><TimingIcon kind={k} />{t(`raidBoard.steps.timing.${k}`)}</button>)}
                        </div>
                        {["phase", "hp", "interval", "text"].indexOf(s.timing.kind) >= 0 && (
                            <div className="rp-stm-row">
                                {s.timing.kind === "phase" && <label className="rp-stm-num">{t("raidBoard.steps.timing.phase")}<input type="number" min={1} max={9} value={s.timing.from || 1} onChange={(e) => setTiming({ from: Math.max(1, Math.min(9, Number(e.target.value) || 1)) })} /></label>}
                                {s.timing.kind === "interval" && <label className="rp-stm-num">{t("raidBoard.steps.timing.every")}<input type="number" min={1} max={600} value={s.timing.from || 30} onChange={(e) => setTiming({ from: Math.max(1, Math.min(600, Number(e.target.value) || 30)) })} />s</label>}
                                {s.timing.kind === "hp" && (
                                    <>
                                        <label className="rp-stm-num">{t("raidBoard.steps.timing.from")}<input type="number" min={1} max={100} value={s.timing.from === null ? 50 : s.timing.from} onChange={(e) => setTiming({ from: Math.max(1, Math.min(100, Number(e.target.value) || 50)) })} />%</label>
                                        <label className="rp-stm-num">{t("raidBoard.steps.timing.to")}<input type="number" min={0} max={99} value={s.timing.to === null ? "" : s.timing.to} placeholder="–" onChange={(e) => setTiming({ to: e.target.value === "" ? null : Math.max(0, Math.min(99, Number(e.target.value))) })} />%</label>
                                    </>
                                )}
                                {s.timing.kind === "text" && <input className="rp-stm-input is-short" value={s.timing.text} maxLength={40} placeholder={t("raidBoard.steps.timing.textPlaceholder")} aria-label={t("raidBoard.steps.timing.text")} onChange={(e) => setTiming({ text: e.target.value })} />}
                            </div>
                        )}
                        <div className="rp-stm-row" role="group" aria-label={t("raidBoard.steps.target.title")}>
                            {sectionMobs.map((m) => { const tg: RaidplanStepTarget = { kind: "mob", ref: m.id, name: m.name, icon: m.icon }; return <button key={m.id} type="button" aria-pressed={hasTarget(tg)} className={`rp-amb-tile rp-st-pick is-sm${hasTarget(tg) ? " is-on" : ""}`} onClick={() => toggleTarget(tg)}><MobIcon icon={m.icon} size={18} /><span className="rp-amb-name">{m.name}</span></button>; })}
                            {zones.map((z) => { const tg: RaidplanStepTarget = { kind: "zone", ref: z }; return <button key={`z${z}`} type="button" aria-pressed={hasTarget(tg)} className={`rp-amb-tile rp-st-pick is-sm is-zone${hasTarget(tg) ? " is-on" : ""}`} onClick={() => toggleTarget(tg)}><span className="rp-amb-name">{z}</span></button>; })}
                            {ALL_MARKS.map((mk) => { const tg: RaidplanStepTarget = { kind: "mark", ref: mk }; return <button key={mk} type="button" aria-pressed={hasTarget(tg)} aria-label={t(`raidBoard.mark.${mk}`)} data-tip={t(`raidBoard.mark.${mk}`)} className={`rp-amb-tile rp-st-pick is-sm is-icon${hasTarget(tg) ? " is-on" : ""}`} onClick={() => toggleTarget(tg)}><MarkIcon mark={mk as never} size={18} /></button>; })}
                            {groups.map((g) => { const tg: RaidplanStepTarget = { kind: "group", ref: String(g) }; return <button key={`g${g}`} type="button" aria-pressed={hasTarget(tg)} className={`rp-amb-tile rp-st-pick is-sm${hasTarget(tg) ? " is-on" : ""}`} onClick={() => toggleTarget(tg)}><span className="rp-gdot" aria-hidden="true" style={{ background: groupColor(board.groupColors, g) }} /><span className="rp-amb-name">{t("raidBoard.slot.group", { n: g })}</span></button>; })}
                            <input className="rp-stm-input is-short" value={zone} maxLength={40} placeholder={t("raidBoard.steps.target.zonePlaceholder")} aria-label={t("raidBoard.steps.target.zone")} onChange={(e) => setZone(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && zone.trim() && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); toggleTarget({ kind: "zone", ref: zone.trim() }); setZone(""); } }} />
                        </div>
                    </section>
                </div>

                <section className="rp-stm-sec rp-stm-preview" aria-label={t("raidBoard.steps.sec.preview")}>
                    <span className="rp-kicker">{t("raidBoard.steps.sec.preview")}</span>
                    <div className="rp-stm-pcard">
                        <ActionIcon action={s.action} size={30} />
                        <span className="rp-st-line">
                            <StepPeople step={s} filled={filled} ctx={ctx} isEvent={isEvent} />
                            <StepSentence step={s} ctx={ctx} />
                            <TimingChip timing={s.timing} />
                        </span>
                    </div>
                </section>
            </div>
        </Modal>
    );
}
