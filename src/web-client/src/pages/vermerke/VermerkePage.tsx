import { useCallback, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { getVermerke, NOTE_LEVELS, type NoteLevel, type VermerkPerson } from "../../api/vermerke";
import { useApi } from "../../hooks/useApi";
import type { ShellContext } from "../../components/shell/Shell";
import { Badge, Button, PageHead, Segment } from "../../components/ui";
import RaidLoader from "../../components/ui/RaidLoader";
import { SortTh } from "../../components/ui/SortTh";
import Icon from "../../components/ui/Icon";
import { LockIcon, PlusIcon } from "../../components/ui/icons";
import LevelMark from "../../components/vermerke/LevelMark";
import { ReasonIcons } from "../../components/vermerke/ReasonIcon";
import VermerkDialog, { type VermerkDialogPreset } from "../../components/vermerke/VermerkDialog";
import { useTableSort, type TableSort } from "../../lib/ui/tableSort";
import { canAccess } from "../../lib/app/access";
import { formatDayMonth } from "../../lib/format";
import { initialsOf } from "../../lib/discord/serverRoles";
import VermerkDrawer from "./VermerkDrawer";
import VermerkSignals from "./VermerkSignals";
import "../../styles/vermerke.css";
import { useT } from "../../i18n";

// System › Vermerke (docs/vermerke.md, #980): every person with notes on the
// active server, one compact line each like a moderation log (A2) — name, level
// as symbol and word, the reasons as grey icons with ×2, the count, the date
// (author as tooltip), and one icon for "left the server" or "shared". Tab
// "Archiv" holds the people whose notes no longer count. A click opens the
// drawer with the entries (`?user=<id>`, also the link from the member list).
// Below: "Hinweise aus den Daten" (#982), hidden when there are none.

type SortKey = "name" | "level" | "reasons" | "entries" | "last";
const SORT_DEFAULTS: Record<SortKey, "asc" | "desc"> = { name: "asc", level: "desc", reasons: "desc", entries: "desc", last: "desc" };
type Tab = "active" | "archive";
type LevelFilter = "all" | NoteLevel;
/** Lines before "N weitere Personen zeigen". */
const ROWS_SHOWN = 25;
const LEVEL_RANK: Record<NoteLevel, number> = { hint: 1, warning: 2, shadowban: 3 };

export default function VermerkePage() {
    const { user } = useOutletContext<ShellContext>();
    const t = useT();
    const canWrite = canAccess(user, "vermerke", "write");
    const [params, setParams] = useSearchParams();
    const openId = params.get("user");
    const open = (id: string) => setParams({ user: id });
    const close = useCallback(() => setParams({}, { replace: true }), [setParams]);
    const state = useApi(() => getVermerke(), []);
    const [tab, setTab] = useState<Tab>("active");
    const [level, setLevel] = useState<LevelFilter>("all");
    const [all, setAll] = useState(false);
    const sort = useTableSort<SortKey>("vermerke-sort", SORT_DEFAULTS, "last");
    const [dialog, setDialog] = useState<VermerkDialogPreset | null>(null);
    // bumped after every change, so the open drawer loads the person again
    const [version, setVersion] = useState(0);
    const changed = () => { state.reload(); setVersion((v) => v + 1); };

    const data = state.data;
    const people = data ? data.people : [];
    const openPerson = openId ? people.find((p) => p.userId === openId) : undefined;

    return (
        <div className="vmk-page">
            <PageHead
                icon="vermerke" tone="vermerke"
                kicker={data && data.guildName ? `${t("vermerke.page.kicker")} · ${data.guildName}` : t("vermerke.page.kicker")}
                title={t("vermerke.page.title")}
                meta={data ? <Badge>{t("vermerke.page.people", { count: people.filter((p) => p.activeCount > 0).length })}</Badge> : undefined}
                action={canWrite && data ? <Button variant="primary" icon={<PlusIcon />} onClick={() => setDialog({})}>{t("vermerke.page.add")}</Button> : undefined}
            />

            {state.error && !data && (
                <p className="empty">{state.error.code === "no_server" ? t("vermerke.page.noServer") : t("vermerke.page.loadError", { message: state.error.message })}</p>
            )}
            {!data && !state.error && <RaidLoader text={t("vermerke.page.loading")} />}
            {data && (
                <div className="vmk-body">
                    <List
                        people={people} tab={tab} setTab={(v) => { setTab(v); setAll(false); }} level={level} setLevel={(v) => { setLevel(v); setAll(false); }}
                        all={all} setAll={setAll} sort={sort} openId={openId} onOpen={open}
                    />
                    <VermerkSignals canWrite={canWrite} onAdd={(preset) => setDialog(preset)} />
                </div>
            )}

            {data && openId && (
                <VermerkDrawer
                    key={openId} userId={openId} guildId={data.guildId} guildName={data.guildName} fallbackName={openPerson ? openPerson.name : ""}
                    canWrite={canWrite} version={version} onClose={close} onChanged={changed}
                    onAdd={(person) => setDialog({ person })}
                    onEdit={(person, entry) => setDialog({ person, entry })}
                />
            )}
            {dialog && (
                <VermerkDialog
                    guildId={data ? data.guildId : ""} preset={dialog} onClose={() => setDialog(null)}
                    onSaved={(userId) => { setDialog(null); changed(); if (userId !== openId) open(userId); }}
                />
            )}
        </div>
    );
}

function List({ people, tab, setTab, level, setLevel, all, setAll, sort, openId, onOpen }: {
    people: VermerkPerson[];
    tab: Tab;
    setTab: (tab: Tab) => void;
    level: LevelFilter;
    setLevel: (level: LevelFilter) => void;
    all: boolean;
    setAll: (all: boolean) => void;
    sort: TableSort<SortKey>;
    openId: string | null;
    onOpen: (id: string) => void;
}) {
    const t = useT();
    const archive = tab === "archive";
    const inTab = people.filter((p) => (archive ? p.activeCount === 0 : p.activeCount > 0));
    const shown = archive || level === "all" ? inTab : inTab.filter((p) => p.level === level);
    const sorted = sort.apply(shown, (p, key) => {
        if (key === "name") return p.name.toLowerCase();
        if (key === "level") return p.level ? LEVEL_RANK[p.level] : 0;
        if (key === "reasons") return Object.values(p.reasons).reduce((a, n) => a + (n || 0), 0);
        if (key === "entries") return archive ? p.totalCount : p.activeCount;
        return p.lastAt;
    });
    const rows = all ? sorted : sorted.slice(0, ROWS_SHOWN);
    const activeCount = people.filter((p) => p.activeCount > 0).length;

    return (
        <>
            <div className="vmk-controls">
                <Segment<Tab>
                    ariaLabel={t("vermerke.tab.aria")} value={tab} onChange={setTab}
                    options={[
                        { value: "active", label: `${t("vermerke.tab.active")} · ${activeCount}`, tip: t("vermerke.tab.activeTip") },
                        { value: "archive", label: `${t("vermerke.tab.archive")} · ${people.length - activeCount}`, tip: t("vermerke.tab.archiveTip") },
                    ]}
                />
                {!archive && (
                    <Segment<LevelFilter>
                        ariaLabel={t("vermerke.filter.aria")} value={level} onChange={setLevel} size="sm"
                        options={[
                            { value: "all", label: t("vermerke.filter.all") },
                            ...NOTE_LEVELS.map((l) => ({ value: l, label: t(`vermerke.level.${l}`), tip: t(`vermerke.levelTip.${l}`) })),
                        ]}
                    />
                )}
            </div>
            {rows.length === 0 ? (
                <p className="vmk-empty">{archive ? t("vermerke.page.emptyArchive") : level !== "all" && inTab.length ? t("vermerke.page.emptyFilter") : t("vermerke.page.empty")}</p>
            ) : (
                <div className="vmk-wrap">
                    <table className="idx vmk-table">
                        <thead>
                            <tr>
                                <SortTh sortKey="name" label={t("vermerke.col.person")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} />
                                <SortTh sortKey="level" label={t("vermerke.col.level")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} className="vmk-c-level" />
                                <SortTh sortKey="reasons" label={t("vermerke.col.reasons")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} className="vmk-c-reasons" />
                                <SortTh
                                    sortKey="entries" label={t("vermerke.col.entries")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort}
                                    tip={archive ? t("vermerke.col.entriesArchiveTip") : t("vermerke.col.entriesTip")} className="vmk-c-n"
                                />
                                <SortTh sortKey="last" label={t("vermerke.col.last")} sort={sort.sort} dir={sort.dir} onSort={sort.onSort} tip={t("vermerke.col.lastTip")} />
                                <th className="vmk-c-state"><span className="sr-only">{t("vermerke.col.state")}</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((p) => <Row key={p.userId} person={p} archive={archive} open={p.userId === openId} onOpen={onOpen} />)}
                        </tbody>
                    </table>
                </div>
            )}
            {!all && sorted.length > rows.length && (
                <button type="button" className="vmk-more" onClick={() => setAll(true)}>{t("vermerke.page.showAll", { count: sorted.length - rows.length })}</button>
            )}
            <p className="vmk-foot">{t("vermerke.page.foot")}</p>
        </>
    );
}

function Row({ person: p, archive, open, onOpen }: { person: VermerkPerson; archive: boolean; open: boolean; onOpen: (id: string) => void }) {
    const t = useT();
    const n = archive ? p.totalCount : p.activeCount;
    return (
        <tr className={`vmk-row${open ? " vmk-open" : ""}`} onClick={() => onOpen(p.userId)} data-user={p.userId}>
            <td>
                <span className="vmk-who">
                    <span className="vmk-av" aria-hidden="true">{initialsOf(p.name)}</span>
                    <span className="vmk-names">
                        <button type="button" className="vmk-name" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onOpen(p.userId); }}>{p.name}</button>
                        {/* phone: level and reasons as a second line */}
                        <span className="vmk-meta"><LevelMark level={p.level} size={14} /><ReasonIcons reasons={p.reasons} /></span>
                    </span>
                </span>
            </td>
            <td className="vmk-c-level"><LevelMark level={p.level} /></td>
            <td className="vmk-c-reasons"><ReasonIcons reasons={p.reasons} /></td>
            <td className="vmk-c-n">{n}</td>
            <td className="vmk-c-last">
                {p.lastAt > 0 ? <span data-tip={formatDayMonth(p.lastAt)} data-tip-sub={p.lastByName ? t("vermerke.cell.lastBy", { name: p.lastByName }) : undefined}>{formatDayMonth(p.lastAt)}</span> : "–"}
            </td>
            <td className="vmk-c-state">
                <span className="vmk-state">
                    {p.left && (
                        <span role="img" aria-label={t("vermerke.cell.left")} data-tip={t("vermerke.cell.left")} data-tip-sub={t("vermerke.cell.leftSub")}>
                            <Icon name="leftServer" size={16} />
                        </span>
                    )}
                    {p.sharedCount > 0 && (
                        <span role="img" aria-label={t("vermerke.cell.shared", { count: p.sharedCount })} data-tip={t("vermerke.cell.shared", { count: p.sharedCount })} data-tip-sub={t("vermerke.cell.sharedSub")}>
                            <LockIcon />
                        </span>
                    )}
                </span>
            </td>
        </tr>
    );
}
