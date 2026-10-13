import { Fragment, useState, type KeyboardEvent } from "react";
import type { SetupCharacter, SetupPerson } from "../../../api";
import { useT } from "../../../i18n";
import { ChevronDownIcon, SearchIcon } from "../../../components/ui/icons";
import { asCharacter, fitsRole, leadIn } from "../../../lib/signups/setupEditor";
import { wowIconUrl } from "../../../lib/wow/wowIcon";
import { specLabel } from "../../../lib/wow/wowNames";
import { classColorProps } from "../../../components/character/ClassSpec";
import SpecTile from "../SpecTile";
import { CharacterNumber, SigBadge, SigIcon, Slot, type Interaction } from "./Board";
import { peekHandlers } from "./peek";
import { useZone } from "./useZone";
import { MARKED_STATUSES, markedStatus, matchesQuery, statusRank, type MarkedStatus } from "./setupText";

// "Angemeldet" (#517): everybody signed up who is neither in a group nor on the
// bench — where the setup starts from, since the editor no longer needs a
// proposal first. A panel of its own beside the groups, by role (tank, healer,
// melee, ranged) with a search and role filters, so dragging is a short way.
// Where the editor is too narrow for a side column it docks at the bottom of the
// window instead (setup-editor.css, container query): one row to scroll sideways,
// folded away by its arrow — and folded by itself while a raider of it is picked,
// so the free places to tap stay in view. The whole panel is a drop zone: a raider
// dropped here leaves the setup again. Never posted.
//
// Several characters (#293): a person is ONE card — one seat, counted once in the
// head — with every character they signed up with: the one leading the card on
// the line, the others as quiet lines under it, each with its order number and
// draggable on its own (a drag or pick takes exactly that character). A person
// stands in every role block one of their characters fits, led there by that
// character — like the signup message's "same number" rule.
//
// Signup states at a glance: a late, tentative or bench signup carries a labelled
// square field in its colour on the card (Board.tsx' SigBadge); inside each role
// block the plain signups come first, then late, tentative, bench, each after a
// thin divider with its name; status chips beside the role chips show only one state.

const SECTIONS = ["tank", "healer", "melee", "ranged"] as const;
type Filter = "all" | "tank" | "healer" | "dps";

const inFilter = (p: SetupPerson, filter: Filter) => filter === "all"
    || (filter === "dps" ? fitsRole(p, "melee") || fitsRole(p, "ranged") : fitsRole(p, filter));

/** Whether a person signed up with this state — as they stand or with any of their characters. */
const hasStatus = (p: SetupPerson, status: MarkedStatus | null) => !status
    || markedStatus(p.status) === status || (p.characters || []).some((c) => markedStatus(c.status) === status);

/** The role blocks a filter shows. */
const blocksOf = (filter: Filter) => SECTIONS.filter((role) => filter === "all" || (filter === "dps" ? role === "melee" || role === "ranged" : role === filter));

/** The state of the line that leads a person's card in a block: that character's, or theirs as they stand. */
function lineStatus(p: SetupPerson, lead: SetupCharacter | null | undefined): string {
    if (lead && lead.character.toLowerCase() !== p.character.toLowerCase()) return lead.status || "signed";
    return p.status || "signed";
}

/**
 * A further character of a person in "Angemeldet" (#293): quiet (not bold), with its
 * spec icon, its order number and a small state field where its state differs from the
 * card's line. A line of its own to drag or pick — a move takes exactly this character.
 */
function CharacterLine({ p, c, ui, leadStatus }: { p: SetupPerson; c: SetupCharacter; ui: Interaction; leadStatus: string }) {
    const t = useT();
    const color = classColorProps(c.classColor);
    const held = ui.held?.[p.userId];
    const movable = ui.editable && !held;
    const selected = ui.selected === p.userId && (ui.selectedCharacter || "") === c.character;
    const spec = specLabel(c.spec, c.specLabel || c.spec);
    const differs = (markedStatus(c.status) || "signed") !== (markedStatus(leadStatus) || "signed");
    const pick = () => (held ? ui.onHeld?.(p.userId) : ui.onPick(p.userId, c.character));
    const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        pick();
    };
    return (
        <div
            className={`se-alt${selected ? " se-picked" : ""}${ui.dragging === p.userId ? " se-dragging" : ""}`}
            role={ui.editable ? "button" : undefined}
            tabIndex={ui.editable ? 0 : undefined}
            aria-pressed={ui.editable ? selected : undefined}
            aria-label={t("setup.chars.lineAria", { character: c.character, spec, n: c.priority + 1 })}
            data-user={p.userId}
            data-character={c.character}
            draggable={movable}
            {...peekHandlers(ui, p.userId, c.character)}
            onClick={ui.editable ? pick : undefined}
            onKeyDown={movable ? keyDown : undefined}
            onDragStart={movable ? (e) => { e.stopPropagation(); ui.onLeave?.(); e.dataTransfer.setData("text/plain", p.userId); e.dataTransfer.effectAllowed = "move"; setTimeout(() => ui.onDrag(p.userId, c.character), 0); } : undefined}
            onDragEnd={ui.editable ? () => ui.onDrag(null) : undefined}
        >
            <CharacterNumber order={c.priority + 1} />
            <SpecTile iconUrl={c.specIcon ? wowIconUrl(c.specIcon, 36) : undefined} classColor={c.classColor} size="sm" />
            <span className="se-alt-text">
                <span className={`se-alt-name ${color.className || ""}`} style={color.style}>{c.character}</span>
                <span className="se-alt-spec">{spec}</span>
            </span>
            {differs && <SigBadge status={c.status} small />}
        </div>
    );
}

/**
 * One person in a role block: their leading character on the line (as they stand,
 * or the character that fits this block), their other characters under it.
 */
function PoolCard({ p, lead, ui }: { p: SetupPerson; lead: SetupCharacter | undefined; ui: Interaction }) {
    const characters = p.characters || [];
    if (characters.length < 2) return <Slot p={p} ui={ui} inPool />;
    const standing = characters.find((c) => c.character.toLowerCase() === p.character.toLowerCase());
    const leading = lead || standing;
    // `as` only when the line is not the character they stand as: a drag of the plain line keeps the default
    const as = lead && lead !== standing ? lead.character : undefined;
    const shown = lead && as ? asCharacter(p, lead) : p;
    const others = characters.filter((c) => c !== leading);
    return (
        <div className="se-pp-person">
            <Slot p={shown} ui={ui} inPool as={as} order={leading ? leading.priority + 1 : undefined} />
            <div className="se-alts">
                {others.map((c) => <CharacterLine key={c.character} p={p} c={c} ui={ui} leadStatus={shown.status || ""} />)}
            </div>
        </div>
    );
}

export function PoolPanel({ pool, ui, absent = 0 }: { pool: SetupPerson[]; ui: Interaction; absent?: number }) {
    const t = useT();
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("all");
    const [status, setStatus] = useState<MarkedStatus | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const zone = useZone({ pool: true }, ui);
    const canTake = ui.editable && !!ui.selected && !pool.some((p) => p.userId === ui.selected);
    const picking = !!ui.selected && pool.some((p) => p.userId === ui.selected);
    // persons, not characters: somebody with a tank and a healer counts once in "Alle" and once per role chip
    const count = (f: Filter) => pool.filter((p) => inFilter(p, f)).length;
    const statusCount = (s: MarkedStatus) => pool.filter((p) => hasStatus(p, s)).length;
    // a state chip only while somebody signed up so; a chip switched on stays (its count may drop to 0 after a move)
    const statusChips = MARKED_STATUSES.filter((s) => statusCount(s) > 0 || status === s);
    const shown = pool.filter((p) => inFilter(p, filter) && hasStatus(p, status) && matchesQuery(p, query));
    // a person stands in every block one of their characters fits, led there by that character;
    // a role nobody signed up for is no section; anything unknown goes with the ranged.
    // Inside a block: plain signups first, then late, tentative, bench (stable, the server's order within each)
    const sections = blocksOf(filter)
        .map((role) => ({
            role,
            people: shown
                .map((p) => ({ p, lead: leadIn(p, role) }))
                .filter((x) => x.lead !== null)
                .map((x) => ({ ...x, st: markedStatus(lineStatus(x.p, x.lead)) }))
                .sort((a, b) => statusRank(a.st) - statusRank(b.st)),
        }))
        .filter((s) => s.people.length);
    const filters: Filter[] = ["all", "tank", "healer", "dps"];
    return (
        <section
            className={`se-poolpanel${zone.over ? " se-over" : ""}${canTake ? " se-target" : ""}${collapsed ? " se-pp-collapsed" : ""}${picking ? " se-pp-picking" : ""}${pool.length ? "" : " se-pp-none"}`}
            {...zone.props}
            aria-label={t("setup.pool.aria")}
        >
            <header className="se-pp-head">
                <span className="se-pp-title" data-tip={t("setup.pool.title")} data-tip-sub={t("setup.pool.tip")}>
                    {t("setup.pool.title")} <b className="se-pp-count">{pool.length}</b>
                </span>
                <span className="se-pp-sub">{t("setup.poolPanel.notPlaced")}</span>
                {canTake && (
                    <button type="button" className="se-ph se-ph-take se-pp-take" onClick={() => ui.onDrop({ pool: true })}>{t("setup.poolPanel.back")}</button>
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
                    <div className="se-pp-tools">
                        <label className="se-pp-search">
                            <SearchIcon />
                            <input type="search" value={query} placeholder={t("setup.poolPanel.search")} aria-label={t("setup.poolPanel.search")} onChange={(e) => setQuery(e.target.value)} />
                        </label>
                        <div className="se-pp-filterrow">
                            <div className="se-pp-filters" role="group" aria-label={t("setup.poolPanel.filter")}>
                                {filters.map((f) => (
                                    <button key={f} type="button" className={`se-pp-chip${filter === f ? " is-on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                                        {t(`setup.poolPanel.filters.${f}`)} <small>{count(f)}</small>
                                    </button>
                                ))}
                            </div>
                            {statusChips.length > 0 && (
                                <div className="se-pp-filters se-pp-stfilters" role="group" aria-label={t("setup.poolPanel.statusFilter")}>
                                    {statusChips.map((s) => {
                                        const label = t(`setup.sig.short.${s}`);
                                        return (
                                            <button
                                                key={s} type="button" className={`se-pp-chip se-pp-stchip se-sigv-${s}${status === s ? " is-on" : ""}`} aria-pressed={status === s}
                                                data-tip={t("setup.poolPanel.statusChipTip", { status: label })} data-tip-sub={t("setup.poolPanel.statusChipSub")}
                                                onClick={() => setStatus((cur) => (cur === s ? null : s))}
                                            >
                                                <SigIcon status={s} />{label} <small>{statusCount(s)}</small>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
                <div className="se-pp-sections">
                    {sections.map((s) => (
                        <div key={s.role} className="se-pp-sec" role="group" aria-label={t(`setup.poolPanel.sections.${s.role}`)}>
                            <div className="se-pp-sec-head">{t(`setup.poolPanel.sections.${s.role}`)} <small>{s.people.length}</small></div>
                            <div className="se-pp-grid">
                                {s.people.map(({ p, lead, st }, i) => {
                                    // a thin divider with the state's name where late / tentative / bench begin
                                    const starts = !!st && (i === 0 || s.people[i - 1].st !== st);
                                    const label = st ? t("setup.poolPanel.statusHead", { status: t(`setup.sig.short.${st}`), count: s.people.filter((x) => x.st === st).length }) : "";
                                    return (
                                        <Fragment key={p.userId}>
                                            {starts && (
                                                <div className={`se-pp-divider se-sigv-${st}`} role="separator" aria-label={label}>
                                                    <SigIcon status={st} /><span>{label}</span>
                                                </div>
                                            )}
                                            <PoolCard p={p} lead={lead || undefined} ui={ui} />
                                        </Fragment>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    {!pool.length && <p className="se-pp-empty">{t("setup.pool.empty")}</p>}
                    {pool.length > 0 && !shown.length && <p className="se-pp-empty">{t("setup.poolPanel.noMatch")}</p>}
                </div>
                {absent > 0 && <p className="se-pp-absent">{t("setup.poolPanel.absent", { count: absent })}</p>}
            </div>
        </section>
    );
}
