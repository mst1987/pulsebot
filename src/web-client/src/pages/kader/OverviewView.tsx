// Step 2 · Vorauswahl · Übersicht (/kader/<id>/uebersicht): everybody in the
// Vorauswahl side by side — the first two wishes, one column per question of
// this Kader, where the interview stands and how long they have been waiting.
// Filter menus for the interview, the first wish and every question; grouped by
// role, class or interview. Every column head sorts (inside each group), the
// order is remembered. A name shows the whole interview on hover. Marked rows
// go on at once: into the provisional roster, or back into the pool.
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { setKaderState, type KaderClassDef, type KaderEntry, type KaderQuestion, type KaderRole, type KaderState } from "../../api";
import { Button, Segment } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { HoverPanel } from "../../components/HoverPanel";
import { HourglassIcon, ListChecksIcon, SearchIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { useT } from "../../i18n";
import { usePersistedState } from "../../lib/persistedState";
import { useTableSort } from "../../lib/tableSort";
import { rolePluralLabel } from "../../lib/wowNames";
import { className, dayOf, daysSince, nameOf, playerName, ROLES, roleCounts, searchText, specRole } from "../../lib/kader/model";
import { answerLabels, isAnswered, isWeekdays, statusOf, type InterviewStatus } from "../../lib/kader/interview";
import { overviewParts, overviewSortDefaults, sortTable } from "../../lib/kader/sort";
import { toneOf } from "../../lib/kader/colors";
import { cleanState, passes, type FilterDef, type FilterOption, type FilterState } from "../../lib/kader/filters";
import { FilterChips, FilterMenus } from "./FilterMenus";
import { BatchBar } from "./BatchBar";
import {
    AnswerChips, AnswerLines, BackButton, ClassIcon, Count, DaySquares, DoneBadge, EmptyState, HistoryLines, InterviewChip, PlayerName, RoleIcon, SelectionTabs, SortHead, SpecTag,
    TableNote, WishLines,
} from "./parts";
import { useKader } from "./kaderContext";
import { LeadAvatar, LeadBadge } from "./Leads";
import { PresenceMark } from "./Presence";
import { interviewersOf } from "../../lib/kader/leads";

type GroupBy = "role" | "class" | "interview" | "lead" | "none";
type Row = { userId: string; entry: KaderEntry };
type Group = { key: string; title: string; icon: ReactNode; rows: Row[] };
const NONE = "-";
const STATUSES: InterviewStatus[] = ["started", "open", "done"];

/** The role of a row's first wish (null without one). */
const firstRole = (classes: KaderClassDef[], row: Row): KaderRole | null => (row.entry.wishes[0] ? specRole(classes, row.entry.wishes[0].spec) : null);

/** The whole interview beside a name: wishes, answers, the note, the last steps. */
function Peek({ row }: { row: Row }) {
    const t = useT();
    const { view, kader } = useKader();
    const { userId, entry } = row;
    const iv = entry.interview;
    const name = playerName(view, userId, entry);
    return (
        <HoverPanel className="kp-plain" trigger={<PlayerName userId={userId} entry={entry} className="kp-rowname" />} head={name} width={360}>
            <div className="kp-peek">
                <span className="kp-leadline">
                    <LeadBadge userId={iv.lead} />
                    {iv.startedAt && <span className="kp-sub">{t("kader.interview.subStarted", { date: dayOf(iv.startedAt) })}</span>}
                </span>
                <WishLines wishes={entry.wishes} />
                {kader.questions.length > 0 && <div className="kp-peek-rule" />}
                <AnswerLines entry={entry} questions={kader.questions} />
                {iv.note && <p className="kp-quote">{t("kader.quote", { text: iv.note })}</p>}
                <HistoryLines entry={entry} limit={3} />
            </div>
        </HoverPanel>
    );
}

function AnswerCell({ q, entry }: { q: KaderQuestion; entry: KaderEntry }) {
    const value = entry.interview.answers[q.id];
    if (isWeekdays(q)) return <span role="cell"><DaySquares question={q} value={value} /></span>;
    const labels = answerLabels(q, value);
    if (!labels.length) return <span role="cell" className="kp-muted">—</span>;
    const text = labels.join(" · ");
    // a choice as coloured chips, free text as text; the whole answer in the tooltip
    if (q.type === "text") return <span role="cell" className="kp-ellipsis" data-tip={text}>{text}</span>;
    return <span role="cell" className="kp-cell-answer" data-tip={text}><AnswerChips question={q} value={value} nowrap /></span>;
}

function OverviewRow({ row, marked, onMark }: { row: Row; marked: boolean; onMark: (on: boolean) => void }) {
    const t = useT();
    const { view, kader, canWrite } = useKader();
    const { userId, entry } = row;
    const [w1, w2] = entry.wishes;
    const iv = entry.interview;
    const days = daysSince(entry.since);
    const status = statusOf(entry);
    const leadDetail = status === "done" ? `${t("kader.interview.status.done")} ${dayOf(iv.completedAt)}` : "";
    return (
        <div className={`kp-trow kp-ov-grid${marked ? " kp-marked" : ""}`} role="row">
            <span role="cell" className="kp-cell-mark">
                <input type="checkbox" checked={marked} disabled={!canWrite} aria-label={t("kader.batch.mark", { name: playerName(view, userId, entry) })} onChange={(e) => onMark(e.target.checked)} />
            </span>
            <span role="cell" className="kp-cell-name kp-namerowcell"><Peek row={row} />{status === "done" && <DoneBadge />}<PresenceMark playerId={userId} /></span>
            <span role="cell" className="kp-cell-char">{w1 ? <SpecTag pick={w1} size={22} /> : <span className="kp-muted">—</span>}</span>
            <span role="cell" className="kp-cell-char">{w2 ? <SpecTag pick={w2} size={20} className="kp-small" /> : <span className="kp-muted">—</span>}</span>
            {kader.questions.map((q) => <AnswerCell key={q.id} q={q} entry={entry} />)}
            <span role="cell" className="kp-col">
                <InterviewChip entry={entry} />
                <LeadBadge userId={iv.lead} detail={leadDetail} />
            </span>
            <span role="cell" className="kp-mono kp-muted" data-tip={days === null ? undefined : t("kader.overview.daysTip", { count: days, date: dayOf(entry.since) })}>{days === null ? "—" : t("kader.overview.days", { n: days })}</span>
        </div>
    );
}

export default function OverviewView() {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { view, kader, players, canWrite, run } = useKader();
    const [q, setQ] = useState("");
    const [groupBy, setGroupBy] = usePersistedState<GroupBy>("kader-overview-group", "role");
    const [rawFilters, setFilters] = usePersistedState<FilterState>("kader-overview-filters", {});
    const [marked, setMarked] = useState<string[]>([]);
    const sort = useTableSort<string>("kader-overview-sort", overviewSortDefaults(kader.questions), "name");

    const rows: Row[] = useMemo(() => Object.entries(kader.players)
        .filter(([, e]) => e.state === "selected")
        .map(([userId, entry]) => ({ userId, entry })), [kader]);

    const interviewers = useMemo(() => interviewersOf(kader, rows.map((r) => r.entry)), [kader, rows]);

    const defs = useMemo<FilterDef<Row>[]>(() => {
        const out: FilterDef<Row>[] = [
            {
                key: "interview", label: t("kader.overview.filterInterview"),
                options: STATUSES.map((s) => ({ value: s, label: t(`kader.interview.status.${s}`), test: (r: Row) => statusOf(r.entry) === s })),
            },
            {
                key: "lead", label: t("kader.overview.filterLead"),
                options: [
                    ...interviewers.map((id) => ({ value: id, label: nameOf(view, id), lead: id, test: (r: Row) => r.entry.interview.lead === id })),
                    { value: NONE, label: t("kader.lead.nobodyLong"), lead: "", test: (r: Row) => !r.entry.interview.lead },
                ],
            },
            {
                key: "wish", label: t("kader.overview.filterWish"),
                options: [
                    ...ROLES.map((role) => ({ value: role, label: rolePluralLabel(role), icon: { kind: "role" as const, key: role }, test: (r: Row) => firstRole(view.classes, r) === role })),
                    { value: NONE, label: t("kader.overview.noWish"), test: (r: Row) => !r.entry.wishes.length },
                ],
            },
        ];
        for (const question of kader.questions) {
            const options: FilterOption<Row>[] = question.type === "text"
                ? [{ value: "yes", label: t("kader.overview.answered"), test: (r: Row) => isAnswered(question, r.entry.interview.answers[question.id]) }]
                : question.options.map((o) => ({
                    value: o.id, label: o.label, tone: toneOf(question, o.id),
                    test: (r: Row) => {
                        const v = r.entry.interview.answers[question.id];
                        return Array.isArray(v) ? v.includes(o.id) : v === o.id;
                    },
                }));
            options.push({ value: NONE, label: t("kader.overview.unanswered"), test: (r: Row) => !isAnswered(question, r.entry.interview.answers[question.id]) });
            out.push({ key: `q-${question.id}`, label: question.text, options });
        }
        return out;
    }, [kader.questions, view, interviewers, t]);
    const filters = cleanState(defs, rawFilters);

    const needle = q.trim().toLowerCase();
    // sorted first, grouped after: the order holds inside every group
    const shown = sortTable(
        rows.filter((r) => passes(r, defs, filters) && (!needle || searchText(view, r.userId, r.entry).includes(needle))),
        (r) => playerName(view, r.userId, r.entry),
        overviewParts({ view, kader, players }, sort.sort),
        sort.dir,
    );
    const mix = roleCounts(view.classes, shown.map((r) => r.entry.wishes[0] || null));

    const groups: Group[] = (() => {
        if (groupBy === "none") return [{ key: "all", title: "", icon: null, rows: shown }];
        if (groupBy === "interview") {
            return STATUSES.map((s) => ({ key: s, title: t(`kader.interview.status.${s}`), icon: null, rows: shown.filter((r) => statusOf(r.entry) === s) }));
        }
        if (groupBy === "lead") {
            const out: Group[] = interviewers.map((id) => ({
                key: id, title: nameOf(view, id), icon: <LeadAvatar userId={id} size={20} />, rows: shown.filter((r) => r.entry.interview.lead === id),
            }));
            out.push({ key: NONE, title: t("kader.lead.nobodyLong"), icon: <LeadAvatar userId="" size={20} />, rows: shown.filter((r) => !r.entry.interview.lead) });
            return out;
        }
        if (groupBy === "class") {
            const out: Group[] = view.classes.map((c) => ({
                key: c.key, title: className(view.classes, c.key), icon: <ClassIcon classKey={c.key} size={18} />,
                rows: shown.filter((r) => r.entry.wishes[0] && r.entry.wishes[0].className === c.key),
            }));
            out.push({ key: NONE, title: t("kader.overview.noWish"), icon: null, rows: shown.filter((r) => !r.entry.wishes.length) });
            return out;
        }
        const out: Group[] = ROLES.map((role) => ({ key: role, title: rolePluralLabel(role), icon: <RoleIcon role={role} size={18} />, rows: shown.filter((r) => firstRole(view.classes, r) === role) }));
        out.push({ key: NONE, title: t("kader.overview.noWish"), icon: null, rows: shown.filter((r) => !firstRole(view.classes, r)) });
        return out;
    })();

    const markedRows = rows.filter((r) => marked.includes(r.userId));
    const move = async (to: KaderState) => {
        const ids = markedRows.map((r) => r.userId);
        if (!ids.length) return;
        const open = markedRows.filter((r) => statusOf(r.entry) !== "done").length;
        if (to === "provisional" && open && !(await ask({ title: t("kader.overview.openTitle", { n: open }), text: t("kader.overview.openText"), action: t("kader.overview.toProvisional") }))) return;
        if (await run(setKaderState(kader.id, ids, to))) {
            setMarked([]);
            toast(t(to === "provisional" ? "kader.overview.movedOn" : "kader.overview.movedBack", { n: ids.length }));
        }
    };
    const toggleAll = (on: boolean) => setMarked(on ? shown.map((r) => r.userId) : []);
    // one column per question (seven day squares need 112 px); the smallest widths of kader.css
    // (.kp-ov-grid) plus the gaps give the table's least width
    const qmin = kader.questions.map((question) => (isWeekdays(question) ? 112 : 88));
    const qcols = qmin.map((w) => `minmax(${w}px, 1fr)`).join(" ");
    const minw = 22 + 130 + 160 + 110 + 116 + 56 + 12 * 5 + 28 + qmin.reduce((sum, w) => sum + w + 12, 0);

    return (
        <div className="kp-view">
            <SelectionTabs sub="uebersicht">
                <span className="kp-grow" />
                <span className="kp-groupby">
                    <span className="kicker">{t("kader.overview.group")}</span>
                    <Segment<GroupBy> size="sm" ariaLabel={t("kader.overview.group")} value={groupBy} onChange={setGroupBy} options={[
                        { value: "role", label: t("kader.overview.byRole") },
                        { value: "class", label: t("kader.overview.byClass") },
                        { value: "interview", label: t("kader.overview.byInterview") },
                        { value: "lead", label: t("kader.overview.byInterviewer") },
                        { value: "none", label: t("kader.overview.byNone") },
                    ]} />
                </span>
            </SelectionTabs>
            <FilterMenus items={rows} defs={defs} state={filters} onChange={setFilters}>
                <label className="kp-search">
                    <SearchIcon />
                    <input type="search" aria-label={t("kader.overview.search")} placeholder={t("kader.overview.search")} value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
            </FilterMenus>
            <div className="kp-countrow">
                <span className="kp-muted"><b className="kp-mono kp-big-n">{shown.length}</b> {t("kader.pool.ofTotal", { count: rows.length })}</span>
                <FilterChips defs={defs} state={filters} onChange={setFilters} />
                <span className="kp-grow" />
                <span className="kicker">{t("kader.overview.firstWish")}</span>
                <span className="kp-rolemix">
                    {ROLES.map((r) => <span key={r} data-tip={t("kader.roleCount", { role: rolePluralLabel(r), n: mix[r] })}><RoleIcon role={r} size={16} /><b className="kp-mono">{mix[r]}</b></span>)}
                </span>
            </div>
            <div className="kp-panel kp-table kp-scroll-x" role="table" aria-label={t("kader.overview.tableLabel", { name: kader.name })}
                style={{ "--qcols": qcols, "--minw": `${minw}px` } as CSSProperties}>
                <div className="kp-trow kp-thead kp-ov-grid" role="row">
                    <span role="columnheader" className="kp-cell-mark">
                        <input type="checkbox" aria-label={t("kader.batch.markAll")} disabled={!canWrite || !shown.length}
                            checked={shown.length > 0 && shown.every((r) => marked.includes(r.userId))} onChange={(e) => toggleAll(e.target.checked)} />
                    </span>
                    <SortHead sortKey="name" label={t("kader.pool.colPlayer")} sort={sort} />
                    <SortHead sortKey="wish1" label={t("kader.overview.colWish1")} sort={sort} tip={t("kader.overview.colWish1")} tipSub={t("kader.sort.wishSub")} />
                    <SortHead sortKey="wish2" label={t("kader.overview.colWish2")} sort={sort} tip={t("kader.overview.colWish2")} tipSub={t("kader.sort.wishSub")} />
                    {kader.questions.map((question) => (
                        <SortHead key={question.id} sortKey={`q-${question.id}`} label={question.text} sort={sort} tip={question.text} tipSub={t(`kader.sort.answer.${question.type}`)} />
                    ))}
                    <SortHead sortKey="interview" label={t("kader.overview.colInterview")} sort={sort} tip={t("kader.overview.colInterview")} tipSub={t("kader.sort.interviewSub")} />
                    <SortHead sortKey="since" label={t("kader.overview.colSince")} sort={sort} tip={t("kader.overview.colSince")} tipSub={t("kader.sort.sinceSub")} />
                </div>
                {shown.length === 0 && (
                    <TableNote>{rows.length ? <EmptyState icon={<SearchIcon />} text={t("kader.pool.none")} /> : <EmptyState icon={<ListChecksIcon />} text={t("kader.overview.empty")} />}</TableNote>
                )}
                {groups.filter((g) => g.rows.length).map((g) => (
                    <div key={g.key} className="kp-ogroup" role="rowgroup">
                        {groupBy !== "none" && (
                            <div role="row">
                                <div role="cell" className="kp-ghead">
                                    {g.icon}
                                    <span className="kp-gtitle">{g.title}</span>
                                    <Count n={g.rows.length} tip={t("kader.playersN", { count: g.rows.length })} />
                                    <span className="kp-rule" />
                                    <span className="kp-sub">{t("kader.overview.doneOf", { done: g.rows.filter((r) => statusOf(r.entry) === "done").length, n: g.rows.length })}</span>
                                </div>
                            </div>
                        )}
                        {g.rows.map((r) => (
                            <OverviewRow key={r.userId} row={r} marked={marked.includes(r.userId)}
                                onMark={(on) => setMarked(on ? [...marked, r.userId] : marked.filter((id) => id !== r.userId))} />
                        ))}
                    </div>
                ))}
            </div>
            <BatchBar count={markedRows.length} onClear={() => setMarked([])}>
                <Button size="sm" icon={<HourglassIcon />} onClick={() => void move("provisional")}>{t("kader.overview.toProvisional")}</Button>
                <BackButton size="sm" label={t("kader.overview.toPool")} onClick={() => void move("pool")} />
            </BatchBar>
        </div>
    );
}
