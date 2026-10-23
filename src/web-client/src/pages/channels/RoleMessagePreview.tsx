import type { CSSProperties, ReactNode } from "react";
import type { RoleMessageEmojiOption, RoleMessageRole } from "../../api";
import { CrestIcon } from "../../components/ui/icons";
import { parseDiscordMarkdown, type InlineToken, type MdBlock } from "../../lib/discord/discordMarkdown";
import { previewEmoji } from "../../lib/discord/buttonEmoji";
import { buttonRows } from "../../lib/discord/roleMessages";
import { formatTime } from "../../lib/format";
import { useT } from "../../i18n";

// How a role message will look in Discord, the way src/services/discord/roleMessages.js
// builds it: one card with the accent bar on the left, "## title" and the text,
// the picture, a line, then a grey button per role in rows of five — and the
// bot's reactions under the message. A pure renderer: it fetches nothing.

/** A role of the preview: the stored role plus its name for an empty button text. */
export type PreviewRole = RoleMessageRole & { name: string };

function Emo({ text, emojis }: { text: string; emojis: RoleMessageEmojiOption[] }) {
    const parsed = previewEmoji(text);
    if (!parsed) return null;
    if (parsed.kind === "unicode") return <span className="rm-dc-uni" aria-hidden="true">{parsed.text}</span>;
    const known = emojis.find((e) => e.id === parsed.id);
    return <img className="rm-dc-emo" src={known?.url || parsed.url} alt={`:${parsed.name}:`} loading="lazy" />;
}

function Inline({ tokens, emojis }: { tokens: InlineToken[]; emojis: RoleMessageEmojiOption[] }): ReactNode {
    return tokens.map((tok, i) => {
        switch (tok.type) {
            case "text": return <span key={i}>{tok.text}</span>;
            case "bold": return <strong key={i}><Inline tokens={tok.children} emojis={emojis} /></strong>;
            case "italic": return <em key={i}><Inline tokens={tok.children} emojis={emojis} /></em>;
            case "underline": return <u key={i}><Inline tokens={tok.children} emojis={emojis} /></u>;
            case "strike": return <s key={i}><Inline tokens={tok.children} emojis={emojis} /></s>;
            case "code": return <code key={i} className="rm-dc-code">{tok.text}</code>;
            case "emoji": {
                const known = emojis.find((e) => e.id === tok.id);
                return known ? <img key={i} className="rm-dc-emo" src={known.url} alt={`:${tok.name}:`} loading="lazy" /> : <span key={i}>:{tok.name}:</span>;
            }
            case "mention": return <span key={i} className="rm-dc-mention">{tok.kind === "channel" ? "#" : "@"}…</span>;
            default: return null;
        }
    });
}

function Block({ block, emojis }: { block: MdBlock; emojis: RoleMessageEmojiOption[] }) {
    switch (block.type) {
        case "heading": {
            const cls = `rm-dc-h rm-dc-h${Math.min(3, Math.max(1, block.level))}`;
            return <div className={cls}><Inline tokens={block.children} emojis={emojis} /></div>;
        }
        case "subtext": return <div className="rm-dc-sub"><Inline tokens={block.children} emojis={emojis} /></div>;
        case "list": return <ul className="rm-dc-list">{block.lines.map((l, i) => <li key={i}><Inline tokens={l} emojis={emojis} /></li>)}</ul>;
        case "quote": return <blockquote className="rm-dc-quote">{block.lines.map((l, i) => <span key={i}>{i > 0 && <br />}<Inline tokens={l} emojis={emojis} /></span>)}</blockquote>;
        default: return <p className="rm-dc-p">{block.lines.map((l, i) => <span key={i}>{i > 0 && <br />}<Inline tokens={l} emojis={emojis} /></span>)}</p>;
    }
}

export default function RoleMessagePreview({ title, body, imageUrl, color, roles, emojis }: {
    title: string;
    body: string;
    imageUrl: string;
    /** "#rrggbb" or null for the bot's accent. */
    color: string | null;
    roles: PreviewRole[];
    emojis: RoleMessageEmojiOption[];
}) {
    const t = useT();
    const blocks = parseDiscordMarkdown(body.trim());
    const image = /^https:\/\/\S+$/i.test(imageUrl.trim()) ? imageUrl.trim() : "";
    const reactions = roles.filter((r) => previewEmoji(r.emoji));
    const accent = color ? ({ "--rm-accent": color } as CSSProperties) : undefined;
    return (
        <div className="rm-dc" role="figure" aria-label={t("roleMessages.preview.aria")}>
            <div className="rm-dc-row">
                <div className="rm-dc-ava" aria-hidden="true"><CrestIcon /></div>
                <div className="rm-dc-msg">
                    <div className="rm-dc-meta">
                        <span className="rm-dc-name">EventHelper</span>
                        <span className="rm-dc-tag">{t("roleMessages.preview.app")}</span>
                        <span className="rm-dc-time">{t("roleMessages.preview.today", { time: formatTime(Date.now()) })}</span>
                    </div>
                    <div className="rm-dc-card" style={accent}>
                        {title.trim()
                            ? <div className="rm-dc-h rm-dc-h2">{title.trim()}</div>
                            : <div className="rm-dc-h rm-dc-h2 rm-dc-empty">{t("roleMessages.preview.titlePlaceholder")}</div>}
                        {blocks.map((b, i) => <Block key={i} block={b} emojis={emojis} />)}
                        {image && <img className="rm-dc-img" src={image} alt="" loading="lazy" />}
                        {roles.length > 0 && (
                            <>
                                <hr className="rm-dc-sep" />
                                <div className="rm-dc-btns">
                                    {buttonRows(roles).map((row, n) => (
                                        <div key={n} className="rm-dc-btnrow">
                                            {row.map((r) => (
                                                <span key={r.roleId} className="rm-dc-btn">
                                                    <Emo text={r.emoji} emojis={emojis} />
                                                    {/* the bot's fallback label (rolePayload) — what Discord shows, so not translated */}
                                                    <span>{r.label.trim() || r.name || "Rolle"}</span>
                                                </span>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    {reactions.length > 0 && (
                        <div className="rm-dc-reacts" aria-label={t("roleMessages.preview.reactions")}>
                            {reactions.map((r) => (
                                <span key={r.roleId} className="rm-dc-react"><Emo text={r.emoji} emojis={emojis} />1</span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
