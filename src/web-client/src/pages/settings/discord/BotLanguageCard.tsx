import { Button } from "../../../components/ui/Button";
import { FieldLabel } from "../../../components/ui/form/Field";
import OwnValue from "../../../components/ui/form/OwnValue";
import Segment from "../../../components/ui/form/Segment";
import { useT } from "../../../i18n";

type BotLang = "de" | "en";

/**
 * Einstellungen → Raid-Standardwerte, "Bot-Sprache": the language of the bot's
 * public messages (signup message, setup, overview, panels) and the default
 * for every raider; a raider's own choice (/language, the DE/EN switch) wins for
 * what only they read.
 *
 * #924: one global default plus an optional own value per server. With a server
 * picked the card is the switch "Eigener Wert auf <Server>" (OwnValue) over the
 * language; "Standard verwenden" drops the own value. Without a server it edits
 * the default itself — only full admins (`canEditDefault`).
 */
export default function BotLanguageCard({ value, own, defaultValue, server, canEditDefault, onChange }: {
    value: BotLang;
    own: boolean;
    defaultValue: BotLang;
    /** the active server's name; empty = no server picked */
    server: string;
    canEditDefault: boolean;
    onChange: (next: { botLanguage: BotLang; botLanguageOwn: boolean }) => void;
}) {
    const t = useT();
    const label = (lang: BotLang) => t(lang === "en" ? "settings.botLanguage.en" : "settings.botLanguage.de");
    const segment = () => (
        <Segment<BotLang>
            ariaLabel={t("settings.botLanguage.aria")}
            value={value}
            onChange={(botLanguage) => onChange({ botLanguage, botLanguageOwn: own })}
            options={[
                { value: "de", label: label("de") },
                { value: "en", label: label("en") },
            ]}
        />
    );
    if (!server) {
        return (
            <div className="set-card set-form bot-lang">
                <FieldLabel>{t("settings.botLanguage.label")} · {t("settings.botLanguage.defaultLabel")}</FieldLabel>
                {canEditDefault ? segment() : <p>{label(value)}</p>}
                <p className="gv-hint">{t("settings.botLanguage.defaultText")}</p>
                {!canEditDefault && <p className="gv-hint">{t("settings.botLanguage.defaultOnlyAdmins")}</p>}
            </div>
        );
    }
    return (
        <div className="set-card set-form bot-lang">
            <FieldLabel>{t("settings.botLanguage.label")}</FieldLabel>
            <OwnValue
                server={server}
                own={own}
                onOwnChange={(next) => onChange({ botLanguage: next ? value : defaultValue, botLanguageOwn: next })}
                fallback={label(defaultValue)}
            >
                {segment()}
                <Button variant="ghost" size="sm" onClick={() => onChange({ botLanguage: defaultValue, botLanguageOwn: false })}>
                    {t("settings.botLanguage.useDefault")}
                </Button>
            </OwnValue>
            <p className="gv-hint">{t("settings.botLanguage.text")}</p>
        </div>
    );
}
