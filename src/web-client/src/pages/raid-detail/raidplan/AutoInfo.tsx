import { AlertTriangle, RotateCcw, Wand2 } from "lucide-react";
import type { RaidplanBoard, RaidplanPlayer } from "../../../api";
import { Button } from "../../../components/ui";
import { PlayerName, TokenIcon } from "../../../components/raidplan/PlanBoard";
import { classPlaceNameFor } from "../../../lib/assign";
import { ANY } from "../../../lib/classRefs";
import type { AutoPlan, AutoTank } from "../../../lib/autoPlace";
import { resetAutoPos } from "../../../lib/raidplan";
import { useT } from "../../../i18n";

/**
 * The properties of an object the tank rows put on the map (lib/autoPlace.ts): what it is, which row it comes from, "Position
 * zurücksetzen" when it was moved by hand and "Zeile bearbeiten" / "Tank wählen" (the row's dialog). It cannot be deleted on its own:
 * it goes with its row, or with "Automatisch platzieren" off for the whole section.
 */
export default function AutoInfo({ plan, id, board, players, canWrite, edit, onRow }: {
    plan: AutoPlan;
    /** the key of the object ("t:<row>:<n>" / "m:<mob>#<n>") */
    id: string;
    board: RaidplanBoard;
    players: Map<string, RaidplanPlayer>;
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard) => void;
    /** opens the row's dialog: of a tank its row, of a mob its (first) tank row; "" = a new one */
    onRow: (tank: AutoTank | null, mobKey: string) => void;
}) {
    const t = useT();
    const tank = plan.tanks.find((x) => x.key === id) || null;
    const mob = tank ? null : plan.mobs.find((x) => x.key === id) || null;
    if (!tank && !mob) return <p className="rp-muted">{t("raidBoard.insp.none")}</p>;
    const moved = !!(board.autoPos || {})[id];
    const mobName = (key: string) => { const m = plan.mobs.find((x) => x.key === key); return m ? (m.count > 1 ? `${m.name} ${m.inst}` : m.name) : ""; };
    const tankName = (k: AutoTank) => {
        const p = k.userId ? players.get(k.userId) : undefined;
        if (p) return <PlayerName player={p} />;
        if (k.classId) return <span>{k.classId === ANY ? t(`raidBoard.class.roles.${k.role || "tank"}`) : classPlaceNameFor(k.classId, k.role, k.type)}</span>;
        return <span>{t(`raidBoard.slot.${k.slotKind || "tank"}`, { n: k.slotN || 1 })}</span>;
    };
    const tanks = mob ? plan.tanks.filter((x) => x.mobKey === mob.key) : [];
    const player = tank && tank.userId ? players.get(tank.userId) || null : null;
    return (
        <div className="rp-insp rp-autoinfo">
            <span className="rp-autobadge"><Wand2 size={13} aria-hidden="true" />{t("raidBoard.auto.fromRow")}</span>
            <h4 className="rp-autoinfo-name">
                {player && <TokenIcon player={player} size="sm" />}
                {tank ? tankName(tank) : mobName(mob ? mob.key : "")}
            </h4>
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
            <div className="rp-autoinfo-actions">
                {canWrite && <Button size="sm" variant="ghost" onClick={() => onRow(tank, mob ? mob.key : "")}>{tank ? t("raidBoard.auto.editRow") : t("raidBoard.auto.pickTank")}</Button>}
                {canWrite && moved && <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => edit((b) => resetAutoPos(b, id))}>{t("raidBoard.auto.reset")}</Button>}
            </div>
            {moved && <p className="rp-muted">{t("raidBoard.auto.moved")}</p>}
            <p className="rp-muted">{t("raidBoard.auto.explain")}</p>
            {canWrite && (
                <label className="rp-check"><input type="checkbox" checked={board.autoPlace !== false} onChange={(e) => edit((b) => ({ ...b, autoPlace: e.target.checked }))} /> {t("raidBoard.auto.place")}</label>
            )}
        </div>
    );
}
