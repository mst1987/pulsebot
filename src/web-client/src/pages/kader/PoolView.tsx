// Step 1 · Pool (/kader/<id>/pool): everybody taken into this Kader, with the
// character they are prefilled with (spec icon plus class, where it comes from),
// their Discord roles and their attendance over the raid categories the Kader
// counts (picked in the head of that column, Attendance.tsx). Every column
// head sorts, the order is remembered. Per player the switch "Zur Auswahl"
// moves them between pool and Vorauswahl; somebody further along shows their
// state instead. Marked rows go at once. New players come from Discord roles
// (ImportModal) or by id.
import { useMemo, useState } from "react";
import { removeKaderPlayers, setKaderState, type KaderEntry, type KaderState } from "../../api";
import { Button, Segment } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { useToast } from "../../components/Jobs";
import { HoverPanel } from "../../components/HoverPanel";
import { ListChecksIcon, PlusIcon, RecruitmentIcon, RosterIcon, SearchIcon, TrashIcon } from "../../components/icons";
import { useT } from "../../i18n";
import { usePersistedState } from "../../lib/persistedState";
import { useTableSort } from "../../lib/tableSort";
import { className, dayOf, mainPick, playerName, rolesOf, searchText } from "../../lib/kader/model";
import { POOL_SORT, poolParts, sortTable, type PoolSortKey } from "../../lib/kader/sort";
import { cleanState, passes, type FilterDef, type FilterState } from "../../lib/kader/filters";
import { FilterChips, FilterMenus } from "./FilterMenus";
import { BatchBar } from "./BatchBar";
import { AttendanceSource, AttendanceValue } from "./Attendance";
import { BackButton, EmptyState, PlayerName, SinceText, SortHead, SourceBadge, SpecTag, StateBadge, Switch, TableNote } from "./parts";
import { useKader } from "./kaderContext";

type Scope = "all" | "pool" | "selected";
type Row = { userId: string; entry: KaderEntry };
const NO_CLASS = "-";

/** The peek beside a name: the account's characters, attendance, since when in the Kader. */
function PlayerPeek({ userId, entry }: Row) {
    const t = useT();
    const { view, players } = useKader();
    const p = players.get(userId);
    return (
        <HoverPanel className="kp-plain" trigger={<PlayerName userId={userId} entry={entry} className="kp-rowname" />} head={t("kader.pool.peekHead", { name: playerName(view, userId, entry) })} width={320}>
            <div className="kp-peek">
                {p && p.characters.length ? p.characters.map((c) => (
                    <div key={c.id} className="kp-peek-char">
                        <SpecTag pick={{ className: c.className, spec: c.mainSpec || "" }} />
                        <span className="kp-sub">{c.name}{c.id === p.activeCharacterId ? ` · ${t("kader.pool.main")}` : ""}</span>
                    </div>
                )) : p && p.prefill ? (
                    <div className="kp-peek-char">
                        <SpecTag pick={p.prefill} />
                        <span className="kp-sub">{p.prefill.name}</span>
                    </div>
                ) : <span className="kp-hint">{t("kader.pool.noChars")}</span>}
                <div className="kp-peek-rule" />
                <div className="kp-between"><span className="kp-muted">{t("kader.pool.attendance")}</span><AttendanceValue userId={userId} /></div>
                <div className="kp-between"><span className="kp-muted">{t("kader.pool.inKaderSince")}</span><span>{dayOf(entry.addedAt) || "—"}</span></div>
                <div className="kp-sub"><StateBadge state={entry.state} /> <SinceText entry={entry} /></div>
            </div>
        </HoverPanel>
    );
}

function PoolRow({ row, marked, onMark }: { row: Row; marked: boolean; onMark: (on: boolean) => void }) {
    const t = useT();
    const { view, kader, players, canWrite, run } = useKader();
    const { userId, entry } = row;
    const p = players.get(userId);
    const pick = p && p.prefill ? { className: p.prefill.className, spec: p.prefill.spec } : null;
    const roles = rolesOf(view, p);
    const name = playerName(view, userId, entry);
    return (
        <div className={`kp-trow kp-pool-grid${marked ? " kp-marked" : ""}`} role="row">
            <span role="cell" className="kp-cell-mark">
                <input type="checkbox" checked={marked} disabled={!canWrite} aria-label={t("kader.batch.mark", { name })} onChange={(e) => onMark(e.target.checked)} />
            </span>
            <span role="cell" className="kp-cell-name">
                <PlayerPeek userId={userId} entry={entry} />
                {p && !p.onServer && <span className="kp-sub">{t("kader.pool.notOnServer")}</span>}
            </span>
            <span role="cell" className="kp-cell-stack">
                <span className="kp-cell-char">
                    {pick ? <SpecTag pick={pick} size={22} /> : <span className="kp-warntext">{t("kader.pool.noData")}</span>}
                    <SourceBadge prefill={p ? p.prefill : null} />
                </span>
                {p && p.prefill && <span className="kp-sub">{p.prefill.name}</span>}
            </span>
            <span role="cell" className="kp-cell-roles">
                {roles.slice(0, 2).map((r) => <span key={r.id} className="kp-rolechip">{r.name}</span>)}
                {roles.length > 2 && <span className="kp-rolechip" data-tip={roles.slice(2).map((r) => r.name).join(", ")}>+{roles.length - 2}</span>}
            </span>
            <span role="cell"><AttendanceValue userId={userId} /></span>
            <span role="cell">
                {entry.state === "pool" || entry.state === "selected" ? (
                    <Switch on={entry.state === "selected"} label={t("kader.pool.toSelection", { name })} disabled={!canWrite}
                        onChange={(on) => void run(setKaderState(kader.id, [userId], on ? "selected" : "pool"))} />
                ) : <StateBadge state={entry.state} />}
            </span>
        </div>
    );
}

export default function PoolView() {
    const t = useT();
    const toast = useToast();
    const ask = useConfirm();
    const { view, kader, players, canWrite, run, open } = useKader();
    const [q, setQ] = useState("");
    const [scope, setScope] = usePersistedState<Scope>("kader-pool-scope", "all");
    const [rawFilters, setFilters] = usePersistedState<FilterState>("kader-pool-filters", {});
    const [marked, setMarked] = useState<string[]>([]);
    const sort = useTableSort<PoolSortKey>("kader-pool-sort", POOL_SORT, "name");

    const rows: Row[] = useMemo(() => Object.entries(kader.players).map(([userId, entry]) => ({ userId, entry })), [kader]);

    const defs = useMemo<FilterDef<Row>[]>(() => {
        const held = new Set(rows.flatMap((r) => (players.get(r.userId) || { roleIds: [] as string[] }).roleIds));
        return [
            {
                key: "role", label: t("kader.pool.filterRole"),
                options: view.discordRoles.filter((r) => held.has(r.id)).map((r) => ({
                    value: r.id, label: r.name, color: r.color || undefined,
                    test: (row: Row) => (players.get(row.userId) || { roleIds: [] as string[] }).roleIds.includes(r.id),
                })),
            },
            {
                key: "class", label: t("kader.pool.filterClass"),
                options: [
                    ...view.classes.map((c) => ({
                        value: c.key, label: className(view.classes, c.key), icon: { kind: "class" as const, key: c.key },
                        test: (row: Row) => (mainPick(players.get(row.userId), row.entry) || { className: "" }).className === c.key,
                    })),
                    { value: NO_CLASS, label: t("kader.pool.noClass"), test: (row: Row) => !mainPick(players.get(row.userId), row.entry) },
                ],
            },
        ];
    }, [rows, players, view, t]);
    const filters = cleanState(defs, rawFilters);

    const inScope = (r: Row) => scope === "all" || r.entry.state === scope;
    const needle = q.trim().toLowerCase();
    const shown = sortTable(
        rows.filter((r) => inScope(r) && passes(r, defs, filters) && (!needle || searchText(view, r.userId, r.entry).includes(needle))),
        (r) => playerName(view, r.userId, r.entry),
        poolParts({ view, kader, players }, sort.sort),
        sort.dir,
    );
    const count = (s: Scope) => rows.filter((r) => s === "all" || r.entry.state === s).length;
    const markedRows = rows.filter((r) => marked.includes(r.userId));

    const moveMarked = async (to: KaderState) => {
        const from: KaderState = to === "selected" ? "pool" : "selected";
        const ids = markedRows.filter((r) => r.entry.state === from).map((r) => r.userId);
        const skipped = markedRows.length - ids.length;
        if (!ids.length) {
            toast(t("kader.pool.nothingToMove"), "err");
            return;
        }
        if (await run(setKaderState(kader.id, ids, to))) {
            setMarked([]);
            toast(skipped ? t("kader.pool.movedSkipped", { n: ids.length, skipped }) : t("kader.pool.moved", { n: ids.length }));
        }
    };
    const removeMarked = async () => {
        const ids = markedRows.map((r) => r.userId);
        if (!(await ask({ title: t("kader.pool.removeTitle", { n: ids.length }), text: t("kader.pool.removeText"), action: t("kader.pool.remove"), tone: "danger" }))) return;
        if (await run(removeKaderPlayers(kader.id, ids))) setMarked([]);
    };
    const toggleAll = (on: boolean) => setMarked(on ? shown.map((r) => r.userId) : []);
    const importButton = <Button icon={<RecruitmentIcon />} onClick={() => open({ type: "import" })}>{t("kader.pool.import")}</Button>;

    return (
        <div className="kp-view">
            <div className="kp-toolbar">
                <label className="kp-search">
                    <SearchIcon />
                    <input type="search" aria-label={t("kader.pool.search")} placeholder={t("kader.pool.search")} value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
                <Segment<Scope> size="sm" ariaLabel={t("kader.pool.scope")} value={scope} onChange={setScope} options={[
                    { value: "all", label: t("kader.pool.scopeAll", { n: count("all") }), tip: t("kader.pool.scopeAllTip", { count: count("all") }) },
                    { value: "pool", label: t("kader.pool.scopePool", { n: count("pool") }), tip: t("kader.nav.count.pool", { count: count("pool") }) },
                    { value: "selected", label: t("kader.pool.scopeSelected", { n: count("selected") }), tip: t("kader.nav.count.selected", { count: count("selected") }) },
                ]} />
                <span className="kp-grow" />
                {canWrite && (
                    <span className="kp-actions">
                        <Button variant="ghost" icon={<PlusIcon />} onClick={() => open({ type: "addById" })}>{t("kader.pool.byId")}</Button>
                        {importButton}
                    </span>
                )}
            </div>
            <div className="kp-countrow">
                <FilterMenus items={rows.filter(inScope)} defs={defs} state={filters} onChange={setFilters} />
                <span className="kp-muted"><b className="kp-mono kp-big-n">{shown.length}</b> {t("kader.pool.ofTotal", { count: rows.length })}</span>
                <FilterChips defs={defs} state={filters} onChange={setFilters} />
            </div>
            <div className="kp-panel kp-table kp-scroll-x kp-pool-table" role="table" aria-label={t("kader.pool.tableLabel", { name: kader.name })}>
                <div className="kp-trow kp-thead kp-pool-grid" role="row">
                    <span role="columnheader" className="kp-cell-mark">
                        <input type="checkbox" aria-label={t("kader.batch.markAll")} disabled={!canWrite || !shown.length}
                            checked={shown.length > 0 && shown.every((r) => marked.includes(r.userId))} onChange={(e) => toggleAll(e.target.checked)} />
                    </span>
                    <SortHead sortKey="name" label={t("kader.pool.colPlayer")} sort={sort} />
                    <SortHead sortKey="char" label={t("kader.pool.colChar")} sort={sort} tip={t("kader.pool.colChar")} tipSub={t("kader.sort.charSub")} />
                    <SortHead sortKey="roles" label={t("kader.pool.colRoles")} sort={sort} tip={t("kader.pool.colRoles")} tipSub={t("kader.sort.rolesSub")} />
                    <SortHead sortKey="attendance" label={t("kader.pool.colAttendance")} sort={sort} tip={t("kader.pool.colAttendance")} tipSub={t("kader.sort.attendanceSub")} className="kp-th-att">
                        <AttendanceSource />
                    </SortHead>
                    <SortHead sortKey="state" label={t("kader.pool.colSelection")} sort={sort} tip={t("kader.pool.colSelection")} tipSub={t("kader.sort.stateSub")} />
                </div>
                {shown.length === 0 && (
                    <TableNote>
                        {rows.length
                            ? <EmptyState icon={<SearchIcon />} text={t("kader.pool.none")} />
                            : <EmptyState icon={<RosterIcon />} text={t("kader.pool.emptyKader")}>{canWrite && importButton}</EmptyState>}
                    </TableNote>
                )}
                {shown.map((r) => (
                    <PoolRow key={r.userId} row={r} marked={marked.includes(r.userId)}
                        onMark={(on) => setMarked(on ? [...marked, r.userId] : marked.filter((id) => id !== r.userId))} />
                ))}
            </div>
            <BatchBar count={markedRows.length} onClear={() => setMarked([])}>
                <Button size="sm" icon={<ListChecksIcon />} onClick={() => void moveMarked("selected")}>{t("kader.pool.batchSelect")}</Button>
                <BackButton size="sm" label={t("kader.pool.batchUnselect")} onClick={() => void moveMarked("pool")} />
                <Button size="sm" variant="danger" icon={<TrashIcon />} onClick={() => void removeMarked()}>{t("kader.pool.remove")}</Button>
            </BatchBar>
        </div>
    );
}
