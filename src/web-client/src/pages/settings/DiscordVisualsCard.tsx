import { FieldLabel } from "../../components/ui/Field";
import Switch from "../../components/ui/Switch";
import { DISCORD_VISUAL_KEYS, type DiscordVisualKey } from "../../lib/settings/settingsLogic";
import { useT } from "../../i18n";

type Visuals = Record<DiscordVisualKey, boolean>;

/**
 * Einstellungen → Raid-Standardwerte, "Bilder in Bot-Nachrichten" (a test, Oct 2026):
 * one switch per drawn picture — the raid overview's week strip, the setup as a
 * graphic, the Discord event's cover. In the page's draft (the save bar sends
 * `discordVisuals`); off, a message is drawn in its text form again at its next update.
 */
export default function DiscordVisualsCard({ value, onChange }: { value: Visuals; onChange: (value: Visuals) => void }) {
    const t = useT();
    return (
        <div className="set-card set-form">
            <FieldLabel>{t("settings.discordVisuals.label")}</FieldLabel>
            {DISCORD_VISUAL_KEYS.map((key) => (
                <Switch
                    key={key}
                    checked={value[key]}
                    onChange={(checked) => onChange({ ...value, [key]: checked })}
                    label={t(`settings.discordVisuals.${key}`)}
                    tip={t(`settings.discordVisuals.${key}Tip`)}
                />
            ))}
            <p className="gv-hint">{t("settings.discordVisuals.text")}</p>
        </div>
    );
}
