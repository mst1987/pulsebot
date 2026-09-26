import { Crosshair, X } from "lucide-react";
import type { Catalog, RaidplanBoard, RaidplanMobRef } from "../../../api";
import { addMobs, mobIconKey, mobRef, removeMob } from "../../../lib/raidplan/assign";
import { insertObject } from "../../../lib/raidplan";
import { useT } from "../../../i18n";
import { ChipPicker, MobIcon, type Option } from "./AssignPanel";

/**
 * The mobs of a section: everything that can be tanked or marked here — the boss, the catalog's adds of
 * this boss (trash: the trash mobs of the instance) and the mobs added by hand ("+": any mob of the catalog).
 * They are always tank targets in the assignments; the crosshair puts a mob on the map as a round icon
 * (with the way it faces, like a boss icon).
 */
export default function MobsBar({ mobs, board, catalog, bossKey, instanceId, canWrite, edit }: {
    mobs: RaidplanMobRef[];
    board: RaidplanBoard;
    catalog: Catalog | null;
    bossKey: string;
    instanceId: string;
    canWrite: boolean;
    edit: (fn: (b: RaidplanBoard) => RaidplanBoard) => void;
}) {
    const t = useT();
    const added = new Set(board.mobs.map((m) => m.id));
    const options: Option[] = [];
    const chipOf = (m: RaidplanMobRef) => <span className="rp-achip"><MobIcon icon={m.icon} size={18} /><span>{m.name}</span></span>;
    for (const m of catalog ? catalog.mobs : []) {
        const group = m.bossKey === bossKey && bossKey ? t("raidBoard.mobs.ofBoss") : m.instanceId === instanceId ? t("raidBoard.mobs.ofInstance") : t("raidBoard.mobs.all");
        options.push({ key: m.id, label: m.name, on: added.has(m.id), group, node: chipOf(mobRef(m)) });
    }
    const order = [t("raidBoard.mobs.ofBoss"), t("raidBoard.mobs.ofInstance"), t("raidBoard.mobs.all")];
    options.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    return (
        <section className="rp-mobs" aria-label={t("raidBoard.mobs.title")}>
            <span className="rp-kicker rp-bes-head" data-tip={t("raidBoard.mobs.tip")}>{t("raidBoard.mobs.title")} · {mobs.length}</span>
            <span className="rp-achips">
                {mobs.map((m) => (
                    <span key={m.id} className={`rp-mobchip${added.has(m.id) ? " is-added" : ""}`}>
                        <span className="rp-achip"><MobIcon icon={m.icon} size={20} /><span>{m.name}</span></span>
                        {canWrite && (
                            <button type="button" className="rp-mobchip-btn" aria-label={t("raidBoard.mobs.onMap", { name: m.name })} data-tip={t("raidBoard.mobs.onMap", { name: m.name })} onClick={() => edit((b) => insertObject(b, { type: "icon", iconKey: mobIconKey(m.icon), label: m.name, mobId: m.id }, null).board)}>
                                <Crosshair size={13} />
                            </button>
                        )}
                        {canWrite && added.has(m.id) && (
                            <button type="button" className="rp-mobchip-btn" aria-label={t("raidBoard.assign.remove")} onClick={() => edit((b) => removeMob(b, m.id))}><X size={12} /></button>
                        )}
                    </span>
                ))}
                {canWrite && options.length > 0 && (
                    <ChipPicker
                        label={t("raidBoard.mobs.add")} options={options}
                        onToggle={(id) => { const m = (catalog ? catalog.mobs : []).find((x) => x.id === id); if (m) edit((b) => (added.has(id) ? removeMob(b, id) : addMobs(b, [mobRef(m)]))); }}
                    />
                )}
            </span>
        </section>
    );
}
