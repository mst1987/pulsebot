import type { TextChannel } from "../../api";
import { FieldLabel } from "../../components/ui/form/Field";
import Switch from "../../components/ui/form/Switch";
import { ChannelPicker } from "../../components/settings/settingsUi";
import { useT } from "../../i18n";

export type DungeonRecords = { post: boolean; channelId: string };

/**
 * Einstellungen → Dungeon-Bestzeiten, "Neue Gildenrekorde posten" (off by
 * default): a gold run of the LevelHelper addon that is now the fastest of its
 * dungeon goes into the channel as a card (services/dungeons/dungeonRecords.js).
 * In the page's draft; the save bar sends `dungeonRecords`.
 */
export default function DungeonRecordsCard({ value, channels, onChange }: {
    value: DungeonRecords;
    channels: TextChannel[];
    onChange: (value: DungeonRecords) => void;
}) {
    const t = useT();
    return (
        <div className="set-card set-form">
            <Switch
                checked={value.post}
                onChange={(post) => onChange({ ...value, post })}
                label={t("settings.dungeonRecords.post")}
                tip={t("settings.dungeonRecords.postTip")}
            />
            {value.post && (
                <div className="set-field">
                    <FieldLabel htmlFor="set-dungeon-channel" tip={t("settings.dungeonRecords.channel")} tipSub={t("settings.dungeonRecords.channelSub")}>
                        {t("settings.dungeonRecords.channel")}
                    </FieldLabel>
                    <ChannelPicker id="set-dungeon-channel" value={value.channelId} channels={channels} onChange={(channelId) => onChange({ ...value, channelId })} />
                </div>
            )}
            {value.post && !value.channelId && <p className="gv-hint">{t("settings.dungeonRecords.noChannel")}</p>}
        </div>
    );
}
