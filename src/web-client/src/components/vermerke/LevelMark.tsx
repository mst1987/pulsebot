import Icon from "../ui/Icon";
import { useT } from "../../i18n";
import type { NoteLevel } from "../../api/vermerke";

// The level of a note (#980): always a symbol and the word, never a colour alone.
// Hinweis = flag in amber, Warnung = triangle in red, Shadowban = prohibition
// circle in red. null = nothing counts any more (archive): a muted "abgelaufen".
// The colours are the result tones (--medium / --high), defined for both themes.
const ICON = { hint: "noteHint", warning: "noteWarning", shadowban: "noteShadowban" } as const;

export default function LevelMark({ level, iconOnly = false, size = 16, tipSub, label }: {
    level: NoteLevel | null;
    /** only the symbol, the word as the tooltip (tight spots like the member list) */
    iconOnly?: boolean;
    size?: number;
    /** the tooltip's second line in place of the level's explanation (the reasons beside a name, #981) */
    tipSub?: string;
    /** the symbol's name in place of the bare word (iconOnly) */
    label?: string;
}) {
    const t = useT();
    if (!level) {
        return (
            <span className="nm-level nm-level-none" data-tip={t("vermerke.levelNone")} data-tip-sub={t("vermerke.levelNoneTip")}>
                {t("vermerke.levelNone")}
            </span>
        );
    }
    const word = t(`vermerke.level.${level}`);
    return (
        <span
            className={`nm-level nm-level-${level}${iconOnly ? " nm-level-icon" : ""}`}
            data-level={level}
            data-tip={word}
            data-tip-sub={tipSub || t(`vermerke.levelTip.${level}`)}
            {...(iconOnly ? { role: "img", "aria-label": label || word } : {})}
        >
            <Icon name={ICON[level]} size={size} />
            {!iconOnly && <span className="nm-level-word">{word}</span>}
        </span>
    );
}
