// "Lootsystem" of one raid: like its category (the default), or its own —
// Softres, Loot-Council, GDKP, Anderes — plus "Softres zusätzlich" for a raid
// that is not softres but still wants a list. Decides whether the softres step,
// badge and menu entry are offered (src/web/lootSystem.js).
import { useEffect, useState } from "react";
import { setRaidLootSystem, type ApiError, type LootSystemKey } from "../../../api";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import Segment from "../../../components/ui/Segment";
import { SwitchRow } from "../../../components/RaidPlanFields";
import { useToast } from "../../../components/Jobs";
import { useT, type TFunction } from "../../../i18n";
import type { RaidCtx } from "../meta";

// Built at render time, so the labels follow the menu language.
function lootSystems(t: TFunction): { value: LootSystemKey | ""; label: string }[] {
    return [
        { value: "", label: t("raidModals.lootSystem.likeCategory") },
        { value: "softres", label: "Softres" },
        { value: "lootcouncil", label: "Loot-Council" },
        { value: "gdkp", label: "GDKP" },
        { value: "other", label: t("raidModals.lootSystem.other") },
    ];
}

const SOURCE_KEYS: Record<string, string> = {
    category: "raidModals.lootSystem.sourceCategory",
    addon: "raidModals.lootSystem.sourceAddon",
    default: "raidModals.lootSystem.sourceDefault",
};

export default function LootSystemModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const t = useT();
    const { data, eventId, onChanged } = ctx;
    const ls = data.lootSystem;
    const [system, setSystem] = useState<LootSystemKey | "">("");
    const [softres, setSoftres] = useState(false);
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    useEffect(() => {
        if (!open || !ls) return;
        setSystem(ls.source === "event" ? ls.system : "");
        setSoftres(ls.softresExtra);
    }, [open, ls]);

    if (!ls) return null;
    const effective = system || ls.categorySystem;
    const sourceKey = SOURCE_KEYS[ls.source === "event" ? "category" : ls.source];
    const catText = t("raidModals.lootSystem.categoryHint", { category: ls.categoryLabel, source: sourceKey ? t(sourceKey) : "" });
    const hasList = !!data.eventSoftres?.url;

    const save = async () => {
        setBusy(true);
        try {
            const r = await setRaidLootSystem({ event: eventId, system, softres: effective !== "softres" && softres });
            onClose();
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={open} onClose={onClose} icon="inv_misc_bag_10"
            kicker={data.event.title} title={t("raidModals.lootSystem.title")} width={560}
            hint={catText}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button onClick={save} running={busy}>{t("common.save")}</Button>
                </>
            )}
        >
            <div className="rd-form">
                <div className="field">
                    <label>{t("raidModals.lootSystem.label")}</label>
                    <Segment ariaLabel={t("raidModals.lootSystem.label")} value={system} onChange={(v) => setSystem(v as LootSystemKey | "")} options={lootSystems(t)} />
                </div>
                {effective === "softres"
                    ? <p className="rd-muted">{t("raidModals.lootSystem.softresRaid")}</p>
                    : (
                        <SwitchRow
                            label={t("raidModals.lootSystem.softresExtra")} checked={softres} onChange={setSoftres}
                            tip={t("raidModals.lootSystem.softresExtraTip")}
                        />
                    )}
                {hasList && effective !== "softres" && !softres && (
                    <p className="rd-muted">{t("raidModals.lootSystem.listStays")}</p>
                )}
            </div>
        </Modal>
    );
}
