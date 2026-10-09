// The emoji button beside a channel name or naming schema: picking an emoji
// puts it at the start of the name — replacing the emoji that stood there, with
// the separator the category's channels use (lib/discord/emoji.ts setLeadEmoji). The
// first rows suggest what suits the raid (lib/raids/raidEmojis.ts) and what the
// category's channels carry already.
import { useMemo } from "react";
import { useT } from "../../i18n";
import { emojiStyleOf, leadEmojiOf, setLeadEmoji } from "../../lib/discord/emoji";
import { raidEmojiSuggestions } from "../../lib/raids/raidEmojis";
import EmojiPicker, { type EmojiSection } from "../ui/EmojiPicker";

export default function ChannelEmojiPicker({ value, onChange, channelNames = [], instanceIds = [], raidLabel = "", host = "dialog", disabled = false }: {
    /** The name (or schema) as it stands in the field. */
    value: string;
    onChange: (next: string) => void;
    /** The names of the category's channels: their emojis and separator. */
    channelNames?: string[];
    /** The raids the event is for — their suggestions come first. */
    instanceIds?: string[];
    /** How the raid is called in the suggestion row ("Zul'Aman"). */
    raidLabel?: string;
    host?: "body" | "dialog";
    disabled?: boolean;
}) {
    const t = useT();
    const style = useMemo(() => emojiStyleOf(channelNames), [channelNames]);
    const sections = useMemo(() => {
        const out: EmojiSection[] = [];
        const raid = raidEmojiSuggestions(instanceIds);
        if (raid.length) out.push({ key: "raid", label: raidLabel ? t("emoji.channel.suits", { raid: raidLabel }) : t("emoji.channel.suitsRaid"), emojis: raid });
        if (style.emojis.length) out.push({ key: "category", label: t("emoji.channel.category"), emojis: style.emojis.slice(0, 18) });
        return out;
    }, [instanceIds, raidLabel, style, t]);
    return (
        <EmojiPicker
            label={t("emoji.channel.button")}
            hint={t("emoji.channel.hint")}
            current={leadEmojiOf(value)}
            sections={sections}
            host={host}
            disabled={disabled}
            onPick={(emoji) => onChange(setLeadEmoji(value, emoji, style.separator))}
        />
    );
}
