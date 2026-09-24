import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Check, MapPin, Minus, Plus, Users } from "lucide-react";
import type { Besetzung as BesetzungData, RaidplanBoard, RaidplanPlayer, RaidplanSlot } from "../../../api";
import WowIcon from "../../../components/ui/WowIcon";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { ROLE_ICON } from "../../../lib/assign";
import { ROLE_KINDS, assignSlot, besetzungSlots, placeSlot, setCount, unplaceSlot } from "../../../lib/raidplan";
import { useT } from "../../../i18n";

/**
 * The "Besetzung": the role slots of this raid (Tank 1..n, Heiler 1..n, Melee, Ranged and the
 * groups) as compact chips with the role icon — there from the start, no dragging onto the
 * board first. In an event they show who stands in them (name, spec icon; open = the role
 * icon) and can be given to somebody else; +/- changes how many a role has. The pin puts a
 * slot on the map (click, or drag it onto the board); everything can be assigned unplaced.
 */
export default function Besetzung({ board, besetzung, roster, isEvent, canWrite, edit, players, onPlaceDown }: {
    board: RaidplanBoard;
    besetzung: BesetzungData;
    roster: RaidplanPlayer[];
    players: Map<string, RaidplanPlayer>;
    isEvent: boolean;
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard) => void;
    /** Pointer down on a slot's pin: the workspace drags it onto the board (no move = put it near the middle). */
    onPlaceDown: (e: PointerEvent<HTMLElement>, slotId: string) => void;
}) {
    const t = useT();
    const [open, setOpen] = useState("");
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return undefined;
        const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(""); };
        const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(""); };
        document.addEventListener("pointerdown", away, true);
        document.addEventListener("keydown", key);
        return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key); };
    }, [open]);

    const all = besetzungSlots(board);
    const counts = board.counts || besetzung.counts;
    const clusters = [...ROLE_KINDS, "group"];

    const chip = (s: RaidplanSlot) => {
        const player = s.userId ? players.get(s.userId) || null : null;
        const name = t(`raidBoard.slot.${s.kind}`, { n: s.n });
        const on = s.placed !== false;
        const roleIcon = ROLE_ICON[s.kind];
        return (
            <span key={s.id} className={`rp-bes-slot${on ? " is-placed" : ""}`}>
                <button
                    type="button" className={`rp-bes-chip${player ? "" : " is-open"}`} aria-expanded={open === s.id}
                    aria-label={`${name}${player ? `: ${player.character}` : ` (${t("raidBoard.slot.open")})`}`}
                    data-tip={player ? `${name}: ${player.character}` : `${name} (${t("raidBoard.slot.open")})`}
                    onClick={() => setOpen(open === s.id ? "" : s.id)}
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
                {open === s.id && (
                    <div className="rp-pop rp-bes-pop" role="dialog" aria-label={name}>
                        <strong className="rp-bes-pop-title">{name}{player ? <> · <PlayerName player={player} /></> : null}</strong>
                        {canWrite && (
                            <button type="button" className="rp-pop-act" onClick={() => { edit((b) => (on ? unplaceSlot(b, s.id) : placeSlot(b, s.id, null))); setOpen(""); }}>
                                <MapPin size={14} /> {on ? t("raidBoard.bes.unplace") : t("raidBoard.bes.placeNow")}
                            </button>
                        )}
                        {canWrite && isEvent && s.kind !== "group" && (
                            <>
                                {player && <button type="button" className="rp-pop-act" onClick={() => { edit((b) => assignSlot(b, s.id, "")); setOpen(""); }}>{t("raidBoard.bes.free")}</button>}
                                <span className="rp-kicker">{t("raidBoard.bes.give")}</span>
                                <div className="rp-bes-people">
                                    {[...roster.filter((p) => p.role === s.kind), ...roster.filter((p) => p.role !== s.kind)].map((p) => (
                                        <button key={p.userId} type="button" className={`rp-pop-item${player && p.userId === player.userId ? " is-on" : ""}`} onClick={() => { edit((b) => assignSlot(b, s.id, p.userId)); setOpen(""); }}>
                                            <span className="rp-achip"><TokenIcon player={p} size="sm" /><PlayerName player={p} /></span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </span>
        );
    };

    return (
        <section className="rp-bes" aria-label={t("raidBoard.bes.title")} ref={ref}>
            <span className="rp-kicker rp-bes-head" data-tip={t("raidBoard.bes.tip", { size: besetzung.size })}>{t("raidBoard.bes.title")} · {besetzung.size}</span>
            {clusters.map((kind) => {
                const list = all.filter((s) => s.kind === kind);
                const isGroup = kind === "group";
                return (
                    <div key={kind} className={`rp-bes-role rp-bes-${kind}`} role="group" aria-label={t(`raidBoard.slot.kind.${kind}`)}>
                        <span className="rp-bes-roleicon" data-tip={t(`raidBoard.slot.kind.${kind}`)}>{isGroup ? <Users size={17} /> : <WowIcon name={ROLE_ICON[kind]} size={22} />}</span>
                        {!isGroup && canWrite && (
                            <button type="button" className="rp-bes-step" aria-label={t("raidBoard.bes.less", { role: t(`raidBoard.slot.kind.${kind}`) })} disabled={counts[kind] <= 0} onClick={() => edit((b) => setCount(b, besetzung, kind, counts[kind] - 1))}><Minus size={12} /></button>
                        )}
                        <span className="rp-bes-count">{isGroup ? list.length : counts[kind]}</span>
                        {!isGroup && canWrite && (
                            <button type="button" className="rp-bes-step" aria-label={t("raidBoard.bes.more", { role: t(`raidBoard.slot.kind.${kind}`) })} disabled={counts[kind] >= 40} onClick={() => edit((b) => setCount(b, besetzung, kind, counts[kind] + 1))}><Plus size={12} /></button>
                        )}
                        <span className="rp-bes-chips">{list.map(chip)}</span>
                    </div>
                );
            })}
        </section>
    );
}
