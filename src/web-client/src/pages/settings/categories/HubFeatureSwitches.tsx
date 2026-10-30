import { useState } from "react";
import type { ApiError } from "../../../api";
import { useToast } from "../../../components/shell/Jobs";
import Switch from "../../../components/ui/form/Switch";
import { useT } from "../../../i18n";

// The parts of one Discord hub (Raid-Zentrale or Orga-Zentrale) of a raid category,
// each with its own switch (#969). A click saves at once through the hub's own API —
// never through the page's draft and save bar — and the server redraws the posted
// message. A missing key counts as on; with everything off the Raid-Zentrale keeps only
// its heading and a short line, which the note under the switches says (the Orga-Zentrale
// always keeps its raid list, so it gets no note).

export type HubFeatureKind = "raid" | "orga";

export default function HubFeatureSwitches({ kind, categoryId, keys, features, save, onSaved }: {
    kind: HubFeatureKind;
    categoryId: string;
    /** The hub's parts in their order (from the server). */
    keys: string[];
    /** The stored switches of this category; a missing key = on. */
    features: Record<string, boolean>;
    save: (categoryId: string, features: Record<string, boolean>) => Promise<{ features: Record<string, boolean> }>;
    onSaved: (categoryId: string, features: Record<string, boolean>) => void;
}) {
    const t = useT();
    const toast = useToast();
    const [busy, setBusy] = useState("");
    const isOn = (key: string) => features[key] !== false;
    const allOff = kind === "raid" && keys.length > 0 && keys.every((k) => !isOn(k));

    const flip = async (key: string, on: boolean) => {
        setBusy(key);
        try {
            const res = await save(categoryId, { [key]: on });
            onSaved(categoryId, res.features);
            toast(t("settings.categories.hubFeatureSaved"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy("");
        }
    };

    if (!keys.length) return null;
    return (
        <div className="cat-features" role="group" aria-labelledby={`catfeat-${kind}-${categoryId}`}>
            <strong id={`catfeat-${kind}-${categoryId}`}>{t("settings.categories.hubFeatures")}</strong>
            {keys.map((key) => (
                <Switch key={key} checked={isOn(key)} disabled={!!busy} onChange={(on) => flip(key, on)}
                    label={t(`settings.categories.hubFeature.${kind}.${key}`)} tip={t(`settings.categories.hubFeatureTip.${kind}.${key}`)} />
            ))}
            {allOff && <span className="note">{t("settings.categories.hubFeaturesAllOff")}</span>}
        </div>
    );
}
