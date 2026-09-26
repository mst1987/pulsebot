import { useState } from "react";
import { Link } from "react-router-dom";
import type { RosterChar, RosterHiddenNote } from "../../api";
import { sortRows, type Dir } from "../../lib/tableSort";
import { ClassSpecIdentity } from "../../components/ClassSpec";
import { AttendanceBar, GearStateBadge, IconLink, LootBadge, RoleBadge } from "../../components/roster/RosterCommon";
import { SortLabel } from "../../components/SortTh";
import { ROLE_ORDER } from "../../lib/rosterView";
import { Badge, Expand, IconButton, IconTile } from "../../components/ui";
import { ChevronDownIcon, EyeIcon, EyeOffIcon } from "../../components/icons";
import { formatDate } from "../../lib/format";
import { tParts, useT } from "../../i18n";
import type { SortKey } from "./RosterPage";

/** Rows a long group shows before "n weitere zeigen". */
const GROUP_PREVIEW = 11;

export const UNGROUPED = "__none";

function charHref(c: RosterChar, tab = ""): string {
    return `/roster/char?name=${encodeURIComponent(c.character)}${tab ? `&tab=${tab}` : ""}`;
}

function RosterRow({ c, categoryId, categoryName, hidden, onHide }: {
    c: RosterChar;
    categoryId: string;
    categoryName: string;
    /** Set on a row of the "Ausgeblendet" list: when and by whom. */
    hidden?: RosterHiddenNote;
    /** Missing when the visitor may only read the roster. */
    onHide?: (c: RosterChar, hide: boolean) => void;
}) {
    const t = useT();
    return (
        <div className="ros-row">
            <ClassSpecIdentity
                character={c.character}
                className={c.className}
                spec={c.spec}
                classColor={c.classColor}
                iconUrl={c.iconUrl}
                to={charHref(c)}
                extra={hidden
                    ? (
                        <Badge
                            size="sm" tip={t("roster.row.hiddenTip")}
                            tipSub={`${hidden.by ? t("roster.row.hiddenBy", { by: hidden.by, date: formatDate(hidden.at) }) : t("roster.row.hiddenSince", { date: formatDate(hidden.at) })}${hidden.reason ? ` · ${hidden.reason}` : ""}`}
                        >
                            {t("roster.row.hiddenBadge")}
                        </Badge>
                    )
                    : !c.assigned && !!c.lootCount && (
                        <Badge tone="accent" size="sm" tip={t("roster.row.lootOnly")} tipSub={t("roster.row.lootOnlySub")}>
                            {t("roster.row.lootOnly")}
                        </Badge>
                    )}
            />
            <span className="ros-cell"><RoleBadge role={c.role} /></span>
            <span className="ros-cell">
                {categoryId === UNGROUPED
                    ? <span className="sub">–</span>
                    : <AttendanceBar attendance={c.attendance?.[categoryId]} categoryName={categoryName} />}
            </span>
            <span className="ros-cell"><GearStateBadge gear={c.gear} /></span>
            <span className="ros-cell"><LootBadge count={c.lootCount} items={c.items || []} to={charHref(c, "loot")} /></span>
            <span className="ros-acts">
                <IconLink href={c.wclUrl} icon="inv_misc_pocketwatch_01" tip="Warcraft Logs" />
                <IconLink href={c.armoryUrl} icon="inv_shirt_guildtabard_01" tip="Armory" />
                {onHide && (hidden
                    ? (
                        <IconButton
                            size="sm" icon={<EyeIcon />} tip={t("roster.row.unhide")}
                            tipSub={t("roster.row.unhideSub")}
                            onClick={() => onHide(c, false)}
                        />
                    )
                    : (
                        <IconButton
                            size="sm" icon={<EyeOffIcon />} tip={t("roster.hide.action")}
                            tipSub={t("roster.row.hideSub")}
                            onClick={() => onHide(c, true)}
                        />
                    ))}
            </span>
            <Link className="exp-lbl ros-open" to={charHref(c)}>
                <span>{t("common.open")}</span>
                <span className="exp go" aria-hidden="true"><ChevronDownIcon /></span>
            </Link>
        </div>
    );
}

// The column head is the sort control (SortLabel, the same one the loot council
// uses over its grid): a roster is read down a column — who was there least,
// who has the most open gear findings — and clicking the head is where everyone
// tries that first. The explanation stays in the head's tooltip.
function GroupColumns({ sort, dir, onSort }: { sort: SortKey; dir: Dir; onSort: (key: SortKey) => void }) {
    const t = useT();
    // label and tooltip title are the same word
    const head = (sortKey: SortKey, label: string, tipSub: string) => (
        <SortLabel<SortKey> sortKey={sortKey} label={label} sort={sort} dir={dir} onSort={onSort} tip={label} tipSub={tipSub} />
    );
    return (
        <div className="ros-cols">
            <span />
            {head("name", t("roster.cols.name"), t("roster.cols.nameSub"))}
            {head("role", t("roster.cols.role"), t("roster.cols.roleSub"))}
            {head("attendance", t("roster.cols.attendance"), t("roster.cols.attendanceSub"))}
            {head("gear", t("roster.cols.gear"), t("roster.cols.gearSub"))}
            {head("loot", t("roster.cols.loot"), t("roster.cols.lootSub"))}
            <span className="ros-cols-links">{t("roster.cols.links")}</span>
            <span />
        </div>
    );
}

export function RosterGroup({ id, title, crumb, icon, chars, open, onToggle, sort, dir, onSort, hiddenNotes, onHide }: {
    id: string;
    title: string;
    crumb: string;
    icon: string;
    chars: RosterChar[];
    open: boolean;
    onToggle: () => void;
    sort: SortKey;
    dir: Dir;
    onSort: (key: SortKey) => void;
    /** Only the hidden list passes these — per character key, since when. */
    hiddenNotes?: Record<string, RosterHiddenNote>;
    onHide?: (c: RosterChar, hide: boolean) => void;
}) {
    const t = useT();
    const [showAll, setShowAll] = useState(false);
    const withIssues = chars.filter((c) => c.gear && c.gear.issueCount).length;
    const high = chars.some((c) => c.gear && c.gear.issues.some((i) => i.severity === "high"));
    // Sorted per group: the attendance column measures against *this* category.
    const sorted = sortRows(chars, (c) => {
        switch (sort) {
            case "role": return ROLE_ORDER[c.role] ?? 3;
            // no nights counted sorts below 0 %, never above it
            case "attendance": return c.attendance?.[id]?.pct ?? -1;
            case "gear": return c.gear ? c.gear.issueCount : -1;
            case "loot": return c.lootCount || 0;
            default: return c.character.toLowerCase();
        }
    }, dir);
    const shown = showAll ? sorted : sorted.slice(0, GROUP_PREVIEW);
    return (
        <section className={`ros-grp${open ? " is-open" : ""}`}>
            <div className="ros-grp-head">
                <IconTile icon={icon} tone={id === UNGROUPED ? "none" : "roster"} />
                <div className="ros-grp-title">
                    <span>{title}</span>
                    <span className="kicker">{crumb}</span>
                </div>
                <Badge count tip={t("roster.group.count", { count: chars.length })}>{chars.length}</Badge>
                {!!withIssues && (
                    <Badge tone={high ? "bad" : "mid"} icon="inv_misc_gem_variety_02">{tParts("roster.group.withIssues", { count: withIssues })}</Badge>
                )}
                <Expand open={open} onToggle={onToggle} showLabel={!open} label={t("roster.group.details")} />
            </div>
            {open && (
                <div className="ros-list">
                    <GroupColumns sort={sort} dir={dir} onSort={onSort} />
                    {shown.map((c) => (
                        <RosterRow
                            key={c.key} c={c} categoryId={id} categoryName={title}
                            hidden={hiddenNotes?.[c.key]} onHide={onHide}
                        />
                    ))}
                    {chars.length > GROUP_PREVIEW && (
                        <div className="ros-more">
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)}>
                                {showAll ? t("roster.group.showLess") : t("roster.group.showMore", { count: chars.length - GROUP_PREVIEW })}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
