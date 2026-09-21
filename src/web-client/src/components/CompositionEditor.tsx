import WowIcon from "./ui/WowIcon";
import { IconButton } from "./ui/Button";
import { dpsSlots } from "../lib/raidTemplates";
import { rolePluralLabel } from "../lib/wowNames";
import { useT } from "../i18n";
import "../styles/raid-templates.css";

// Tanks and healers of a raid, each as a large number with − and +, and one
// small line under them saying what is left for damage dealers. Used by the
// raid template modal (#266) and meant for the event creation (#261): an event
// starts from its template and can still change the counts.

export type CompositionCounts = { tank: number; healer: number };

function MinusIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>;
}

function PlusIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

const ROLES = [
    { key: "tank", icon: "ability_warrior_defensivestance" },
    { key: "healer", icon: "spell_holy_flashheal" },
] as const;

export default function CompositionEditor({ size, value, onChange, disabled = false }: {
    /** null = no size yet: nothing is capped and no DPS line is shown */
    size: number | null;
    value: CompositionCounts;
    onChange: (next: CompositionCounts) => void;
    disabled?: boolean;
}) {
    const t = useT();
    const used = value.tank + value.healer;
    const full = size !== null && used >= size;
    const dps = dpsSlots(size, value.tank, value.healer);
    return (
        <div className="comp-ed">
            <div className="comp-grid">
                {ROLES.map((r) => {
                    const n = value[r.key];
                    return (
                        <div key={r.key} className="comp-card">
                            <WowIcon name={r.icon} size={32} />
                            <div className="comp-text">
                                <div className="comp-lbl">{rolePluralLabel(r.key)}</div>
                                <div className="comp-num" aria-live="polite">{n}</div>
                            </div>
                            <IconButton icon={<MinusIcon />} tip={t(r.key === "tank" ? "raidPlan.comp.tankLess" : "raidPlan.comp.healerLess")} disabled={disabled || n <= 0}
                                onClick={() => onChange({ ...value, [r.key]: Math.max(0, n - 1) })} />
                            <IconButton icon={<PlusIcon />} tip={t(r.key === "tank" ? "raidPlan.comp.tankMore" : "raidPlan.comp.healerMore")} disabled={disabled || full}
                                onClick={() => onChange({ ...value, [r.key]: n + 1 })} />
                        </div>
                    );
                })}
            </div>
            {size !== null && (
                <div className="comp-hint">{t("raidPlan.comp.dpsLine", { count: dps })}</div>
            )}
        </div>
    );
}
