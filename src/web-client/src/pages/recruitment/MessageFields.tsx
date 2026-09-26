import { useRef, type ReactNode } from "react";
import type { RecruitmentData } from "../../api";
import { DISCORD_CONTENT_LIMIT } from "../../lib/discordMarkdown";
import EmojiPicker from "./EmojiPicker";
import SpecPicker from "./SpecPicker";
import DiscordPreview from "./DiscordPreview";
import { IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import { useT } from "../../i18n";
import { TipLabel } from "./RecruitmentBits";

// ---- the editor: fields on the left, the Discord preview on the right ----

/** Wraps the textarea's selection in `before`/`after` (or prefixes its lines). */
function applyFormat(el: HTMLTextAreaElement | null, value: string, kind: "bold" | "italic" | "heading"): { next: string; start: number; end: number } {
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    if (kind === "heading") {
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const line = value.slice(lineStart);
        const has = line.startsWith("## ");
        const next = has ? value.slice(0, lineStart) + line.slice(3) : `${value.slice(0, lineStart)}## ${line}`;
        const shift = has ? -3 : 3;
        return { next, start: Math.max(lineStart, start + shift), end: Math.max(lineStart, end + shift) };
    }
    const mark = kind === "bold" ? "**" : "*";
    const next = value.slice(0, start) + mark + value.slice(start, end) + mark + value.slice(end);
    return { next, start: start + mark.length, end: end + mark.length };
}

export function MessageFields({ data, content, setContent, buttonLabel, setButtonLabel, children }: {
    data: RecruitmentData;
    content: string;
    setContent: (v: string) => void;
    buttonLabel: string;
    setButtonLabel: (v: string) => void;
    /** Fields above the specs (the template's name). */
    children?: ReactNode;
}) {
    const t = useT();
    const contentRef = useRef<HTMLTextAreaElement>(null);
    const format = (kind: "bold" | "italic" | "heading") => {
        const el = contentRef.current;
        const { next, start, end } = applyFormat(el, content, kind);
        setContent(next);
        requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start, end); });
    };
    const over = content.length > DISCORD_CONTENT_LIMIT;

    return (
        <div className="rc-editor">
            <div className="rc-fields">
                {children}
                <div className="field">
                    <TipLabel
                        label={t("recruitment.fields.specs")} tip={t("recruitment.fields.specs")}
                        tipSub={t("recruitment.fields.specsSub")}
                    />
                    <SpecPicker value={content} onChange={setContent} specCatalog={data.specCatalog} emojis={data.emojis} />
                </div>
                <div className="field">
                    <TipLabel
                        label={t("recruitment.fields.content")} htmlFor="rc-content" tip={t("recruitment.fields.content")}
                        tipSub={t("recruitment.fields.contentSub")}
                        extra={(
                            <span className={`rc-count mono${over ? " over" : ""}`} data-tip={t("recruitment.fields.chars")} data-tip-sub={t("recruitment.fields.charsSub", { limit: DISCORD_CONTENT_LIMIT })}>
                                {content.length} / {DISCORD_CONTENT_LIMIT}
                            </span>
                        )}
                    />
                    <div className="rc-ta-bar">
                        <EmojiPicker emojis={data.emojis} textareaRef={contentRef} value={content} onChange={setContent} />
                        <IconButton size="sm" icon={<b>B</b>} tip={t("recruitment.fields.bold")} tipSub={t("recruitment.fields.boldSub")} onClick={() => format("bold")} />
                        <IconButton size="sm" icon={<i>I</i>} tip={t("recruitment.fields.italic")} tipSub={t("recruitment.fields.italicSub")} onClick={() => format("italic")} />
                        <IconButton size="sm" icon={<span className="mono">##</span>} tip={t("recruitment.fields.heading")} tipSub={t("recruitment.fields.headingSub")} onClick={() => format("heading")} />
                    </div>
                    <textarea
                        id="rc-content" ref={contentRef} className="rc-ta" value={content}
                        onChange={(e) => setContent(e.target.value)} placeholder={t("recruitment.fields.contentPlaceholder")}
                    />
                </div>
                <div className="field is-last">
                    <TipLabel label={t("recruitment.fields.button")} htmlFor="rc-button" tip={t("recruitment.fields.button")} tipSub={t("recruitment.fields.buttonSub")} />
                    {/* The placeholder is the bot's default label (German in the posted message), not UI text. */}
                    <input id="rc-button" type="text" value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} placeholder="Jetzt bewerben" />
                </div>
            </div>
            <div className="rc-preview">
                <div className="kicker rc-preview-head">
                    {t("recruitment.fields.preview")}
                    <Badge tone="ok" tip={t("recruitment.fields.liveTip")} tipSub={t("recruitment.fields.liveSub")}>{t("recruitment.fields.live")}</Badge>
                </div>
                <DiscordPreview content={content} buttonLabel={buttonLabel} emojis={data.emojis} channels={data.channels} />
            </div>
        </div>
    );
}
