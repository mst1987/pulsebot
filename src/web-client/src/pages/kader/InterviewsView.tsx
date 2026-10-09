// Step 2 · Vorauswahl · Gespräche (/kader/<id>/vorauswahl): the players in the
// Vorauswahl on the left (○ Offen / ✓ Geführt / Alle), the interview of the
// chosen one on the right — the wishes in order (the first is the favourite;
// spec icon plus class), the note and the questions of this Kader, each with
// its status (✓ beantwortet, ! noch offen). It saves itself a moment after each
// change (only what changed), when another player is chosen and when the page
// is left. "Gespräch abschließen" needs a wish and every required answer; a
// completed interview is locked until it is opened again. ?spieler=<id> picks
// the player — also one further along (the Vorläufig drawer links here).
//
// Live: somebody else's save shows by itself while nothing is unsaved here; with
// unsaved input the panel keeps it and asks (useInterviewDraft). Who else has
// this interview open stands on top (PresenceBanner), a marker on the list row.
// Who did what when is in the "Verlauf" (HistoryButton), not on the form.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
    completeKaderInterview, reopenKaderInterview, setKaderState,
    type KaderAnswer, type KaderEntry, type KaderQuestion, type KaderWish,
} from "../../api";
import { Button, IconButton, Segment, buttonClass } from "../../components/ui";
import { AlertIcon, BookIcon, CheckIcon, ChevronDownIcon, CircleIcon, EditIcon, ListChecksIcon, PlusIcon, RefreshIcon, SaveIcon, XIcon } from "../../components/ui/icons";
import { useToast } from "../../components/shell/Jobs";
import { useT } from "../../i18n";
import { LEAD_ALL, LEAD_ME, LEAD_NONE, cleanLeadPick, interviewersOf, leadMatches } from "../../lib/kader/leads";
import { usePersistedState } from "../../lib/persistedState";
import { roleLabel } from "../../lib/wowNames";
import { toneAttrs, toneOf } from "../../lib/kader/colors";
import { personName } from "../../lib/kader/live";
import { classDef, className, dayOf, mainPick, nameOf, playerName, specName, specRole } from "../../lib/kader/model";
import { dayShort, isAnswered, isWeekdays, moveWish, placeWish, progress, statusOf, toggleAnswer } from "../../lib/kader/interview";
import {
    BackButton, Count, DoneBadge, EmptyState, Grip, InterviewChip, PickIcon, PickLabel, PlayerName, ProgressRing, SelectionTabs, SpecIcon, SpecTag,
} from "./parts";
import { useKader, useReportFocus } from "./kaderContext";
import { LeadBadge, LeadMenu, type LeadOption } from "./Leads";
import { HistoryButton } from "./ActivityLog";
import { ConflictBanner, PresenceBanner, PresenceMark } from "./Presence";
import { useInterviewDraft, type InterviewConflict } from "./useInterviewDraft";

type Shown = "open" | "done" | "all";
const MAX_WISHES = 6;
const ORDER = { started: 0, open: 1, done: 2 } as const;

function ListRow({ userId, entry, current, onPick }: { userId: string; entry: KaderEntry; current: boolean; onPick: () => void }) {
    const t = useT();
    const { view, players } = useKader();
    const status = statusOf(entry);
    const iv = entry.interview;
    const sub = status === "done" ? t("kader.interview.subDone", { date: dayOf(iv.completedAt) })
        : status === "started" ? t("kader.interview.subStarted", { date: dayOf(iv.startedAt) })
            : t("kader.interview.subPlanned");
    return (
        <button type="button" className={`kp-ivrow${current ? " kp-current" : ""}`} aria-current={current ? "true" : undefined} onClick={onPick}>
            <PickIcon pick={mainPick(players.get(userId), entry)} size={26} />
            <span className="kp-col kp-grow">
                <span className="kp-ivrow-name">
                    <span className="kp-strong kp-ellipsis">{playerName(view, userId, entry)}</span>
                    {status === "done" && <DoneBadge />}
                    <PresenceMark playerId={userId} />
                </span>
                <span className="kp-leadline">
                    <LeadBadge userId={iv.lead} />
                    <span className="kp-sub">{sub}</span>
                </span>
            </span>
            <InterviewChip entry={entry} />
        </button>
    );
}

/** The wishes in order: drag or the arrows move one; a class and one of its spec icons add one. */
function WishEditor({ wishes, prefill, locked, onChange }: { wishes: KaderWish[]; prefill: KaderWish | null; locked: boolean; onChange: (wishes: KaderWish[]) => void }) {
    const t = useT();
    const { view } = useKader();
    const [cls, setCls] = useState("");
    const [spec, setSpec] = useState("");
    const [from, setFrom] = useState<number | null>(null);
    const def = classDef(view.classes, cls);
    const pick = cls && spec ? { className: cls, spec } : null;
    const known = !!pick && wishes.some((w) => w.spec === pick.spec);

    const pickClass = (key: string) => {
        setCls(key);
        const d = classDef(view.classes, key);
        setSpec(d && d.specs[0] ? d.specs[0].key : "");
    };
    const add = () => {
        if (!pick || known || wishes.length >= MAX_WISHES) return;
        onChange([...wishes, pick]);
        setCls("");
        setSpec("");
    };

    return (
        <>
            <ol className="kp-wishes" aria-label={t("kader.interview.wishes")}>
                {wishes.length === 0 && <li className="kp-hint">{t("kader.interview.noWishesYet")}</li>}
                {wishes.map((w, i) => {
                    const role = specRole(view.classes, w.spec);
                    const pre = !!prefill && prefill.spec === w.spec;
                    return (
                        <li
                            key={w.spec}
                            className={`kp-wish${i === 0 ? " kp-first" : ""}${from === i ? " kp-dragging" : ""}`}
                            draggable={!locked}
                            onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.effectAllowed = "move"; setFrom(i); }}
                            onDragOver={(e) => { if (from !== null) e.preventDefault(); }}
                            onDrop={(e) => { e.preventDefault(); if (from !== null) onChange(placeWish(wishes, from, i)); setFrom(null); }}
                            onDragEnd={() => setFrom(null)}
                        >
                            {!locked && <Grip />}
                            <span className="kp-rank kp-mono">{i + 1}</span>
                            <PickIcon pick={w} size={30} />
                            <span className="kp-col kp-grow">
                                <PickLabel pick={w} className="kp-strong" />
                                <span className="kp-sub">{role ? roleLabel(role) : ""}{pre ? ` · ${t("kader.interview.prefilledShort")}` : ""}</span>
                            </span>
                            {!locked && (
                                <span className="kp-wish-act">
                                    <IconButton icon={<ChevronDownIcon />} className="kp-flip" size="sm" tip={t("kader.interview.up")} disabled={i === 0} onClick={() => onChange(moveWish(wishes, i, -1))} />
                                    <IconButton icon={<ChevronDownIcon />} size="sm" tip={t("kader.interview.down")} disabled={i === wishes.length - 1} onClick={() => onChange(moveWish(wishes, i, 1))} />
                                    <IconButton icon={<XIcon />} size="sm" tip={t("kader.interview.removeWish")} onClick={() => onChange(wishes.filter((_, j) => j !== i))} />
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
            {!locked && (
                <div className="kp-wishadd">
                    <label className="field">
                        <span className="field-label">{t("kader.field.class")}</span>
                        <select value={cls} onChange={(e) => pickClass(e.target.value)}>
                            <option value="">{t("kader.interview.pickClass")}</option>
                            {view.classes.map((c) => <option key={c.key} value={c.key}>{className(view.classes, c.key)}</option>)}
                        </select>
                    </label>
                    {def && (
                        <div className="kp-specpick" role="radiogroup" aria-label={t("kader.field.spec")}>
                            {def.specs.map((s) => {
                                const on = spec === s.key;
                                const taken = wishes.some((w) => w.spec === s.key);
                                return (
                                    <button key={s.key} type="button" role="radio" aria-checked={on} disabled={taken}
                                        aria-label={`${specName(view.classes, s.key)} · ${className(view.classes, def.key)}`}
                                        data-tip={taken ? t("kader.interview.specTaken", { spec: specName(view.classes, s.key) }) : `${specName(view.classes, s.key)} · ${roleLabel(s.role)}`}
                                        className={`kp-specbtn${on ? " kp-on" : ""}`} onClick={() => setSpec(s.key)}>
                                        <SpecIcon specKey={s.key} size={26} />
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    <Button variant="ghost" icon={<PlusIcon />} disabled={!pick || known || wishes.length >= MAX_WISHES} onClick={add}>{t("kader.interview.addWish")}</Button>
                </div>
            )}
        </>
    );
}

/**
 * One question of the Kader: pills for one answer, toggles (or seven day buttons) for several, a text field.
 * Every option carries its colour (lib/kader/colors.ts): the marker always, the picked pill tinted; a picked day in its day colour.
 */
function QuestionField({ q, value, onChange }: { q: KaderQuestion; value: KaderAnswer | undefined; onChange: (value: KaderAnswer) => void }) {
    const t = useT();
    const days = isWeekdays(q);
    const answered = isAnswered(q, value);
    const open = q.required && !answered;
    return (
        <div className="kp-qfield">
            <span className="kp-qlabel">
                {answered
                    ? <span className="kp-qstate kp-ok" role="img" aria-label={t("kader.interview.answered")}><CheckIcon /></span>
                    : open ? <span className="kp-qstate kp-open" role="img" aria-label={t("kader.interview.stillOpen")}><AlertIcon /></span> : <span className="kp-qstate" aria-hidden="true" />}
                <span>{q.text}</span>
                <span className={open ? "kp-warntext" : "kp-muted"}>· {open ? t("kader.interview.stillOpen") : t(`kader.qtype.${q.type}Hint`)}</span>
            </span>
            {q.type === "text" ? (
                <textarea rows={2} maxLength={1000} aria-label={q.text} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
            ) : (
                <div className={days ? "kp-days" : "kp-pills"} role={q.type === "single" ? "radiogroup" : "group"} aria-label={q.text}>
                    {q.options.map((o) => {
                        const on = Array.isArray(value) ? value.includes(o.id) : value === o.id;
                        const label = days ? dayShort(o.label) : o.label;
                        return q.type === "single" ? (
                            <button key={o.id} type="button" role="radio" aria-checked={on} aria-label={days ? o.label : undefined}
                                className={`kp-pill${on ? " kp-on" : ""}`} {...toneAttrs(toneOf(q, o.id))} onClick={() => onChange(toggleAnswer(q, value, o.id))}>
                                {!days && <span className="kp-radio" aria-hidden="true" />}{label}
                            </button>
                        ) : (
                            <button key={o.id} type="button" aria-pressed={on} aria-label={days ? o.label : undefined}
                                className={`kp-pill${on ? " kp-on" : ""}`} {...toneAttrs(toneOf(q, o.id))} onClick={() => onChange(toggleAnswer(q, value, o.id))}>
                                {!days && <span className="kp-box" aria-hidden="true" />}{label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/**
 * Where the saving stands, as one small icon with its words in the tooltip: saved (check), saving (turning),
 * unsaved input (dot), paused by a conflict (warning), nothing saved yet (empty circle). No name, no date —
 * who saved when is in the Verlauf.
 */
function SaveState({ saving, dirty, conflict, saved }: { saving: boolean; dirty: boolean; conflict: boolean; saved: boolean }) {
    const t = useT();
    const [state, label, icon] = conflict ? ["paused", t("kader.live.conflict.paused"), <AlertIcon key="i" />]
        : saving ? ["saving", t("kader.interview.saving"), <RefreshIcon key="i" />]
            : dirty ? ["dirty", t("kader.interview.unsaved"), <CircleIcon key="i" />]
                : saved ? ["saved", t("kader.interview.saved"), <CheckIcon key="i" />]
                    : ["none", t("kader.interview.notSaved"), <CircleIcon key="i" />];
    return (
        <span className={`kp-savestate kp-save-${state}`} role="status" data-tip={label}>
            {icon}
            <span className="kp-sr">{label}</span>
        </span>
    );
}

function InterviewPanel({ userId, entry, next, onGo }: { userId: string; entry: KaderEntry; next: string | null; onGo: (userId: string | null) => void }) {
    const t = useT();
    const toast = useToast();
    const { view, kader, players, canWrite, run, refresh } = useKader();
    const name = playerName(view, userId, entry);
    const { draft, change, save: flush, keepMine, takeTheirs, saving, conflict, dirty } = useInterviewDraft({
        kaderId: kader.id, userId, entry, run, refresh,
        onLost: () => toast(t("kader.live.conflict.lost", { name }), "err"),
    });

    const player = players.get(userId);
    const pre = player && player.prefill ? player.prefill : null;
    const iv = entry.interview;
    const done = statusOf(entry) === "done";
    const locked = !canWrite || done;
    useReportFocus("view", { playerId: userId, what: "interview", edit: canWrite && !done });
    const live: KaderEntry = { ...entry, wishes: draft.wishes, interview: { ...iv, answers: draft.answers } };
    const prog = progress(live, kader.questions);
    const complete = prog.done === prog.total;
    const missing = [...(draft.wishes.length ? [] : [t("kader.interview.aWish")]), ...prog.missing.map((q) => q.text)];
    const leads = !draft.lead || kader.leads.includes(draft.lead) ? kader.leads : [...kader.leads, draft.lead];
    const conflictText = (c: InterviewConflict) => t("kader.live.conflict.interview", { name: personName(view, c.by) });

    const finish = async () => {
        if (!(await flush())) return;
        if (await run(completeKaderInterview(kader.id, userId))) {
            toast(t("kader.interview.completedToast", { name }));
            onGo(next);
        }
    };
    const saveNext = async () => {
        if (await flush()) onGo(next);
    };
    const toPool = async () => {
        if (!(await flush())) return;
        if (await run(setKaderState(kader.id, [userId], "pool"))) {
            toast(t("kader.interview.toPoolDone", { name }));
            onGo(next);
        }
    };

    return (
        <section className="kp-panel kp-iv-main" aria-label={t("kader.interview.aria", { name })}>
            <PresenceBanner playerId={userId} what="interview" />
            {conflict && <ConflictBanner text={conflictText(conflict)} onReload={takeTheirs} onOverwrite={() => void keepMine()} />}
            <div className="kp-iv-head">
                <div className="kp-col kp-grow">
                    <h2 className="kp-iv-name"><PlayerName userId={userId} entry={entry} />{done && <DoneBadge />}</h2>
                    <span className="kp-iv-meta">
                        {pre ? <span className="kp-inline">{t("kader.interview.prefilled")} <SpecTag pick={pre} size={18} /> <span className="kp-muted">({pre.name})</span></span> : <span>{t("kader.interview.noPrefill")}</span>}
                        <HistoryButton userId={userId} entry={entry} />
                    </span>
                </div>
                <div className="field kp-leadpick">
                    <span className="field-label">{t("kader.interview.lead")}</span>
                    <LeadMenu label={t("kader.interview.lead")} value={draft.lead} disabled={locked} onChange={(lead) => change({ ...draft, lead })} options={[
                        { value: "", label: t("kader.lead.nobody"), badge: <LeadBadge userId="" /> },
                        ...leads.map((id) => ({ value: id, label: nameOf(view, id), badge: <LeadBadge userId={id} you /> })),
                    ]} />
                </div>
                <span className={`kp-ivchip kp-ivchip-lg ${complete ? "kp-iv-done" : "kp-iv-started"}`}>
                    {complete ? <CheckIcon /> : <ProgressRing done={prog.done} total={prog.total} />}
                    {t("kader.interview.progress", { done: prog.done, total: prog.total })}
                </span>
            </div>
            {done && <p className="kp-lockhint"><CheckIcon />{t("kader.interview.locked")}</p>}
            <fieldset className="kp-iv-body" disabled={locked}>
                <div className="kp-iv-col">
                    <div className="kp-between">
                        <h3>{t("kader.interview.wishes")}</h3>
                        <span className="kp-sub">{t("kader.interview.wishesHint")}</span>
                    </div>
                    <WishEditor wishes={draft.wishes} prefill={pre} locked={locked} onChange={(wishes) => change({ ...draft, wishes })} />
                    <label className="kp-notefield">
                        <h3>{t("kader.interview.note")}</h3>
                        <textarea rows={4} maxLength={2000} value={draft.note} placeholder={t("kader.interview.notePlaceholder")} onChange={(e) => change({ ...draft, note: e.target.value })} />
                    </label>
                </div>
                <div className="kp-iv-col">
                    <div className="kp-between">
                        <h3>{t("kader.interview.questions")}</h3>
                        {canWrite && <Link className="kp-link" to={`/kader/${kader.id}/fragen`}>{t("kader.interview.editQuestions")}</Link>}
                    </div>
                    {kader.questions.length === 0 && <p className="kp-hint">{t("kader.interview.noQuestions")}</p>}
                    {kader.questions.map((q) => (
                        <QuestionField key={q.id} q={q} value={draft.answers[q.id]} onChange={(value) => change({ ...draft, answers: { ...draft.answers, [q.id]: value } })} />
                    ))}
                </div>
            </fieldset>
            <div className="kp-iv-foot">
                {/* the save state and what is still open (a count, the list in the tooltip) in a slot of fixed width: the
                    buttons stay where they are when the count goes */}
                {canWrite && (
                    <span className="kp-iv-foot-state">
                        <SaveState saving={saving} dirty={dirty} conflict={!!conflict} saved={!!iv.updatedAt} />
                        {!done && !complete && (
                            <span className="kp-missing kp-warntext" data-tip={t("kader.interview.missingTip", { list: missing.join(", ") })}>
                                <AlertIcon />{t("kader.interview.missingN", { count: missing.length })}
                                <span className="kp-sr">{t("kader.interview.missingTip", { list: missing.join(", ") })}</span>
                            </span>
                        )}
                    </span>
                )}
                {canWrite && entry.state === "selected" && <BackButton label={t("kader.interview.toPool")} onClick={() => void toPool()} />}
                {/* the way on stays on the right, also when the row wraps */}
                <span className="kp-iv-foot-act">
                    {canWrite && done && <Button variant="ghost" icon={<EditIcon />} onClick={() => void run(reopenKaderInterview(kader.id, userId))}>{t("kader.interview.reopen")}</Button>}
                    {canWrite && !done && (
                        <>
                            <Button variant="ghost" icon={<SaveIcon />} onClick={() => void saveNext()}>{next ? t("kader.interview.saveNext") : t("common.save")}</Button>
                            <Button icon={<CheckIcon />} disabled={!complete} onClick={() => void finish()}>{t("kader.interview.complete")}</Button>
                        </>
                    )}
                </span>
            </div>
        </section>
    );
}

export default function InterviewsView() {
    const t = useT();
    const { view, kader, me } = useKader();
    const [params, setParams] = useSearchParams();
    const [shown, setShown] = usePersistedState<Shown>("kader-interview-list", "open");
    const [leadPicks, setLeadPicks] = usePersistedState<Record<string, string>>("kader-interview-lead", {});

    const rows = useMemo(() => Object.entries(kader.players)
        .filter(([, e]) => e.state === "selected")
        .sort(([a, ea], [b, eb]) => (ORDER[statusOf(ea)] - ORDER[statusOf(eb)]) || playerName(view, a, ea).localeCompare(playerName(view, b, eb))), [view, kader]);
    const doneCount = rows.filter(([, e]) => statusOf(e) === "done").length;
    const interviewers = useMemo(() => interviewersOf(kader, rows.map(([, e]) => e)), [kader, rows]);
    const leadPick = cleanLeadPick(leadPicks[kader.id], interviewers);
    const inSegment = rows.filter(([, e]) => shown === "all" || (shown === "done") === (statusOf(e) === "done"));
    const list = inSegment.filter(([, e]) => leadMatches(e, leadPick, me));
    const leadCount = (pick: string) => inSegment.filter(([, e]) => leadMatches(e, pick, me)).length;
    const leadOptions: LeadOption[] = [
        { value: LEAD_ALL, label: t("kader.lead.all"), badge: <span className="kp-lead-name">{t("kader.lead.all")}</span>, count: leadCount(LEAD_ALL) },
        ...(kader.leads.includes(me) ? [{ value: LEAD_ME, label: t("kader.lead.me"), badge: <LeadBadge userId={me} label={t("kader.lead.me")} />, count: leadCount(LEAD_ME) }] : []),
        ...interviewers.filter((id) => id !== me).map((id) => ({ value: id, label: nameOf(view, id), badge: <LeadBadge userId={id} />, count: leadCount(id) })),
        { value: LEAD_NONE, label: t("kader.lead.nobody"), badge: <LeadBadge userId="" />, count: leadCount(LEAD_NONE) },
    ];
    const wanted = params.get("spieler") || "";
    const currentId = wanted && kader.players[wanted] ? wanted : (list[0] ? list[0][0] : "");
    const entry = currentId ? kader.players[currentId] : null;
    const index = list.findIndex(([id]) => id === currentId);
    const next = index >= 0 && list[index + 1] ? list[index + 1][0] : null;
    const go = (id: string | null) => setParams(id ? { spieler: id } : {}, { replace: true });

    return (
        <div className="kp-view">
            <SelectionTabs sub="vorauswahl">
                <span className="kp-grow" />
                <Link to={`/kader/${kader.id}/fragen`} className={buttonClass("ghost", "md", true, "kp-qlink")}>
                    <BookIcon />{t("kader.interview.questionsLink")}<Count n={kader.questions.length} tip={t("kader.questions.countN", { n: kader.questions.length })} />
                </Link>
            </SelectionTabs>
            <div className="kp-iv">
                <section className="kp-panel kp-iv-list" aria-label={t("kader.interview.listTitle")}>
                    <div className="kp-listhead">
                        <h2>{t("kader.interview.listTitle")}</h2>
                        <Count n={rows.length} tip={t("kader.nav.count.selected", { count: rows.length })} />
                    </div>
                    <Segment<Shown> size="sm" ariaLabel={t("kader.interview.listAria")} value={shown} onChange={setShown} options={[
                        { value: "open", label: t("kader.interview.listOpen", { n: rows.length - doneCount }), icon: <CircleIcon />, tip: t("kader.interview.listOpenTip", { count: rows.length - doneCount }) },
                        { value: "done", label: t("kader.interview.listDone", { n: doneCount }), icon: <CheckIcon />, tip: t("kader.interview.listDoneTip", { count: doneCount }) },
                        { value: "all", label: t("kader.interview.listAll") },
                    ]} />
                    <LeadMenu label={t("kader.interview.lead")} prefix={t("kader.interview.lead")} value={leadPick} options={leadOptions} className="kp-leadfilter"
                        onChange={(pick) => setLeadPicks({ ...leadPicks, [kader.id]: pick })} />
                    <div className="kp-ivrows">
                        {list.length === 0 && <EmptyState icon={shown === "done" ? <CheckIcon /> : <ListChecksIcon />} text={rows.length ? t(leadPick === LEAD_ALL ? "kader.interview.listEmpty" : "kader.interview.listEmptyLead") : t("kader.interview.nobodySelected")} />}
                        {list.map(([id, e]) => <ListRow key={id} userId={id} entry={e} current={id === currentId} onPick={() => go(id)} />)}
                    </div>
                </section>
                {entry ? <InterviewPanel key={currentId} userId={currentId} entry={entry} next={next} onGo={go} /> : (
                    <section className="kp-panel kp-iv-main kp-iv-empty">
                        <EmptyState icon={<ListChecksIcon />} text={rows.length ? t("kader.interview.pick") : t("kader.interview.empty")}>
                            {!rows.length && <Link className={buttonClass("primary")} to={`/kader/${kader.id}/pool`}>{t("kader.interview.toPoolPage")}</Link>}
                        </EmptyState>
                    </section>
                )}
            </div>
        </div>
    );
}
