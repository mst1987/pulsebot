// "Zusammensetzung" (docs/kaderplaner.md): who of Vorläufig and Roster plays which
// class, spec and role, grouped by class — the count of each role in one line with
// the rule set's guide for the nearest setup size, and the raid and party buffs the
// counted players bring (or that are missing). Bench and tentative show greyed out
// and count only with the switch, remembered per Kader.
//
// The "Planspiel": one shared draft per Kader. With write access each row gets the
// spec picker (the same menu as the decision, naming the spec) and an eye button
// to leave the player out ("Ausklammern"); sums and
// buffs follow the draft, the bar above says by whom, how old and what it changes
// ("+1 Heiler · −1 Fernkampf · Kampfrausch jetzt doppelt"), and offers "Verwerfen"
// and "Als Entscheidung übernehmen" (sets decisions, never a state). Own edits are
// laid over the stored draft until their answer is in, so a live refetch never
// takes a pick back. Read access sees the draft without any control.
import { useState, type ReactNode } from "react";
import { applyKaderPlan, discardKaderPlan, isStale, saveKaderPlan, type KaderRole, type KaderState, type KaderWish } from "../../api";
import { Button, IconButton, Switch } from "../../components/ui";
import { useConfirm } from "../../components/ui/Modal";
import { CheckIcon, EyeIcon, EyeOffIcon, RosterIcon, TrashIcon } from "../../components/ui/icons";
import { useToast } from "../../components/shell/Jobs";
import { useT } from "../../i18n";
import { usePersistedState } from "../../lib/ui/persistedState";
import { useTableSort, type Dir } from "../../lib/ui/tableSort";
import { classColor, className, nameOf, playerName, ROLES, specName, wishOptions } from "../../lib/kader/model";
import { pickParts, sortTable, type SortParts } from "../../lib/kader/sort";
import { buffLabel } from "../../lib/kader/setup";
import {
    buffCoverage, buffSources, composition, nearestSize, planDecisions, planDiff, planWithPending, sameSpec,
    type BuffChange, type BuffCover, type Composition, type CompositionClass, type CompositionRow, type PlanDiff, type PlanEdit,
} from "../../lib/kader/composition";
import { roleLabel, rolePluralLabel } from "../../lib/wow/wowNames";
import { classColorProps } from "../../components/character/ClassSpec";
import { ClassIcon, EmptyState, PlayerAvatar, PickIcon, PlayerName, RoleIcon, SortHead, StateBadge, TableNote, WishIcons } from "./parts";
import WishPicker from "./WishPicker";
import { useKader } from "./kaderContext";

type CompSortKey = "name" | "spec" | "role" | "state";
/** Names and specs A–Z, roles tank first, states furthest along first. */
const COMP_SORT: Record<CompSortKey, Dir> = { name: "asc", spec: "asc", role: "asc", state: "desc" };
const STATE_RANK: Partial<Record<KaderState, number>> = { bench: 0, tentative: 1, provisional: 2, roster: 3 };

/** "1 Tank", "5 Heiler" — a number always with its word. */
function roleCount(role: KaderRole, n: number): string {
    return `${n} ${n === 1 ? roleLabel(role) : rolePluralLabel(role)}`;
}

/** "+1 Heiler", "−2 Fernkämpfer". */
function roleDelta(role: KaderRole, delta: number): string {
    const n = Math.abs(delta);
    return `${delta > 0 ? "+" : "−"}${roleCount(role, n)}`;
}

/** "gerade eben", "vor 5 Min." of an ISO time. */
function planAgo(t: ReturnType<typeof useT>, iso: string, now: number): string {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return "";
    const minutes = Math.max(0, Math.round((now - ms) / 60000));
    if (minutes < 1) return t("kader.composition.plan.ago.now");
    if (minutes < 60) return t("kader.composition.plan.ago.minutes", { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 48) return t("kader.composition.plan.ago.hours", { count: hours });
    return t("kader.composition.plan.ago.days", { count: Math.round(hours / 24) });
}

const BUFF_TEXT: Record<BuffChange["change"], string> = { now: "buffNow", gone: "buffGone", double: "buffDouble" };
const BUFF_MARK: Record<BuffChange["change"], string> = { now: "markNow", gone: "markGone", double: "markDouble" };

/** The line under the bar: role changes, left-out players, buff changes. */
function diffText(t: ReturnType<typeof useT>, diff: PlanDiff): string {
    const parts = [
        ...diff.roles.map((r) => roleDelta(r.role, r.delta)),
        ...(diff.excluded ? [t("kader.composition.plan.excluded", { count: diff.excluded })] : []),
        ...diff.buffs.map((b) => t(`kader.composition.plan.${BUFF_TEXT[b.change]}`, { name: buffLabel(b.buff) })),
    ];
    return parts.length ? parts.join(" · ") : t("kader.composition.plan.noDiff");
}

/** The role sums of a composition ("4 Tanks · 5 Heiler · … · 25 Spieler"). */
function sumText(t: ReturnType<typeof useT>, comp: Composition): string {
    return [...ROLES.map((r) => roleCount(r, comp.roles[r])), t("kader.composition.players", { count: comp.total })].join(" · ");
}

/** The spec by its own name ("Furor"), in the class colour — the class already heads the group. */
function SpecCell({ pick }: { pick: NonNullable<CompositionRow["pick"]> }) {
    const { view } = useKader();
    const props = classColorProps(classColor(view.classes, pick.className));
    return (
        <span className="kp-spectag">
            <PickIcon pick={pick} size={20} />
            <span className={["kp-ellipsis", props.className].filter(Boolean).join(" ")} style={props.style}
                data-tip={`${className(view.classes, pick.className)} · ${specName(view.classes, pick.spec)}`}>
                {specName(view.classes, pick.spec)}
            </span>
        </span>
    );
}

type RowProps = {
    row: CompositionRow;
    /** Write access: the picker and the "Ausklammern" column. */
    canPlan: boolean;
    onSpec: (row: CompositionRow, pick: KaderWish) => void;
    onExclude: (row: CompositionRow, excluded: boolean) => void;
};

function CompRow({ row, canPlan, onSpec, onExclude }: RowProps) {
    const t = useT();
    const { view } = useKader();
    const { userId, entry, pick, role, counted, was, undecided, excluded } = row;
    const name = playerName(view, userId, entry);
    const pickable = canPlan && !excluded && !!pick && !!pick.spec && wishOptions(entry, pick.spec).length > 1;
    let spec: ReactNode;
    if (!pick || !pick.spec) spec = <span className="kp-muted">{t("kader.composition.noSpecRow")}</span>;
    else if (pickable) spec = <WishPicker entry={entry} value={pick.spec} label={t("kader.composition.plan.specOf", { name })} onChange={(p) => onSpec(row, p)} specLabel />;
    else spec = <SpecCell pick={pick} />;
    return (
        <div className={`kp-trow kp-comp-grid${canPlan ? " kp-comp-planning" : ""}${counted ? "" : " kp-comp-off"}${excluded ? " kp-comp-excluded" : ""}`} role="row">
            <span role="cell" className="kp-cell-who">
                <PlayerAvatar userId={userId} entry={entry} />
                <span className="kp-cell-name">
                    <PlayerName userId={userId} entry={entry} />
                    {excluded
                        ? <span className="kp-sub">{t("kader.composition.plan.excludedRow")}</span>
                        : !counted && <span className="kp-sub">{t("kader.composition.notCounted")}</span>}
                </span>
            </span>
            <span role="cell" className="kp-comp-speccell">
                {spec}
                {was !== undefined && (
                    <span className="kp-sub kp-comp-was">
                        {t("kader.composition.plan.was")} <s>{undecided ? t("kader.composition.plan.wasUndecided") : was && was.spec ? specName(view.classes, was.spec) : t("kader.composition.noSpecRow")}</s>
                    </span>
                )}
            </span>
            <span role="cell" className="kp-comp-role">
                {role ? <><RoleIcon role={role} size={18} /><span className="kp-comp-rolename">{roleLabel(role)}</span></> : <span className="kp-muted">–</span>}
            </span>
            <span role="cell"><StateBadge state={entry.state} /></span>
            <span role="cell" className="kp-comp-wishes"><WishIcons wishes={entry.wishes} size={18} /></span>
            {canPlan && (
                <span role="cell" className="kp-comp-plancell">
                    <IconButton size="sm" tone="ghost" icon={excluded ? <EyeOffIcon /> : <EyeIcon />} pressed={!!excluded}
                        tip={excluded ? t("kader.composition.plan.include") : t("kader.composition.plan.exclude")} tipSub={t("kader.composition.plan.excludeTip")}
                        aria-label={t(excluded ? "kader.composition.plan.includeAria" : "kader.composition.plan.excludeAria", { name })}
                        onClick={() => onExclude(row, !excluded)} />
                </span>
            )}
        </div>
    );
}

function ClassHead({ group }: { group: CompositionClass }) {
    const t = useT();
    const { view } = useKader();
    const color = classColorProps(group.classKey ? classColor(view.classes, group.classKey) : "");
    const left = group.rows.filter((r) => r.excluded).length;
    const off = group.shown - group.counted - left;
    return (
        <div className="kp-trow kp-comp-class" role="row">
            <span role="cell" className="kp-comp-classcell">
                {group.classKey && <ClassIcon classKey={group.classKey} size={18} />}
                <b className={color.className} style={color.style}>{group.classKey ? className(view.classes, group.classKey) : t("kader.composition.noClass")}</b>
                <span className="kp-muted">{t("kader.composition.classCount", { count: group.counted })}</span>
                {left > 0 && <span className="kp-muted">{t("kader.composition.plan.excluded", { count: left })}</span>}
                {off > 0 && <span className="kp-muted">{t("kader.composition.classExtra", { count: off })}</span>}
            </span>
        </div>
    );
}

/** Who can bring a buff: whole classes by name, else the spec names; the counted donors in the tooltip; what the draft changes. */
function BuffLine({ cover, change }: { cover: BuffCover; change?: BuffChange["change"] }) {
    const t = useT();
    const { view, kader } = useKader();
    const sources = buffSources(view.classes, cover.providers)
        .map((s) => (s.specs ? s.specs.map((k) => specName(view.classes, k)).join(", ") : className(view.classes, s.classKey)))
        .join(" · ");
    const has = cover.donors.length > 0;
    const names = cover.donors.map((id) => playerName(view, id, kader.players[id])).join(", ");
    return (
        <li className={`kp-comp-buff${change ? " kp-comp-buffchanged" : ""}`}>
            <span className="kp-comp-buffname">{buffLabel(cover.buff)}</span>
            {has
                ? <span className="kp-comp-have" data-tip={names}>{t("kader.composition.donors", { count: cover.donors.length })}</span>
                : <span className="kp-comp-miss">{t("kader.composition.missing")}</span>}
            {change && <span className="kp-comp-buffmark">{t(`kader.composition.plan.${BUFF_MARK[change]}`)}</span>}
            <span className="kp-sub kp-comp-src">{sources}</span>
        </li>
    );
}

export default function CompositionView() {
    const t = useT();
    const { view, kader, canWrite, me, run, refresh } = useKader();
    const ask = useConfirm();
    const toast = useToast();
    const [extraMap, setExtraMap] = usePersistedState<Record<string, boolean>>("kader-composition-extra", {});
    const withExtra = !!extraMap[kader.id];
    const sort = useTableSort<CompSortKey>("kader-composition-sort", COMP_SORT, "name");
    // own draft edits on their way to the server, laid over the stored draft until their answer is in
    const [pending, setPending] = useState<Record<string, PlanEdit>>({});
    const [busy, setBusy] = useState(false);
    const now = Date.now();
    const plan = planWithPending(kader.plan, pending, me, new Date(now).toISOString());

    const before = composition(view, kader, withExtra);
    const comp = plan ? composition(view, kader, withExtra, plan) : before;
    const buffsBefore = buffCoverage(view, before.rows);
    const buffs = plan ? buffCoverage(view, comp.rows) : buffsBefore;
    const diff = plan ? planDiff(before, comp, buffsBefore, buffs) : null;
    const buffChange = new Map((diff ? diff.buffs : []).map((b) => [b.key, b.change]));

    const edit = async (userId: string, change: PlanEdit) => {
        const mine: PlanEdit = { ...pending[userId], ...change };
        setPending((prev) => ({ ...prev, [userId]: mine }));
        // the answer (or the error, which takes the edit back) ends the overlay — unless a later edit replaced it
        await run(saveKaderPlan(kader.id, userId, change));
        setPending((prev) => {
            if (prev[userId] !== mine) return prev;
            const rest = { ...prev };
            delete rest[userId];
            return rest;
        });
    };
    const onSpec = (row: CompositionRow, pick: KaderWish) => {
        const base = row.was !== undefined ? row.was : row.pick;
        void edit(row.userId, { spec: sameSpec(pick, base) ? null : { className: pick.className, spec: pick.spec } });
    };
    const onExclude = (row: CompositionRow, excluded: boolean) => void edit(row.userId, { excluded });

    /** Runs a draft action against the draft as it was when its dialog opened; a draft moved on meanwhile is refused (409 stale) and reloaded. */
    const runFresh = async <T,>(call: Promise<T>): Promise<T | null> => {
        setBusy(true);
        let stale = false;
        const res = await run(call, {
            onError: (e) => {
                if (!isStale(e)) return false;
                stale = true;
                return true;
            },
        });
        setBusy(false);
        if (!stale) return res ?? null;
        toast(t("kader.composition.plan.stale"), "warn");
        void refresh();
        return null;
    };
    const discard = async () => {
        // the draft as seen when the dialog opened
        const rev = kader.plan ? kader.plan.rev : undefined;
        const ok = await ask({ title: t("kader.composition.plan.discardTitle"), text: t("kader.composition.plan.discardText"), action: t("kader.composition.plan.discard"), tone: "danger" });
        if (!ok) return;
        if (await runFresh(discardKaderPlan(kader.id, rev))) toast(t("kader.composition.plan.discarded"));
    };
    const decisions = planDecisions(plan, kader);
    const leftOut = plan ? plan.excluded.filter((id) => kader.players[id]).length : 0;
    const apply = async () => {
        const rev = kader.plan ? kader.plan.rev : undefined;
        const ok = await ask({
            title: t("kader.composition.plan.applyTitle"),
            text: <>{t("kader.composition.plan.applyText", { count: decisions })}{leftOut > 0 && <> {t("kader.composition.plan.applyExcluded", { count: leftOut })}</>}</>,
            action: t("kader.composition.plan.apply"),
            tone: "go",
        });
        if (!ok) return;
        const res = await runFresh(applyKaderPlan(kader.id, rev));
        if (res) toast(t("kader.composition.plan.applied", { count: res.applied }));
    };

    const parts = (r: CompositionRow): SortParts => {
        if (sort.sort === "spec") return pickParts(view.classes, r.pick && r.pick.spec ? r.pick : null);
        if (sort.sort === "role") return r.role ? [ROLES.indexOf(r.role)] : null;
        if (sort.sort === "state") return [STATE_RANK[r.entry.state] ?? -1];
        return [playerName(view, r.userId, r.entry)];
    };
    const sorted = (rows: CompositionRow[]) => sortTable(rows, (r) => playerName(view, r.userId, r.entry), parts, sort.dir);

    const size = nearestSize(view.setupSizes || [], comp.total);
    const guide = size !== null && view.setupComposition ? view.setupComposition[String(size)] : undefined;
    const roleParts = ROLES.map((r) => roleCount(r, comp.roles[r]));
    const changedSums = !!diff && (diff.roles.length > 0 || before.total !== comp.total);
    const pendingAny = Object.keys(pending).length > 0;

    return (
        <div className="kp-view kp-comp">
            {plan && diff && (
                <section className="kp-comp-plan" aria-label={t("kader.composition.plan.title")}>
                    <div className="kp-comp-planhead">
                        <p className="kp-comp-planline">
                            <b>{t("kader.composition.plan.title")}</b>
                            {" · "}{t("kader.composition.plan.changes", { count: diff.changes })}
                            {" · "}<span className="kp-muted">{t("kader.composition.plan.by", { name: nameOf(view, plan.by), ago: planAgo(t, plan.at, now) })}</span>
                            {" · "}<span className="kp-muted" data-tip={t("kader.composition.plan.noteTip")}>{t("kader.composition.plan.note")}</span>
                        </p>
                        {canWrite && (
                            <span className="kp-comp-planacts">
                                <Button variant="ghost" size="sm" icon={<TrashIcon />} disabled={busy} onClick={() => void discard()}>{t("kader.composition.plan.discard")}</Button>
                                <Button variant="go" size="sm" icon={<CheckIcon />} disabled={busy || pendingAny || decisions === 0}
                                    data-tip={decisions === 0 ? t("kader.composition.plan.applyNone") : undefined} onClick={() => void apply()}>
                                    {t("kader.composition.plan.apply")}
                                </Button>
                            </span>
                        )}
                    </div>
                    <p className="kp-comp-plandiff">{diffText(t, diff)}</p>
                </section>
            )}
            <div className="kp-toolbar kp-comp-bar">
                <div className="kp-comp-sums">
                    <p className="kp-comp-sum" aria-live="polite">
                        {roleParts.join(" · ")}
                        {" · "}<b>{t("kader.composition.players", { count: comp.total })}</b>
                        {comp.noSpec > 0 && <span className="kp-comp-nospec" data-tip={t("kader.composition.noSpecTip")}>{" · "}{t("kader.composition.noSpec", { count: comp.noSpec })}</span>}
                    </p>
                    {changedSums && <p className="kp-sub kp-comp-before">{t("kader.composition.plan.before", { text: sumText(t, before) })}</p>}
                </div>
                {guide && size !== null && (
                    <span className="kp-muted kp-comp-guide" data-tip={t("kader.composition.targetTip")}>
                        {t("kader.composition.target", { size, tanks: roleCount("tank", guide.tanks), healers: roleCount("healer", guide.healers) })}
                    </span>
                )}
                <span className="kp-grow" />
                <Switch checked={withExtra} onChange={(on) => setExtraMap({ ...extraMap, [kader.id]: on })}
                    label={t("kader.composition.extra", { count: comp.extra })} tip={t("kader.composition.extraTip")} disabled={comp.extra === 0} />
            </div>
            <div className="kp-comp-body">
                <div className={`kp-panel kp-table kp-scroll-x kp-comp-table${canWrite ? " kp-comp-table-plan" : ""}`} role="table" aria-label={t("kader.composition.tableLabel", { name: kader.name })}>
                    <div className={`kp-trow kp-thead kp-comp-grid${canWrite ? " kp-comp-planning" : ""}`} role="row">
                        <SortHead sortKey="name" label={t("kader.composition.colPlayer")} sort={sort} />
                        <SortHead sortKey="spec" label={plan || canWrite ? t("kader.composition.plan.colSpec") : t("kader.composition.colSpec")} sort={sort}
                            tip={t("kader.composition.colSpec")} tipSub={t("kader.composition.specSub")} />
                        <SortHead sortKey="role" label={t("kader.composition.colRole")} sort={sort} />
                        <SortHead sortKey="state" label={t("kader.composition.colState")} sort={sort} />
                        <span role="columnheader" className="kp-th kp-comp-wishes"><span className="kicker">{t("kader.composition.colWishes")}</span></span>
                        {canWrite && <span role="columnheader" className="kp-th kp-comp-plancell"><span className="kp-sr">{t("kader.composition.plan.colPlan")}</span></span>}
                    </div>
                    {comp.rows.length === 0 && (
                        <TableNote><EmptyState icon={<RosterIcon />} text={t("kader.composition.empty")} /></TableNote>
                    )}
                    {comp.classes.map((g) => (
                        <div key={g.classKey || "-"} role="rowgroup" className="kp-comp-group">
                            <ClassHead group={g} />
                            {sorted(g.rows).map((r) => <CompRow key={r.userId} row={r} canPlan={canWrite} onSpec={onSpec} onExclude={onExclude} />)}
                        </div>
                    ))}
                </div>
                <aside className="kp-comp-side" aria-label={t("kader.composition.buffs")}>
                    {!buffs.raid.length && !buffs.party.length && <p className="kp-muted">{t("kader.composition.noBuffs")}</p>}
                    {buffs.raid.length > 0 && (
                        <section>
                            <h3 className="kicker">{t("kader.composition.raidBuffs")}</h3>
                            <ul className="kp-comp-buffs">{buffs.raid.map((c) => <BuffLine key={c.key} cover={c} change={buffChange.get(c.key)} />)}</ul>
                        </section>
                    )}
                    {buffs.party.length > 0 && (
                        <section>
                            <h3 className="kicker">{t("kader.composition.partyBuffs")}</h3>
                            <ul className="kp-comp-buffs">{buffs.party.map((c) => <BuffLine key={c.key} cover={c} change={buffChange.get(c.key)} />)}</ul>
                        </section>
                    )}
                </aside>
            </div>
        </div>
    );
}
