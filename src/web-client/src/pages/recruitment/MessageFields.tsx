import { useRef, type ReactNode } from "react";
import type { RecruitmentData } from "../../api";
import { DISCORD_CONTENT_LIMIT } from "../../lib/discordMarkdown";
import EmojiPicker from "../../components/EmojiPicker";
import SpecPicker from "../../components/SpecPicker";
import DiscordPreview from "../../components/DiscordPreview";
import { IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
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
                        label="Gesuchte Specs" tip="Gesuchte Specs"
                        tipSub="Werden oben im Text als „## Icon Spec-Name“ ein- und ausgetragen und bleiben dort frei editierbar."
                    />
                    <SpecPicker value={content} onChange={setContent} specCatalog={data.specCatalog} emojis={data.emojis} />
                </div>
                <div className="field">
                    <TipLabel
                        label="Nachrichtentext" htmlFor="rc-content" tip="Nachrichtentext"
                        tipSub="Der eigentliche Text der Nachricht. Server-Emojis als <:name:id>, Discord-Markdown erlaubt."
                        extra={(
                            <span className={`rc-count mono${over ? " over" : ""}`} data-tip="Zeichen" data-tip-sub={`Discord nimmt höchstens ${DISCORD_CONTENT_LIMIT} Zeichen je Nachricht.`}>
                                {content.length} / {DISCORD_CONTENT_LIMIT}
                            </span>
                        )}
                    />
                    <div className="rc-ta-bar">
                        <EmojiPicker emojis={data.emojis} textareaRef={contentRef} value={content} onChange={setContent} />
                        <IconButton size="sm" icon={<b>B</b>} tip="Fett" tipSub="**Text**" onClick={() => format("bold")} />
                        <IconButton size="sm" icon={<i>I</i>} tip="Kursiv" tipSub="*Text*" onClick={() => format("italic")} />
                        <IconButton size="sm" icon={<span className="mono">##</span>} tip="Überschrift" tipSub="## am Zeilenanfang" onClick={() => format("heading")} />
                    </div>
                    <textarea
                        id="rc-content" ref={contentRef} className="rc-ta" value={content}
                        onChange={(e) => setContent(e.target.value)} placeholder="Nachrichtentext …"
                    />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                    <TipLabel label="Button-Beschriftung" htmlFor="rc-button" tip="Button-Beschriftung" tipSub="Leer lassen für „Jetzt bewerben“." />
                    <input id="rc-button" type="text" value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} placeholder="Jetzt bewerben" />
                </div>
            </div>
            <div className="rc-preview">
                <div className="kicker rc-preview-head">
                    Vorschau in Discord
                    <Badge tone="ok" tip="Live" tipSub="Folgt jeder Eingabe links.">live</Badge>
                </div>
                <DiscordPreview content={content} buttonLabel={buttonLabel} emojis={data.emojis} channels={data.channels} />
            </div>
        </div>
    );
}
