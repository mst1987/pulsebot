import { FieldLabel } from "../../../components/ui/Field";
import OwnValue from "../../../components/ui/OwnValue";
import Switch from "../../../components/ui/Switch";
import { DISCORD_VISUAL_KEYS, type DiscordVisualKey } from "../../../lib/settings/settingsLogic";
import { useT } from "../../../i18n";

type Visuals = Record<DiscordVisualKey, boolean>;

/**
 * Einstellungen → Raid-Standardwerte, "Bilder in Bot-Nachrichten" (a test, Oct 2026):
 * one switch per drawn picture — the raid overview's week strip, the setup as a
 * graphic, the Discord event's cover. In the page's draft (the save bar sends
 * `discordVisuals`); off, a message is drawn in its text form again at its next update.
 *
 * #961: like the bot language one global default plus optional own switches per
 * server. With a server picked the switches sit under "Eigener Wert auf <Server>"
 * (OwnValue); switching it off drops them. Without a server the card edits the
 * default itself — only full admins (`canEditDefault`).
 */
export default function DiscordVisualsCard({ value, own, defaultValue, server, canEditDefault, onChange }: {
    value: Visuals;
    own: boolean;
    defaultValue: Visuals;
    /** the active server's name; empty = no server picked */
    server: string;
    canEditDefault: boolean;
    onChange: (next: { discordVisuals: Visuals; discordVisualsOwn: boolean }) => void;
}) {
    const t = useT();
    const switches = (disabled = false) => DISCORD_VISUAL_KEYS.map((key) => (
        <Switch
            key={key}
            checked={value[key]}
            disabled={disabled}
            onChange={(checked) => onChange({ discordVisuals: { ...value, [key]: checked }, discordVisualsOwn: own })}
            label={t(`settings.discordVisuals.${key}`)}
            tip={t(`settings.discordVisuals.${key}Tip`)}
        />
    ));
    // the default in one line: which pictures are on
    const onList = DISCORD_VISUAL_KEYS.filter((key) => defaultValue[key]).map((key) => t(`settings.discordVisuals.${key}`));
    const fallback = onList.length ? onList.join(", ") : t("settings.discordVisuals.noneOn");
    if (!server) {
        return (
            <div className="set-card set-form bot-visuals">
                <FieldLabel>{t("settings.discordVisuals.label")} · {t("settings.discordVisuals.defaultLabel")}</FieldLabel>
                {switches(!canEditDefault)}
                <p className="gv-hint">{t("settings.discordVisuals.defaultText")}</p>
                {!canEditDefault && <p className="gv-hint">{t("settings.discordVisuals.defaultOnlyAdmins")}</p>}
            </div>
        );
    }
    return (
        <div className="set-card set-form bot-visuals">
            <FieldLabel>{t("settings.discordVisuals.label")}</FieldLabel>
            <OwnValue
                server={server}
                own={own}
                onOwnChange={(next) => onChange({ discordVisuals: next ? value : defaultValue, discordVisualsOwn: next })}
                fallback={fallback}
            >
                {switches()}
            </OwnValue>
            <p className="gv-hint">{t("settings.discordVisuals.text")}</p>
        </div>
    );
}
