import { useState } from "react";
import { IconButton } from "../../../components/ui/Button";
import { TrashIcon } from "../../../components/ui/icons/icons";
import { EMOJI_CHOICES, previewEmoji, type LinkValue } from "../../../lib/discord/buttonEmoji";
import { useT } from "../../../i18n";

// One link of a Discord centre (Raid-Zentrale or Orga-Zentrale links): emoji,
// text, address. Discord's link buttons are always grey, so the emoji before the
// text is the one thing to set; a small preview shows how the button will read.
// The emoji field takes any emoji or a custom "<:name:id>"; the pick below it
// offers the everyday ones.

/** The look of the Discord button: [emoji] text ↗. */
export function ButtonPreview({ emoji, label }: { emoji?: string; label: string }) {
    const parsed = previewEmoji(emoji || "");
    return (
        <span className="link-preview" aria-hidden="true">
            {parsed?.kind === "custom" && <img src={parsed.url} alt="" width={16} height={16} />}
            {parsed?.kind === "unicode" && <span className="link-preview-emoji">{parsed.text}</span>}
            <span>{label || "…"}</span>
            <span className="link-preview-arrow">↗</span>
        </span>
    );
}

export default function LinkRow({ row, n, groupId, onChange, onRemove }: {
    row: LinkValue;
    /** 1-based position, for the accessible names. */
    n: number;
    /** The id of the heading that names the list. */
    groupId: string;
    onChange: (patch: Partial<LinkValue>) => void;
    onRemove: () => void;
}) {
    const t = useT();
    const [picking, setPicking] = useState(false);
    return (
        <div className="cat-link-item">
            <div className="cat-link-row" role="group" aria-labelledby={groupId}>
                <input type="text" className="link-emoji" value={row.emoji || ""} maxLength={64} placeholder="🙂"
                    aria-label={t("settings.categories.linkEmojiAria", { n })} onChange={(e) => onChange({ emoji: e.target.value })} />
                <input type="text" value={row.label} maxLength={40} placeholder={t("settings.categories.linkLabel")}
                    aria-label={t("settings.categories.linkLabelAria", { n })} onChange={(e) => onChange({ label: e.target.value })} />
                <input type="url" value={row.url} placeholder="https://…"
                    aria-label={t("settings.categories.linkUrlAria", { n })} onChange={(e) => onChange({ url: e.target.value })} />
                <IconButton icon={<TrashIcon />} tip={t("settings.categories.linkRemove", { n })} size="sm" tone="danger" onClick={onRemove} />
            </div>
            <div className="link-extras">
                <button type="button" className="badge chip" aria-expanded={picking} onClick={() => setPicking(!picking)}>
                    {t("settings.categories.linkEmojiPick")}
                </button>
                <ButtonPreview emoji={row.emoji} label={row.label} />
            </div>
            {picking && (
                <div className="chip-row link-emoji-grid" role="group" aria-label={t("settings.categories.linkEmojiPick")}>
                    {EMOJI_CHOICES.map((e) => (
                        <button type="button" key={e} className="badge chip" aria-pressed={row.emoji === e}
                            onClick={() => { onChange({ emoji: row.emoji === e ? "" : e }); }}>{e}</button>
                    ))}
                </div>
            )}
        </div>
    );
}
