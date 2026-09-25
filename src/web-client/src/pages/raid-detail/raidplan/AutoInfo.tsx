import { AlertTriangle, BringToFront, Lock, LockOpen, RotateCcw, SendToBack, Wand2 } from "lucide-react";
import type { RaidplanAutoStyle, RaidplanBoard, RaidplanPlayer } from "../../../api";
import { Button, IconButton } from "../../../components/ui";
import { SliderField } from "../../../components/raidplan/NumberField";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { classPlaceNameFor } from "../../../lib/assign";
import { ANY } from "../../../lib/classRefs";
import type { AutoPlan, AutoTank } from "../../../lib/autoPlace";
import { COMPASS, COMPASS_NAMES, autoStyleOf, normAngle, objectPercent, patchAutoStyle, reorderObject, resetAutoAll, resetAutoPos, setAutoScale, setObjectPercent } from "../../../lib/raidplan";
import { OpacityField, SizeField } from "./Inspector";
import { useT } from "../../../i18n";

// the compass arrows (up, up-right ... as in the inspector), written as code points: no glyph characters in the source
const COMPASS_ARROWS = [0x2191, 0x2197, 0x2192, 0x2198, 0x2193, 0x2199, 0x2190, 0x2196].map((c) => String.fromCharCode(c));

/**
 * The properties of an object the tank rows put on the map (lib/autoPlace.ts), laid out like those of any other object: size (25 - 400 %),
 * opacity, ring, name, label, for a mob its facing (by itself to its tank, or by hand), lock and order; plus where it comes from ("aus
 * Einteilung": what it tanks / who tanks it, "Zeile bearbeiten" / "Tank wählen"), "Position zurücksetzen", "Alles zurücksetzen" (place and
 * look) and the section's switches (auto placement, the size of all of them together). It cannot be deleted on its own: it goes with its
 * row, or with "Automatisch platzieren" off. What is changed is kept by its key (board.autoStyle / autoPos) and travels with the template.
 */
export default function AutoInfo({ plan, id, board, players, canWrite, edit, onRow }: {
    plan: AutoPlan;
    /** the key of the object ("t:<row>:<n>" / "m:<mob>#<n>") */
    id: string;
    board: RaidplanBoard;
    players: Map<string, RaidplanPlayer>;
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard, merge?: boolean) => void;
    /** opens the row's dialog: of a tank its row, of a mob its (first) tank row; "" = a new one */
    onRow: (tank: AutoTank | null, mobKey: string) => void;
}) {
    const t = useT();
    const tank = plan.tanks.find((x) => x.key === id) || null;
    const mob = tank ? null : plan.mobs.find((x) => x.key === id) || null;
    if (!tank && !mob) return <p className="rp-muted">{t("raidBoard.insp.none")}</p>;
    const dis = !canWrite;
    const st = autoStyleOf(board, id);
    const moved = !!(board.autoPos || {})[id];
    const styled = Object.keys(st).length > 0;
    const set = (patch: Partial<RaidplanAutoStyle>, merge = false) => edit((b) => patchAutoStyle(b, id, patch), merge);
    const mobName = (key: string) => { const m = plan.mobs.find((x) => x.key === key); return m ? (m.count > 1 ? `${m.name} ${m.inst}` : m.name) : ""; };
    const tankName = (k: AutoTank) => {
        const p = k.userId ? players.get(k.userId) : undefined;
        if (p) return <PlayerName player={p} />;
        if (k.classId) return <span>{k.classId === ANY ? t(`raidBoard.class.roles.${k.role || "tank"}`) : classPlaceNameFor(k.classId, k.role, k.type)}</span>;
        return <span>{t(`raidBoard.slot.${k.slotKind || "tank"}`, { n: k.slotN || 1 })}</span>;
    };
    const tanks = mob ? plan.tanks.filter((x) => x.mobKey === mob.key) : [];
    const player = tank && tank.userId ? players.get(tank.userId) || null : null;
    const pct = objectPercent(board, "auto", id) || 100;
    const rotation = st.rotation || 0;
    return (
        <div className="rp-insp rp-autoinfo">
            <div className="rp-insp-head">
                <strong className="rp-insp-name rp-autoinfo-name">
                    {player && <TokenIcon player={player} size="sm" />}
                    {tank ? tankName(tank) : mobName(mob ? mob.key : "")}
                </strong>
                <span className="rp-autobadge"><Wand2 size={13} aria-hidden="true" />{t("raidBoard.auto.fromRow")}</span>
            </div>
            {tank && (
                <p className="rp-autoinfo-line">
                    <span className="rp-kicker">{t("raidBoard.auto.tanks")}</span>
                    <span>{tank.mobKey ? mobName(tank.mobKey) : t("raidBoard.auto.noMob")}</span>
                </p>
            )}
            {tank && tank.state === "missing" && <p className="rp-autoinfo-miss"><AlertTriangle size={14} aria-hidden="true" /> {t("raidBoard.auto.missingHint")}</p>}
            {tank && tank.state === "rule" && <p className="rp-muted">{t("raidBoard.auto.ruleHint")}</p>}
            {mob && (
                <div className="rp-autoinfo-line">
                    <span className="rp-kicker">{t("raidBoard.auto.tankedBy")}</span>
                    <span className="rp-autoinfo-tanks">{tanks.length === 0 ? t("raidBoard.auto.noTank") : tanks.map((k) => <span key={k.key}>{tankName(k)}</span>)}</span>
                </div>
            )}

            <SliderField label={t("raidBoard.insp.sizePct")} value={pct} min={25} max={400} step={5} unit="%" disabled={dis || !!st.lock} onChange={(v) => edit((b) => setObjectPercent(b, "auto", id, v), true)} />
            <OpacityField label={t("raidBoard.insp.opacity")} value={st.opacity === undefined ? 1 : st.opacity} onChange={(v) => !dis && set({ opacity: v }, true)} />
            <label className="rp-check"><input type="checkbox" checked={st.ring !== false} disabled={dis} onChange={(e) => set({ ring: e.target.checked })} /> {t("raidBoard.insp.showRingObj")}</label>
            {tank && <label className="rp-check"><input type="checkbox" checked={st.showName !== false} disabled={dis} onChange={(e) => set({ showName: e.target.checked })} /> {t("raidBoard.insp.showName")}</label>}
            <label className="rp-field">
                <span className="rp-kicker">{t("raidBoard.auto.label")}</span>
                <input value={st.label || ""} maxLength={40} disabled={dis} placeholder={t("raidBoard.auto.labelHint")} onChange={(e) => set({ label: e.target.value }, true)} />
            </label>
            {mob && <label className="rp-check"><input type="checkbox" checked={!!st.showLabel} disabled={dis} onChange={(e) => set({ showLabel: e.target.checked })} /> {t("raidBoard.icon.showLabel")}</label>}
            {mob && (
                <>
                    <label className="rp-check"><input type="checkbox" checked={st.autoFace !== false} disabled={dis} onChange={(e) => set({ autoFace: e.target.checked })} /> {t("raidBoard.icon.autoFace")}</label>
                    {st.autoFace === false && (
                        <>
                            <SizeField label={t("raidBoard.icon.facing")} value={rotation} min={0} max={359} step={1} onChange={(v) => !dis && set({ rotation: normAngle(v), autoFace: false }, true)} />
                            <div className="rp-compass" role="group" aria-label={t("raidBoard.icon.compass")}>
                                {COMPASS.map((a, n) => (
                                    <button key={a} type="button" className={`rp-compass-btn${rotation === a ? " is-on" : ""}`} disabled={dis} aria-pressed={rotation === a} aria-label={t(`raidBoard.compass.${COMPASS_NAMES[n]}`)} data-tip={t(`raidBoard.compass.${COMPASS_NAMES[n]}`)} onClick={() => set({ rotation: a, autoFace: false })}>{COMPASS_ARROWS[n]}</button>
                                ))}
                            </div>
                        </>
                    )}
                </>
            )}

            <div className="rp-insp-actions">
                <IconButton size="sm" icon={st.lock ? <LockOpen size={16} /> : <Lock size={16} />} tip={st.lock ? t("raidBoard.insp.unlock") : t("raidBoard.insp.lock")} disabled={dis} onClick={() => set({ lock: !st.lock })} />
                <IconButton size="sm" icon={<BringToFront size={16} />} tip={t("raidBoard.insp.front")} disabled={dis} onClick={() => edit((b) => reorderObject(b, "auto", id, "front"))} />
                <IconButton size="sm" icon={<SendToBack size={16} />} tip={t("raidBoard.insp.back")} disabled={dis} onClick={() => edit((b) => reorderObject(b, "auto", id, "back"))} />
            </div>
            <div className="rp-autoinfo-actions">
                {canWrite && <Button size="sm" variant="ghost" onClick={() => onRow(tank, mob ? mob.key : "")}>{tank ? t("raidBoard.auto.editRow") : t("raidBoard.auto.pickTank")}</Button>}
                {canWrite && moved && <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => edit((b) => resetAutoPos(b, id))}>{t("raidBoard.auto.reset")}</Button>}
                {canWrite && (moved || styled) && <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => edit((b) => resetAutoAll(b, id))}>{t("raidBoard.auto.resetAll")}</Button>}
            </div>
            {moved && <p className="rp-muted">{t("raidBoard.auto.moved")}</p>}
            <p className="rp-muted">{t("raidBoard.auto.explain")}</p>
            <span className="rp-kicker">{t("raidBoard.auto.section")}</span>
            <SliderField label={t("raidBoard.auto.scale")} value={Math.round((board.autoScale || 1) * 100)} min={40} max={200} step={5} unit="%" disabled={dis} onChange={(v) => edit((b) => setAutoScale(b, v / 100), true)} />
            {canWrite && (
                <label className="rp-check"><input type="checkbox" checked={board.autoPlace !== false} onChange={(e) => edit((b) => ({ ...b, autoPlace: e.target.checked }))} /> {t("raidBoard.auto.place")}</label>
            )}
        </div>
    );
}
