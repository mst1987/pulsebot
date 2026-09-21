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
import type { RaidCtx } from "../meta";

const SYSTEMS: { value: LootSystemKey | ""; label: string }[] = [
    { value: "", label: "wie Kategorie" },
    { value: "softres", label: "Softres" },
    { value: "lootcouncil", label: "Loot-Council" },
    { value: "gdkp", label: "GDKP" },
    { value: "other", label: "Anderes" },
];

const SOURCE_TEXT: Record<string, string> = {
    category: "in Einstellungen › Kategorien festgelegt",
    addon: "abgeleitet aus dem Loot-Addon RCLootcouncil",
    default: "Standard, weil für die Kategorie nichts festgelegt ist",
};

export default function LootSystemModal({ ctx, open, onClose }: { ctx: RaidCtx; open: boolean; onClose: () => void }) {
    const { data, eventId, csrfToken, onChanged } = ctx;
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
    const catText = `Kategorie: ${ls.categoryLabel} — ${SOURCE_TEXT[ls.source === "event" ? "category" : ls.source] || ""}`;
    const hasList = !!data.eventSoftres?.url;

    const save = async () => {
        setBusy(true);
        try {
            const r = await setRaidLootSystem(csrfToken, { event: eventId, system, softres: effective !== "softres" && softres });
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
            kicker={data.event.title} title="Lootsystem" width={560}
            hint={catText}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button onClick={save} running={busy}>Speichern</Button>
                </>
            )}
        >
            <div className="rd-form">
                <div className="field">
                    <label>Lootsystem dieses Raids</label>
                    <Segment ariaLabel="Lootsystem dieses Raids" value={system} onChange={(v) => setSystem(v as LootSystemKey | "")} options={SYSTEMS} />
                </div>
                {effective === "softres"
                    ? <p className="rd-muted">Softres-Raid: Schritt, Badge und Softres-Liste werden angeboten.</p>
                    : (
                        <SwitchRow
                            label="Softres zusätzlich anbieten" checked={softres} onChange={setSoftres}
                            tip="Für diesen Raid trotzdem eine Softres-Liste erstellen und posten, z. B. für BoEs. Ohne den Schalter fallen Softres-Schritt und „Softres fehlt“ weg."
                        />
                    )}
                {hasList && effective !== "softres" && !softres && (
                    <p className="rd-muted">Es gibt schon eine Softres-Liste — ihr Link bleibt sichtbar.</p>
                )}
            </div>
        </Modal>
    );
}
