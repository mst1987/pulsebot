import { Fragment, useState } from "react";
import type { SetupPerson } from "../../../api";
import { useT } from "../../../i18n";
import { ChevronDownIcon, SearchIcon } from "../../../components/ui/icons/icons";
import Switch from "../../../components/ui/form/Switch";
import { asCharacter, poolRole } from "../../../lib/signups/setupEditor";
import { SigIcon, Slot, type Interaction } from "./Board";
import { useZone } from "./useZone";
import { MARKED_STATUSES, markedStatus, matchesQuery, specText, statusLabel, statusRank, type MarkedStatus } from "./setupText";

// "Angemeldet" (#517): everybody signed up who is neither in a group nor on the
// bench — where the setup starts from. The whole panel is a drop zone: a raider
// dropped here leaves the setup again. Never posted.
//
// A (default, head variant B of the setup canvas): four role columns tanks |
// healer | melee | ranged under the groups and the bench — one line per
// raider (spec icon, name in class colour, spec in grey), no cards; the count in
// the column head, an empty column shows "–". One head line: "Angemeldet" N, the
// status segment (Alle / Spät / Vielleicht / Ersatz), "Nur Leader", the search and
// the fold arrow. While a raider of it is dragged or picked the panel folds to that
// head line, so the free places stay in view.
// B ("Ansicht › Angemeldet als Seitenleiste", `side`): a 300px column left of the
// groups that scrolls on its own, the status word on each line; below 1280px it
// falls back to A (setup-editor.css).
// Narrow (a phone): a sheet docked at the bottom with role tabs ("Tanks 3").
//
// Status: plain signups first in each column, then Spät, Vielleicht, Ersatz as word
// sections at its end. Signed-off raiders never come into the setup — only a line
// "N abgemeldet · kommen nicht ins Setup" with "zeigen".
//
// Several characters (#293): every character stands in its own role's column —
// the one the raider stands as as a plain line, a further one marked "2. Char von
// <first char>" (a drag or pick takes exactly that character). Further characters
// do not count twice: the column head says "+1 Zweitchar".

const SECTIONS = ["tank", "healer", "melee", "ranged"] as const;
type Role = (typeof SECTIONS)[number];

const sameName = (a: string | undefined, b: string | undefined) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

/** Whether a person signed up with this state — as they stand or with any of their characters. */
const hasStatus = (p: SetupPerson, status: MarkedStatus | null) => !status
    || markedStatus(p.status) === status || (p.characters || []).some((c) => markedStatus(c.status) === status);

type Line = { key: string; p: SetupPerson; userId: string; as?: string; note?: string; label?: string; alt: boolean; st: MarkedStatus | "" };
type AltText = { note: (n: number, character: string) => string; label: (shown: SetupPerson, n: number) => string };

/** The lines of one person in one role column: the character they stand as, then each further character of that role. */
function linesOf(p: SetupPerson, role: Role, alt: AltText): Line[] {
    const lines: Line[] = [];
    if (poolRole(p.role) === role) lines.push({ key: p.userId, p, userId: p.userId, alt: false, st: markedStatus(p.status) });
    for (const c of p.characters || []) {
        if (sameName(c.character, p.character) || poolRole(c.role) !== role) continue;
        const shown = asCharacter(p, c);
        const n = c.priority + 1;
        lines.push({ key: `${p.userId}:${c.character}`, p: shown, userId: p.userId, as: c.character, note: alt.note(n, p.character), label: alt.label(shown, n), alt: true, st: markedStatus(c.status) });
    }
    return lines;
}

/**
 * `leaders` (#1036): who may lead this raid (`checks.leader.candidates`) — a "Nur Leader" switch filters to them;
 * without a leader rule (undefined) there is no switch. `absentNames`: the characters of those signed off, shown on demand.
 */
export function PoolPanel({ pool, ui, absent = 0, absentNames, leaders, side = false }: {
    pool: SetupPerson[]; ui: Interaction; absent?: number; absentNames?: string[]; leaders?: string[]; side?: boolean;
}) {
    const t = useT();
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState<MarkedStatus | null>(null);
    const [leadOnly, setLeadOnly] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [showAbsent, setShowAbsent] = useState(false);
    const [tab, setTab] = useState<Role>("tank");
    const leadSet = new Set(leaders || []);
    const leadCount = pool.filter((p) => leadSet.has(p.userId)).length;
    // the switch only while somebody in the pool may lead; switched on it stays (the count may drop to 0)
    const leadSwitch = !!leaders && (leadCount > 0 || leadOnly);
    const zone = useZone({ pool: true }, ui);
    const inPool = (userId: string | null | undefined) => !!userId && pool.some((p) => p.userId === userId);
    const canTake = ui.editable && !!ui.selected && !inPool(ui.selected);
    const picking = inPool(ui.selected);
    const dragging = inPool(ui.dragging);
    const statusCount = (s: MarkedStatus) => pool.filter((p) => hasStatus(p, s)).length;
    // a state only while somebody signed up so; a state switched on stays (its count may drop to 0 after a move)
    const statuses = MARKED_STATUSES.filter((s) => statusCount(s) > 0 || status === s);
    const shown = pool.filter((p) => matchesQuery(p, query) && (!leadOnly || leadSet.has(p.userId)));
    // a further character's line: "2. Char von Zibbo" where the spec stands, its spec in the button's name
    const alt: AltText = {
        note: (n, character) => t("setup.poolPanel.altOf", { n, character }),
        label: (c, n) => t("setup.chars.lineAria", { character: c.character, spec: specText(c), n }),
    };
    // plain signups first, then late, tentative, reserve (stable: the server's order within each)
    const columns = SECTIONS.map((role) => {
        const lines = shown
            .flatMap((p) => linesOf(p, role, alt))
            .filter((l) => !status || l.st === status)
            .sort((a, b) => statusRank(a.st) - statusRank(b.st));
        return { role, lines, main: lines.filter((l) => !l.alt).length, alts: lines.filter((l) => l.alt).length };
    });
    const filtered = !!query.trim() || !!status || leadOnly;
    const nothing = pool.length > 0 && columns.every((c) => !c.lines.length);
    const absentList = absentNames || [];
    return (
        <section
            className={`se-poolpanel${side ? " se-pp-side" : ""}${zone.over ? " se-over" : ""}${canTake ? " se-target" : ""}${collapsed ? " se-pp-collapsed" : ""}${picking ? " se-pp-picking" : ""}${dragging ? " se-pp-dragging" : ""}${pool.length ? "" : " se-pp-none"}`}
            {...zone.props}
            aria-label={t("setup.pool.aria")}
        >
            <header className="se-pp-head">
                <span className="se-pp-title" data-tip={t("setup.pool.title")} data-tip-sub={t("setup.pool.tip")}>
                    {t("setup.pool.title")} <b className="se-pp-count">{pool.length}</b>
                </span>
                {pool.length > 0 && (
                    <div className="se-pp-tools">
                        {statuses.length > 0 && (
                            <div className="se-pp-seg" role="group" aria-label={t("setup.poolPanel.statusFilter")}>
                                <button type="button" className={`se-pp-segbtn${!status ? " is-on" : ""}`} aria-pressed={!status} onClick={() => setStatus(null)}>
                                    {t("setup.poolPanel.statusAll")} <small>{pool.length}</small>
                                </button>
                                {statuses.map((s) => (
                                    <button
                                        key={s} type="button" className={`se-pp-segbtn se-sigv-${s}${status === s ? " is-on" : ""}`} aria-pressed={status === s}
                                        onClick={() => setStatus((cur) => (cur === s ? null : s))}
                                    >
                                        {statusLabel(s)} <small>{statusCount(s)}</small>
                                    </button>
                                ))}
                            </div>
                        )}
                        {leadSwitch && (
                            <Switch
                                className="se-pp-lead" checked={leadOnly} onChange={setLeadOnly}
                                label={<>{t("setup.poolPanel.leadOnly")} <small>{leadCount}</small></>}
                                tipHead={t("setup.poolPanel.leadOnly")} tip={t("setup.poolPanel.leadOnlySub")}
                            />
                        )}
                        <label className="se-pp-search">
                            <SearchIcon />
                            <input type="search" value={query} placeholder={t("setup.poolPanel.search")} aria-label={t("setup.poolPanel.search")} onChange={(e) => setQuery(e.target.value)} />
                        </label>
                    </div>
                )}
                {canTake && (
                    <button type="button" className="se-ph se-ph-take se-pp-take" onClick={() => ui.onDrop({ pool: true })}>{t("setup.group.here")}</button>
                )}
                <button
                    type="button" className="se-pp-toggle" aria-expanded={!collapsed}
                    aria-label={collapsed ? t("setup.poolPanel.expand") : t("setup.poolPanel.collapse")}
                    data-tip={collapsed ? t("setup.poolPanel.expand") : t("setup.poolPanel.collapse")}
                    onClick={() => setCollapsed((c) => !c)}
                >
                    <ChevronDownIcon />
                </button>
            </header>
            <div className="se-pp-body">
                {pool.length > 0 && (
                    <div className="se-pp-tabs" role="tablist" aria-label={t("setup.poolPanel.tabs")}>
                        {columns.map((c) => (
                            <button key={c.role} type="button" role="tab" className={`se-pp-tab${tab === c.role ? " is-on" : ""}`} aria-selected={tab === c.role} onClick={() => setTab(c.role)}>
                                {t(`setup.poolPanel.sections.${c.role}`)} <small>{c.main}</small>
                            </button>
                        ))}
                    </div>
                )}
                {pool.length > 0 && !nothing && (
                    <div className="se-pp-cols">
                        {columns.map((c) => (
                            <div key={c.role} className={`se-pp-col${tab === c.role ? " se-tab" : ""}`} role="group" aria-label={t(`setup.poolPanel.sections.${c.role}`)}>
                                <div className="se-pp-col-head">
                                    <span>{t(`setup.poolPanel.sections.${c.role}`)}</span> <b>{c.main}</b>
                                    {c.alts > 0 && (
                                        <span className="se-pp-alts" data-tip={t("setup.poolPanel.altCount", { count: c.alts })} data-tip-sub={t("setup.poolPanel.altCountSub")}>
                                            {t("setup.poolPanel.altCount", { count: c.alts })}
                                        </span>
                                    )}
                                </div>
                                {!c.lines.length && <div className="se-pp-col-empty" aria-label={t("setup.poolPanel.emptyCol")}>–</div>}
                                {c.lines.map((l, i) => {
                                    // a word section where late / tentative / reserve begin
                                    const starts = !!l.st && (i === 0 || c.lines[i - 1].st !== l.st);
                                    const label = l.st ? t("setup.poolPanel.statusHead", { status: statusLabel(l.st), count: c.lines.filter((x) => x.st === l.st).length }) : "";
                                    return (
                                        <Fragment key={l.key}>
                                            {starts && l.st && (
                                                <div className={`se-pp-divider se-sigv-${l.st}`} role="separator" aria-label={label}>
                                                    <SigIcon status={l.st} /><span>{label}</span>
                                                </div>
                                            )}
                                            <Slot p={l.p} ui={ui} inPool as={l.as} note={l.note} label={l.label} />
                                        </Fragment>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}
                {!pool.length && <p className="se-pp-empty">{t("setup.pool.empty")}</p>}
                {nothing && filtered && <p className="se-pp-empty">{t("setup.poolPanel.noMatch")}</p>}
                {absent > 0 && (
                    <p className="se-pp-absent">
                        <span>{t("setup.poolPanel.absent", { count: absent })}</span>
                        {absentList.length > 0 && (
                            <button type="button" className="se-pp-absent-btn" aria-expanded={showAbsent} onClick={() => setShowAbsent((s) => !s)}>
                                {showAbsent ? t("setup.poolPanel.hideAbsent") : t("setup.poolPanel.showAbsent")}
                            </button>
                        )}
                        {showAbsent && absentList.length > 0 && <span className="se-pp-absent-names">{absentList.join(", ")}</span>}
                    </p>
                )}
            </div>
        </section>
    );
}
