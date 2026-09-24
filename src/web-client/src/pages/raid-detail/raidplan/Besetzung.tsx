import { useState, type PointerEvent } from "react";
import Flyout from "../../../components/raidplan/Flyout";
import { Check, ListChecks, MapPin, Minus, Plus, RotateCcw, Split, Users } from "lucide-react";
import type { Besetzung as BesetzungData, RaidplanBoard, RaidplanPlayer, RaidplanSlot } from "../../../api";
import WowIcon from "../../../components/ui/WowIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { ROLE_ICON } from "../../../lib/assign";
import { assignSlot, besetzungSlots, countOf, effectiveCounts, placeSlot, resetCounts, roleOn, setCount, setFlexRole, unplaceSlot } from "../../../lib/raidplan";
import { useT } from "../../../i18n";

/**
 * The "Besetzung": the role slots of this raid (Tank 1..n, Heiler 1..n, DPS 1..n and the groups) as compact
 * chips with the role icon — there from the start, no dragging onto the board first. The DPS is one number
 * (size - tanks - healers); melee / ranged only exist when they are split (the switch), the rest stays "DPS n".
 * In an event the chips show who stands in them (name, spec icon; open = the role icon) and can be given to
 * somebody else; a player can play another role on this boss (flex). +/- change how many a role has — for this
 * boss only ("nur dieser Boss", back to the raid type's numbers with the arrow). The pin puts a slot on the
 * map (click, or drag it onto the board); everything can be assigned unplaced.
 */
export default function Besetzung({ board, besetzung, roster, isEvent, canWrite, edit, players, onPlaceDown, onChipDown, onShow, onAssign }: {
    board: RaidplanBoard;
    besetzung: BesetzungData;
    roster: RaidplanPlayer[];
    players: Map<string, RaidplanPlayer>;
    isEvent: boolean;
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard) => void;
    /** Pointer down on a slot's pin: the workspace drags it onto the board (no move = put it near the middle). */
    onPlaceDown: (e: PointerEvent<HTMLElement>, slotId: string) => void;
    /** Pointer down on a chip itself: the workspace drags it onto the board (or, when it is placed, back onto the bar to take it off). */
    onChipDown: (e: PointerEvent<HTMLElement>, slotId: string) => void;
    /** A placed chip was clicked: select the slot on the map and let it blink. */
    onShow: (slotId: string) => void;
    /** Opens the dialog that gives all roster slots to players (and binds classes to slots). */
    onAssign: () => void;
}) {
    const t = useT();
    const [openSlot, setOpenSlot] = useState<{ id: string; el: HTMLElement } | null>(null);
    const open = openSlot ? openSlot.id : "";
    const [showSplit, setShowSplit] = useState(false);
    const all = besetzungSlots(board);
    const counts = effectiveCounts(board, besetzung, roster);
    const split = showSplit || counts.melee > 0 || counts.ranged > 0;
    const clusters = split ? ["tank", "healer", "dps", "melee", "ranged", "group"] : ["tank", "healer", "dps", "group"];
    const own = board.counts !== null;

    const chip = (s: RaidplanSlot) => {
        const player = s.userId ? players.get(s.userId) || null : null;
        const name = t(`raidBoard.slot.${s.kind}`, { n: s.n });
        const on = s.placed !== false;
        const roleIcon = ROLE_ICON[s.kind];
        const flexNow = player ? board.roles[player.userId] : "";
        return (
            <span key={s.id} className={`rp-bes-slot${on ? " is-placed" : ""}`}>
                <button
                    type="button" className={`rp-bes-chip${player ? "" : " is-open"}${flexNow ? " is-flex" : ""}`} aria-expanded={open === s.id}
                    aria-label={`${name}${player ? `: ${player.character}` : ` (${t("raidBoard.slot.open")})`}`}
                    data-tip={player ? `${name}: ${player.character}` : `${name} (${t("raidBoard.slot.open")})`}
                    onPointerDown={(e) => { if (canWrite) onChipDown(e, s.id); }}
                    onClick={(e) => { if (on) onShow(s.id); setOpenSlot(open === s.id ? null : { id: s.id, el: e.currentTarget }); }}
                >
                    {player ? <TokenIcon player={player} size="sm" /> : s.kind === "group" ? <Users size={15} aria-hidden="true" /> : <WowIcon name={roleIcon} size={20} />}
                    <span className="rp-bes-n">{s.n}</span>
                </button>
                {canWrite && !on && (
                    <button type="button" className="rp-bes-pin" aria-label={t("raidBoard.bes.place")} data-tip={t("raidBoard.bes.placeTip")} onPointerDown={(e) => onPlaceDown(e, s.id)}>
                        <MapPin size={12} />
                    </button>
                )}
                {on && <span className="rp-bes-on" aria-hidden="true"><Check size={10} /></span>}
            </span>
        );
    };

    /** The picker of one slot beside the bar: place it, play another role here, free it, or give it to somebody (single choice). */
    const flyout = (o: { id: string; el: HTMLElement }) => {
        const s = board.slots.find((x) => x.id === o.id);
        if (!s) return null;
        const player = s.userId ? players.get(s.userId) || null : null;
        const on = s.placed !== false;
        const name = t(`raidBoard.slot.${s.kind}`, { n: s.n });
        const fits = (p: RaidplanPlayer) => roleOn(board, p) === s.kind || (s.kind === "dps" && roleOn(board, p) !== "tank" && roleOn(board, p) !== "healer");
        const options = canWrite && isEvent && s.kind !== "group"
            ? roster.map((p) => ({
                key: p.userId, label: p.character, on: !!player && p.userId === player.userId, group: fits(p) ? t("raidBoard.bes.fitting") : t("raidBoard.bes.others"),
                node: <span className="rp-pchip"><TokenIcon player={p} size="sm" /><PlayerName player={p} /></span>,
            })).sort((x, y) => (x.group === y.group ? 0 : x.group === t("raidBoard.bes.fitting") ? -1 : 1))
            : [];
        const flexNow = player ? board.roles[player.userId] : "";
        return (
            <Flyout
                anchor={o.el} title={player ? `${name}: ${player.character}` : name} multi={false} options={options}
                onToggle={(id) => edit((b) => assignSlot(b, s.id, id))} onClose={() => setOpenSlot(null)}
                top={canWrite ? (
                    <>
                        <button type="button" className="rp-pop-act" onClick={() => { edit((b) => (on ? unplaceSlot(b, s.id) : placeSlot(b, s.id, null))); setOpenSlot(null); }}>
                            <MapPin size={14} /> {on ? t("raidBoard.bes.unplace") : t("raidBoard.bes.placeNow")}
                        </button>
                        {isEvent && player && s.kind !== "group" && (
                            <span className="rp-bes-flexbtns" role="group" aria-label={t("raidBoard.bes.flex")}>
                                <span className="rp-kicker">{t("raidBoard.bes.flex")}</span>
                                {["tank", "healer", "dps"].map((r) => {
                                    const eff = roleOn(board, player);
                                    const cur = eff === r || (r === "dps" && eff !== "tank" && eff !== "healer");
                                    return (
                                        <button key={r} type="button" className={`rp-pop-act${cur ? " is-on" : ""}`} aria-pressed={cur} onClick={() => { edit((b) => setFlexRole(b, roster, player.userId, r)); setOpenSlot(null); }}>
                                            <WowIcon name={ROLE_ICON[r]} size={18} /> {t(`raidBoard.slot.kind.${r}`)}
                                        </button>
                                    );
                                })}
                                {flexNow && <span className="rp-muted">{t("raidBoard.bes.flexNote", { role: t(`raidBoard.slot.kind.${player.role === "healer" || player.role === "tank" ? player.role : "dps"}`) })}</span>}
                            </span>
                        )}
                        {isEvent && player && s.kind !== "group" && <button type="button" className="rp-pop-act" onClick={() => { edit((b) => assignSlot(b, s.id, "")); setOpenSlot(null); }}>{t("raidBoard.bes.free")}</button>}
                    </>
                ) : undefined}
            />
        );
    };

    return (
        <section className="rp-bes" data-rp-bes aria-label={t("raidBoard.bes.title")}>
            <span className="rp-kicker rp-bes-head" data-tip={t("raidBoard.bes.tip", { size: besetzung.size })}>{t("raidBoard.bes.title")} · {besetzung.size}</span>
            <button type="button" className="rp-assign-btn rp-bes-assign" onClick={onAssign}><ListChecks size={15} aria-hidden="true" /><span>{t("raidBoard.roster.title")}</span></button>
            <div className="rp-bes-blocks">
            {clusters.map((kind) => {
                const list = all.filter((s) => s.kind === kind);
                const isGroup = kind === "group";
                const label = kind === "dps" ? t("raidBoard.bes.dpsTotal") : t(`raidBoard.slot.kind.${kind}`);
                const n = isGroup ? list.length : countOf(counts, kind);
                return (
                    <div key={kind} className={`rp-bes-role rp-bes-${kind}`} role="group" aria-label={label}>
                        <span className="rp-kicker rp-bes-rolelabel">{label}</span>
                        <div className="rp-bes-rolebody">
                        <span className="rp-bes-roleicon" data-tip={label}>{isGroup ? <Users size={17} /> : <WowIcon name={ROLE_ICON[kind]} size={22} />}</span>
                        {!isGroup && canWrite && (
                            <button type="button" className="rp-bes-step" aria-label={t("raidBoard.bes.less", { role: label })} disabled={n <= 0} onClick={() => edit((b) => setCount(b, besetzung, kind, n - 1, roster))}><Minus size={12} /></button>
                        )}
                        <span className="rp-bes-count">{n}</span>
                        {!isGroup && canWrite && (
                            <button type="button" className="rp-bes-step" aria-label={t("raidBoard.bes.more", { role: label })} disabled={n >= 40} onClick={() => edit((b) => setCount(b, besetzung, kind, n + 1, roster))}><Plus size={12} /></button>
                        )}
                        <span className="rp-bes-chips">{list.map(chip)}</span>
                        </div>
                    </div>
                );
            })}
            {canWrite && (
                <span className="rp-bes-tools">
                    <button type="button" className={`rp-bes-step rp-bes-splitbtn${split ? " is-on" : ""}`} aria-pressed={split} data-tip={t("raidBoard.bes.split")} aria-label={t("raidBoard.bes.split")} disabled={counts.melee > 0 || counts.ranged > 0} onClick={() => setShowSplit(!showSplit)}><Split size={13} /></button>
                    {own && (
                        <>
                            <span className="rp-bes-own" data-tip={t("raidBoard.bes.ownTip")}>{t("raidBoard.bes.own")}</span>
                            <button type="button" className="rp-bes-step" aria-label={t("raidBoard.bes.reset")} data-tip={t("raidBoard.bes.reset")} onClick={() => edit((b) => resetCounts(b, besetzung))}><RotateCcw size={12} /></button>
                        </>
                    )}
                </span>
            )}
            </div>
            {openSlot && flyout(openSlot)}
        </section>
    );
}
