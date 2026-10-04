import { FieldLabel } from "../../components/ui/Field";
import Segment from "../../components/ui/Segment";
import { useT } from "../../i18n";

type BotLang = "de" | "en";

/**
 * Einstellungen → Raid-Standardwerte, "Bot-Sprache": the language of the bot's
 * public messages (signup message, setup, overview, panels) and the default
 * for every raider. One choice in the page's draft (the save bar sends
 * `botLanguage`); a raider's own choice (/language, the DE/EN switch) wins for
 * what only they read.
 */
export default function BotLanguageCard({ value, onChange }: { value: BotLang; onChange: (value: BotLang) => void }) {
    const t = useT();
    return (
        <div className="set-card set-form bot-lang">
            <FieldLabel>{t("settings.botLanguage.label")}</FieldLabel>
            <Segment<BotLang>
                ariaLabel={t("settings.botLanguage.aria")}
                value={value}
                onChange={onChange}
                options={[
                    { value: "de", label: t("settings.botLanguage.de") },
                    { value: "en", label: t("settings.botLanguage.en") },
                ]}
            />
            <p className="gv-hint">{t("settings.botLanguage.text")}</p>
        </div>
    );
}
