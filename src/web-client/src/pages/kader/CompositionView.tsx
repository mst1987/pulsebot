// "Zusammensetzung" (docs/kaderplaner.md): who of Vorläufig and Roster plays which
// class, spec and role, grouped by class — the count of each role in one line with
// the rule set's guide for the nearest setup size, and the raid and party buffs the
// counted players bring (or that are missing). Bench and tentative show greyed out
// and count only with the switch, remembered per Kader. Read-only: nothing here
// writes; the decision page sets the specs.
import type { KaderRole, KaderState } from "../../api";
import { Switch } from "../../components/ui";
import { RosterIcon } from "../../components/ui/icons";
import { useT } from "../../i18n";
import { usePersistedState } from "../../lib/ui/persistedState";
import { useTableSort, type Dir } from "../../lib/ui/tableSort";
import { classColor, className, playerName, ROLES, specName } from "../../lib/kader/model";
import { pickParts, sortTable, type SortParts } from "../../lib/kader/sort";
import { buffLabel } from "../../lib/kader/setup";
import { buffCoverage, buffSources, composition, nearestSize, type BuffCover, type CompositionClass, type CompositionRow } from "../../lib/kader/composition";
import { roleLabel, rolePluralLabel } from "../../lib/wow/wowNames";
import { classColorProps } from "../../components/character/ClassSpec";
import { ClassIcon, EmptyState, PlayerAvatar, PickIcon, PlayerName, RoleIcon, SortHead, StateBadge, TableNote, WishIcons } from "./parts";
import { useKader } from "./kaderContext";

type CompSortKey = "name" | "spec" | "role" | "state";
/** Names and specs A–Z, roles tank first, states furthest along first. */
const COMP_SORT: Record<CompSortKey, Dir> = { name: "asc", spec: "asc", role: "asc", state: "desc" };
const STATE_RANK: Partial<Record<KaderState, number>> = { bench: 0, tentative: 1, provisional: 2, roster: 3 };

/** "1 Tank", "5 Heiler" — a number always with its word. */
function roleCount(role: KaderRole, n: number): string {
    return `${n} ${n === 1 ? roleLabel(role) : rolePluralLabel(role)}`;
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

function CompRow({ row }: { row: CompositionRow }) {
    const t = useT();
    const { userId, entry, pick, role, counted } = row;
    return (
        <div className={`kp-trow kp-comp-grid${counted ? "" : " kp-comp-off"}`} role="row">
            <span role="cell" className="kp-cell-who">
                <PlayerAvatar userId={userId} entry={entry} />
                <span className="kp-cell-name">
                    <PlayerName userId={userId} entry={entry} />
                    {!counted && <span className="kp-sub">{t("kader.composition.notCounted")}</span>}
                </span>
            </span>
            <span role="cell">
                {pick && pick.spec ? <SpecCell pick={pick} /> : <span className="kp-muted">{t("kader.composition.noSpecRow")}</span>}
            </span>
            <span role="cell" className="kp-comp-role">
                {role ? <><RoleIcon role={role} size={18} /><span className="kp-comp-rolename">{roleLabel(role)}</span></> : <span className="kp-muted">–</span>}
            </span>
            <span role="cell"><StateBadge state={entry.state} /></span>
            <span role="cell" className="kp-comp-wishes"><WishIcons wishes={entry.wishes} size={18} /></span>
        </div>
    );
}

function ClassHead({ group }: { group: CompositionClass }) {
    const t = useT();
    const { view } = useKader();
    const color = classColorProps(group.classKey ? classColor(view.classes, group.classKey) : "");
    const off = group.shown - group.counted;
    return (
        <div className="kp-trow kp-comp-class" role="row">
            <span role="cell" className="kp-comp-classcell">
                {group.classKey && <ClassIcon classKey={group.classKey} size={18} />}
                <b className={color.className} style={color.style}>{group.classKey ? className(view.classes, group.classKey) : t("kader.composition.noClass")}</b>
                <span className="kp-muted">{t("kader.composition.classCount", { count: group.counted })}</span>
                {off > 0 && <span className="kp-muted">{t("kader.composition.classExtra", { count: off })}</span>}
            </span>
        </div>
    );
}

/** Who can bring a buff: whole classes by name, else the spec names; the counted donors in the tooltip. */
function BuffLine({ cover }: { cover: BuffCover }) {
    const t = useT();
    const { view, kader } = useKader();
    const sources = buffSources(view.classes, cover.providers)
        .map((s) => (s.specs ? s.specs.map((k) => specName(view.classes, k)).join(", ") : className(view.classes, s.classKey)))
        .join(" · ");
    const has = cover.donors.length > 0;
    const names = cover.donors.map((id) => playerName(view, id, kader.players[id])).join(", ");
    return (
        <li className="kp-comp-buff">
            <span className="kp-comp-buffname">{buffLabel(cover.buff)}</span>
            {has
                ? <span className="kp-comp-have" data-tip={names}>{t("kader.composition.donors", { count: cover.donors.length })}</span>
                : <span className="kp-comp-miss">{t("kader.composition.missing")}</span>}
            <span className="kp-sub kp-comp-src">{sources}</span>
        </li>
    );
}

export default function CompositionView() {
    const t = useT();
    const { view, kader } = useKader();
    const [extraMap, setExtraMap] = usePersistedState<Record<string, boolean>>("kader-composition-extra", {});
    const withExtra = !!extraMap[kader.id];
    const sort = useTableSort<CompSortKey>("kader-composition-sort", COMP_SORT, "name");
    const comp = composition(view, kader, withExtra);
    const buffs = buffCoverage(view, comp.rows);

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

    return (
        <div className="kp-view kp-comp">
            <div className="kp-toolbar kp-comp-bar">
                <p className="kp-comp-sum" aria-live="polite">
                    {roleParts.join(" · ")}
                    {" · "}<b>{t("kader.composition.players", { count: comp.total })}</b>
                    {comp.noSpec > 0 && <span className="kp-comp-nospec" data-tip={t("kader.composition.noSpecTip")}>{" · "}{t("kader.composition.noSpec", { count: comp.noSpec })}</span>}
                </p>
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
                <div className="kp-panel kp-table kp-scroll-x kp-comp-table" role="table" aria-label={t("kader.composition.tableLabel", { name: kader.name })}>
                    <div className="kp-trow kp-thead kp-comp-grid" role="row">
                        <SortHead sortKey="name" label={t("kader.composition.colPlayer")} sort={sort} />
                        <SortHead sortKey="spec" label={t("kader.composition.colSpec")} sort={sort} tip={t("kader.composition.colSpec")} tipSub={t("kader.composition.specSub")} />
                        <SortHead sortKey="role" label={t("kader.composition.colRole")} sort={sort} />
                        <SortHead sortKey="state" label={t("kader.composition.colState")} sort={sort} />
                        <span role="columnheader" className="kp-th kp-comp-wishes"><span className="kicker">{t("kader.composition.colWishes")}</span></span>
                    </div>
                    {comp.rows.length === 0 && (
                        <TableNote><EmptyState icon={<RosterIcon />} text={t("kader.composition.empty")} /></TableNote>
                    )}
                    {comp.classes.map((g) => (
                        <div key={g.classKey || "-"} role="rowgroup" className="kp-comp-group">
                            <ClassHead group={g} />
                            {sorted(g.rows).map((r) => <CompRow key={r.userId} row={r} />)}
                        </div>
                    ))}
                </div>
                <aside className="kp-comp-side" aria-label={t("kader.composition.buffs")}>
                    {!buffs.raid.length && !buffs.party.length && <p className="kp-muted">{t("kader.composition.noBuffs")}</p>}
                    {buffs.raid.length > 0 && (
                        <section>
                            <h3 className="kicker">{t("kader.composition.raidBuffs")}</h3>
                            <ul className="kp-comp-buffs">{buffs.raid.map((c) => <BuffLine key={c.key} cover={c} />)}</ul>
                        </section>
                    )}
                    {buffs.party.length > 0 && (
                        <section>
                            <h3 className="kicker">{t("kader.composition.partyBuffs")}</h3>
                            <ul className="kp-comp-buffs">{buffs.party.map((c) => <BuffLine key={c.key} cover={c} />)}</ul>
                        </section>
                    )}
                </aside>
            </div>
        </div>
    );
}
