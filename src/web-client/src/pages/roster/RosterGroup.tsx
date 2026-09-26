import { useState } from "react";
import { Link } from "react-router-dom";
import type { RosterChar, RosterHiddenNote } from "../../api";
import { sortRows, type Dir } from "../../lib/tableSort";
import { ClassSpecIdentity } from "../../components/ClassSpec";
import { AttendanceBar, GearStateBadge, IconLink, LootBadge, RoleBadge } from "../../components/RosterCommon";
import { SortLabel } from "../../components/SortTh";
import { ROLE_ORDER } from "../../lib/rosterView";
import { Badge, Expand, IconButton, IconTile } from "../../components/ui";
import { ChevronDownIcon, EyeIcon, EyeOffIcon } from "../../components/icons";
import { formatDate } from "../../lib/format";
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
                            size="sm" tip="Ausgeblendet"
                            tipSub={`${hidden.by ? `Von ${hidden.by}, ` : ""}seit ${formatDate(hidden.at)}${hidden.reason ? ` · ${hidden.reason}` : ""}`}
                        >
                            ausgeblendet
                        </Badge>
                    )
                    : !c.assigned && !!c.lootCount && (
                        <Badge tone="accent" size="sm" tip="nur Loot" tipSub="Nur aus dem Loot bekannt — noch keinem Raider in dieser Kategorie zugeordnet.">
                            nur Loot
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
                            size="sm" icon={<EyeIcon />} tip="Wieder ins Roster"
                            tipSub="Der Charakter taucht wieder in den Listen und in den Zahlen oben auf."
                            onClick={() => onHide(c, false)}
                        />
                    )
                    : (
                        <IconButton
                            size="sm" icon={<EyeOffIcon />} tip="Ausblenden"
                            tipSub="Nimmt den Charakter aus den Listen und den Zahlen oben — Loot, Auswertungen und die Charakter-Seite bleiben unverändert."
                            onClick={() => onHide(c, true)}
                        />
                    ))}
            </span>
            <Link className="exp-lbl ros-open" to={charHref(c)}>
                <span>Öffnen</span>
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
    const head = (sortKey: SortKey, label: string, tip: string, tipSub: string) => (
        <SortLabel<SortKey> sortKey={sortKey} label={label} sort={sort} dir={dir} onSort={onSort} tip={tip} tipSub={tipSub} />
    );
    return (
        <div className="ros-cols">
            <span />
            {head("name", "Charakter", "Charakter", "Name in Klassenfarbe, darunter die Spec. Klick öffnet die Charakter-Seite.")}
            {head("role", "Rolle", "Rolle", "Die Rolle aus dem neuesten Log, in dem der Charakter vorkommt; ohne Log aus der Spec.")}
            {head("attendance", "Anwesenheit", "Anwesenheit", "Die letzten 11 Raids dieser Kategorie: im Log = da; ohne Log zählt die Raid-Helper-Anmeldung des zugeordneten Raiders.\nGrün ab 80 %, gelb ab 60 %.")}
            {head("gear", "Gear-Stand", "Gear-Stand", "Befunde aus der neuesten Log-Auswertung, in der der Charakter vorkommt: fehlende Verzauberung, leere Sockel, inaktiver Meta-Gem.\n„nicht ausgewertet“ = in keiner gespeicherten Auswertung.")}
            {head("loot", "Loot", "Loot", "Importierte Items dieses Charakters; die neuesten im Tooltip.")}
            <span className="ros-cols-links">Links</span>
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
                <Badge count tip={`${chars.length} Charakter${chars.length === 1 ? "" : "e"}`}>{chars.length}</Badge>
                {!!withIssues && (
                    <Badge tone={high ? "bad" : "mid"} icon="inv_misc_gem_variety_02">{withIssues} mit Gear-Problemen</Badge>
                )}
                <Expand open={open} onToggle={onToggle} showLabel={!open} label="Details" />
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
                                {showAll ? "Weniger zeigen" : `${chars.length - GROUP_PREVIEW} weitere zeigen`}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
