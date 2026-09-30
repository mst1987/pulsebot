// Step 2 · Vorauswahl · Übersicht (/kader/<id>/uebersicht): everybody in the
// Vorauswahl side by side — the first two wishes, one column per question of
// this Kader, where the interview stands and how long they have been waiting.
// Filter menus for the interview, the first wish and every question; grouped by
// role, class or interview. A name shows the whole interview on hover. Marked
// rows go on at once: into the provisional roster, or back into the pool.
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { setKaderState, type KaderClassDef, type KaderEntry, type KaderQuestion, type KaderRole, type KaderState } from "../../api";
import { Button, Segment } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { HoverPanel } from "../../components/HoverPanel";
import { SearchIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { useT } from "../../i18n";
import { usePersistedState } from "../../lib/persistedState";
import { rolePluralLabel } from "../../lib/wowNames";
import { className, dayOf, daysSince, nameOf, playerName, ROLES, roleCounts, searchText, specRole } from "../../lib/kader/model";
import { answerLabels, isAnswered, isWeekdays, statusOf, type InterviewStatus } from "../../lib/kader/interview";
import { cleanState, passes, type FilterDef, type FilterOption, type FilterState } from "../../lib/kader/filters";
import { FilterChips, FilterMenus } from "./FilterMenus";
import { BatchBar } from "./BatchBar";
import { AnswerLines, ClassIcon, DaySquares, HistoryLines, InterviewChip, PickIcon, PickLabel, PlayerName, RoleIcon, SelectionTabs, WishLines } from "./parts";
import { useKader } from "./kaderContext";

type GroupBy = "role" | "class" | "interview" | "none";
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
    const by = iv.lead ? t("kader.overview.byLead", { lead: nameOf(view, iv.lead), date: dayOf(iv.startedAt) || "—" }) : t("kader.interview.subNobody");
    return (
        <HoverPanel className="kp-plain" trigger={<PlayerName userId={userId} entry={entry} className="kp-rowname" />} head={name} width={360}>
            <div className="kp-peek">
                <span className="kp-sub">{by}</span>
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
    if (isWeekdays(q)) return <span><DaySquares question={q} value={value} /></span>;
    const labels = answerLabels(q, value);
    if (!labels.length) return <span className="kp-muted">—</span>;
    const text = labels.join(" · ");
    return <span className="kp-ellipsis" data-tip={text}>{text}</span>;
}

function OverviewRow({ row, marked, onMark }: { row: Row; marked: boolean; onMark: (on: boolean) => void }) {
    const t = useT();
    const { view, kader, canWrite } = useKader();
    const { userId, entry } = row;
    const [w1, w2] = entry.wishes;
    const iv = entry.interview;
    const days = daysSince(entry.since);
    const status = statusOf(entry);
    const leadLine = iv.lead ? `${nameOf(view, iv.lead)}${status === "done" ? ` · ${dayOf(iv.completedAt)}` : ""}` : t("kader.interview.nobody");
    return (
        <div className={`kp-trow kp-ov-grid${marked ? " kp-marked" : ""}`}>
            <input type="checkbox" checked={marked} disabled={!canWrite} aria-label={t("kader.batch.mark", { name: playerName(view, userId, entry) })} onChange={(e) => onMark(e.target.checked)} />
            <span className="kp-cell-name"><Peek row={row} /></span>
            <span className="kp-cell-char">
                <PickIcon pick={w1} size={22} />
                {w1 ? <PickLabel pick={w1} className="kp-ellipsis" /> : <span className="kp-muted">—</span>}
            </span>
            <span className="kp-cell-char">{w2 ? <PickLabel pick={w2} className="kp-ellipsis kp-small" /> : <span className="kp-muted">—</span>}</span>
            {kader.questions.map((q) => <AnswerCell key={q.id} q={q} entry={entry} />)}
            <span className="kp-col">
                <InterviewChip entry={entry} />
                <span className="kp-sub">{leadLine}</span>
            </span>
            <span className="kp-mono kp-muted" data-tip={dayOf(entry.since)}>{days === null ? "—" : t("kader.overview.days", { n: days })}</span>
        </div>
    );
}

export default function OverviewView() {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { view, kader, canWrite, run } = useKader();
    const [q, setQ] = useState("");
    const [groupBy, setGroupBy] = usePersistedState<GroupBy>("kader-overview-group", "role");
    const [rawFilters, setFilters] = usePersistedState<FilterState>("kader-overview-filters", {});
    const [marked, setMarked] = useState<string[]>([]);

    const rows: Row[] = useMemo(() => Object.entries(kader.players)
        .filter(([, e]) => e.state === "selected")
        .map(([userId, entry]) => ({ userId, entry }))
        .sort((a, b) => playerName(view, a.userId, a.entry).localeCompare(playerName(view, b.userId, b.entry))), [view, kader]);

    const defs = useMemo<FilterDef<Row>[]>(() => {
        const out: FilterDef<Row>[] = [
            {
                key: "interview", label: t("kader.overview.filterInterview"),
                options: STATUSES.map((s) => ({ value: s, label: t(`kader.interview.status.${s}`), test: (r: Row) => statusOf(r.entry) === s })),
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
                    value: o.id, label: o.label,
                    test: (r: Row) => {
                        const v = r.entry.interview.answers[question.id];
                        return Array.isArray(v) ? v.includes(o.id) : v === o.id;
                    },
                }));
            options.push({ value: NONE, label: t("kader.overview.unanswered"), test: (r: Row) => !isAnswered(question, r.entry.interview.answers[question.id]) });
            out.push({ key: `q-${question.id}`, label: question.text, options });
        }
        return out;
    }, [kader.questions, view.classes, t]);
    const filters = cleanState(defs, rawFilters);

    const needle = q.trim().toLowerCase();
    const shown = rows.filter((r) => passes(r, defs, filters) && (!needle || searchText(view, r.userId, r.entry).includes(needle)));
    const mix = roleCounts(view.classes, shown.map((r) => r.entry.wishes[0] || null));

    const groups: Group[] = (() => {
        if (groupBy === "none") return [{ key: "all", title: "", icon: null, rows: shown }];
        if (groupBy === "interview") {
            return STATUSES.map((s) => ({ key: s, title: t(`kader.interview.status.${s}`), icon: null, rows: shown.filter((r) => statusOf(r.entry) === s) }));
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
    // one column per question; the smallest widths of kader.css (.kp-ov-grid) plus the gaps give the table's least width
    const n = kader.questions.length;
    const qcols = n ? `repeat(${n}, minmax(88px, 1fr))` : "";
    const minw = 22 + 130 + 160 + 110 + 116 + 48 + 12 * 5 + 28 + n * (88 + 12);

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
                <span className="kp-muted"><b className="kp-mono">{shown.length}</b> {t("kader.pool.ofTotal", { total: rows.length })}</span>
                <FilterChips defs={defs} state={filters} onChange={setFilters} />
                <span className="kp-grow" />
                <span className="kicker">{t("kader.overview.firstWish")}</span>
                <span className="kp-rolemix">
                    {ROLES.map((r) => <span key={r} data-tip={rolePluralLabel(r)}><RoleIcon role={r} size={16} /><b className="kp-mono">{mix[r]}</b></span>)}
                </span>
            </div>
            <div className="kp-panel kp-table kp-scroll-x" style={{ "--qcols": qcols, "--minw": `${minw}px` } as CSSProperties}>
                <div className="kp-trow kp-thead kp-ov-grid">
                    <input type="checkbox" aria-label={t("kader.batch.markAll")} disabled={!canWrite || !shown.length}
                        checked={shown.length > 0 && shown.every((r) => marked.includes(r.userId))} onChange={(e) => toggleAll(e.target.checked)} />
                    <span className="kicker">{t("kader.pool.colPlayer")}</span>
                    <span className="kicker">{t("kader.overview.colWish1")}</span>
                    <span className="kicker">{t("kader.overview.colWish2")}</span>
                    {kader.questions.map((question) => <span key={question.id} className="kicker kp-ellipsis" data-tip={question.text}>{question.text}</span>)}
                    <span className="kicker">{t("kader.overview.colInterview")}</span>
                    <span className="kicker">{t("kader.overview.colSince")}</span>
                </div>
                {shown.length === 0 && <div className="kp-empty">{rows.length ? t("kader.pool.none") : t("kader.overview.empty")}</div>}
                {groups.filter((g) => g.rows.length).map((g) => (
                    <div key={g.key} className="kp-ogroup">
                        {groupBy !== "none" && (
                            <div className="kp-ghead">
                                {g.icon}
                                <span className="kp-gtitle">{g.title}</span>
                                <span className="kp-mono kp-muted">{g.rows.length}</span>
                                <span className="kp-rule" />
                                <span className="kp-sub">{t("kader.overview.doneOf", { done: g.rows.filter((r) => statusOf(r.entry) === "done").length, n: g.rows.length })}</span>
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
                <Button size="sm" onClick={() => void move("provisional")}>{t("kader.overview.toProvisional")}</Button>
                <Button size="sm" variant="ghost" onClick={() => void move("pool")}>{t("kader.overview.toPool")}</Button>
            </BatchBar>
        </div>
    );
}
