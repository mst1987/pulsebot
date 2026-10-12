import { useState, type KeyboardEvent } from "react";
import type { SetupCharacter, SetupPerson } from "../../../api";
import { useT } from "../../../i18n";
import { ChevronDownIcon, SearchIcon } from "../../../components/ui/icons";
import { asCharacter, fitsRole, leadIn } from "../../../lib/signups/setupEditor";
import { wowIconUrl } from "../../../lib/wow/wowIcon";
import { specLabel } from "../../../lib/wow/wowNames";
import { classColorProps } from "../../../components/character/ClassSpec";
import SpecTile from "../SpecTile";
import { CharacterNumber, Slot, type Interaction } from "./Board";
import { useZone } from "./useZone";
import { matchesQuery, statusLabel } from "./setupText";

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

const SECTIONS = ["tank", "healer", "melee", "ranged"] as const;
type Filter = "all" | "tank" | "healer" | "dps";

const inFilter = (p: SetupPerson, filter: Filter) => filter === "all"
    || (filter === "dps" ? fitsRole(p, "melee") || fitsRole(p, "ranged") : fitsRole(p, filter));

/** The role blocks a filter shows. */
const blocksOf = (filter: Filter) => SECTIONS.filter((role) => filter === "all" || (filter === "dps" ? role === "melee" || role === "ranged" : role === filter));

/**
 * A further character of a person in "Angemeldet" (#293): quiet (not bold), with its
 * spec icon, its order number and its own status dot where it differs from the card's
 * line. A line of its own to drag or pick — a move takes exactly this character.
 */
function CharacterLine({ p, c, ui, leadStatus }: { p: SetupPerson; c: SetupCharacter; ui: Interaction; leadStatus: string }) {
    const t = useT();
    const color = classColorProps(c.classColor);
    const held = ui.held?.[p.userId];
    const movable = ui.editable && !held;
    const selected = ui.selected === p.userId && (ui.selectedCharacter || "") === c.character;
    const spec = specLabel(c.spec, c.specLabel || c.spec);
    const differs = (c.status || "signed") !== (leadStatus || "signed");
    const status = statusLabel(c.status) || t("setup.chars.signed");
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
            onMouseEnter={() => ui.onInspect(p.userId)}
            onClick={ui.editable ? pick : undefined}
            onKeyDown={movable ? keyDown : undefined}
            onDragStart={movable ? (e) => { e.stopPropagation(); e.dataTransfer.setData("text/plain", p.userId); e.dataTransfer.effectAllowed = "move"; setTimeout(() => ui.onDrag(p.userId, c.character), 0); } : undefined}
            onDragEnd={ui.editable ? () => ui.onDrag(null) : undefined}
        >
            <CharacterNumber order={c.priority + 1} />
            <SpecTile iconUrl={c.specIcon ? wowIconUrl(c.specIcon, 36) : undefined} classColor={c.classColor} size="sm" />
            <span className="se-alt-text">
                <span className={`se-alt-name ${color.className || ""}`} style={color.style}>{c.character}</span>
                <span className="se-alt-spec">{spec}</span>
            </span>
            {differs && <span className={`rd-sig rd-sig-${c.status || "signed"} se-alt-sig${c.status && c.status !== "signed" ? "" : " se-sig-signed"}`} role="img" aria-label={status} data-tip={status} />}
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
    const [collapsed, setCollapsed] = useState(false);
    const zone = useZone({ pool: true }, ui);
    const canTake = ui.editable && !!ui.selected && !pool.some((p) => p.userId === ui.selected);
    const picking = !!ui.selected && pool.some((p) => p.userId === ui.selected);
    // persons, not characters: somebody with a tank and a healer counts once in "Alle" and once per role chip
    const count = (f: Filter) => pool.filter((p) => inFilter(p, f)).length;
    const shown = pool.filter((p) => inFilter(p, filter) && matchesQuery(p, query));
    // a person stands in every block one of their characters fits, led there by that character;
    // a role nobody signed up for is no section; anything unknown goes with the ranged
    const sections = blocksOf(filter)
        .map((role) => ({ role, people: shown.map((p) => ({ p, lead: leadIn(p, role) })).filter((x) => x.lead !== null) }))
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
                        <div className="se-pp-filters" role="group" aria-label={t("setup.poolPanel.filter")}>
                            {filters.map((f) => (
                                <button key={f} type="button" className={`se-pp-chip${filter === f ? " is-on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                                    {t(`setup.poolPanel.filters.${f}`)} <small>{count(f)}</small>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                <div className="se-pp-sections">
                    {sections.map((s) => (
                        <div key={s.role} className="se-pp-sec" role="group" aria-label={t(`setup.poolPanel.sections.${s.role}`)}>
                            <div className="se-pp-sec-head">{t(`setup.poolPanel.sections.${s.role}`)} <small>{s.people.length}</small></div>
                            <div className="se-pp-grid">
                                {s.people.map(({ p, lead }) => <PoolCard key={p.userId} p={p} lead={lead || undefined} ui={ui} />)}
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
