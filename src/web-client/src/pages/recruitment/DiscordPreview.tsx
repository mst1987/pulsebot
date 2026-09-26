import type { ReactNode } from "react";
import type { Emoji, TextChannel } from "../../api";
import { CrestIcon } from "../../components/icons";
import { parseDiscordMarkdown, type InlineToken, type MdBlock } from "../../lib/discordMarkdown";
import { formatTime } from "../../lib/format";

// How a recruitment message will look in Discord: the bot's name and avatar,
// the text with Discord's markdown rendered and the server's own emojis in
// place of their <:name:id> codes, and the apply button under it. A pure
// renderer — it posts nothing and fetches nothing; the emojis and channels come
// with the page's data.
//
// An emoji the server does not have (deleted, from another server) shows as
// ":name:", which is what Discord itself falls back to.

function emojiUrl(token: { id: string }, emojis: Emoji[]): string {
    const known = emojis.find((e) => e.id === token.id);
    return known ? known.url : "";
}

function Inline({ tokens, emojis, channels }: { tokens: InlineToken[]; emojis: Emoji[]; channels: TextChannel[] }): ReactNode {
    return tokens.map((t, i) => {
        switch (t.type) {
            case "text": return <span key={i}>{t.text}</span>;
            case "bold": return <strong key={i}><Inline tokens={t.children} emojis={emojis} channels={channels} /></strong>;
            case "italic": return <em key={i}><Inline tokens={t.children} emojis={emojis} channels={channels} /></em>;
            case "underline": return <u key={i}><Inline tokens={t.children} emojis={emojis} channels={channels} /></u>;
            case "strike": return <s key={i}><Inline tokens={t.children} emojis={emojis} channels={channels} /></s>;
            case "code": return <code key={i} className="dc-code">{t.text}</code>;
            case "emoji": {
                const url = emojiUrl(t, emojis);
                return url
                    ? <img key={i} className="dc-emoji" src={url} alt={`:${t.name}:`} data-tip={`:${t.name}:`} loading="lazy" />
                    : <span key={i} className="dc-emoji-missing" data-tip="Emoji nicht auf dem Server" data-tip-sub="Discord zeigt an dieser Stelle nur den Namen.">:{t.name}:</span>;
            }
            case "mention": {
                if (t.kind === "channel") {
                    const ch = channels.find((c) => c.id === t.id);
                    return <span key={i} className="dc-mention">#{ch ? ch.name : "Kanal"}</span>;
                }
                return <span key={i} className="dc-mention">@{t.kind === "role" ? "Rolle" : "Mitglied"}</span>;
            }
            default: return null;
        }
    });
}

function Lines({ lines, emojis, channels }: { lines: InlineToken[][]; emojis: Emoji[]; channels: TextChannel[] }) {
    return lines.map((l, i) => (
        <span key={i}>
            {i > 0 && <br />}
            <Inline tokens={l} emojis={emojis} channels={channels} />
        </span>
    ));
}

function Block({ block, emojis, channels }: { block: MdBlock; emojis: Emoji[]; channels: TextChannel[] }) {
    switch (block.type) {
        case "heading": {
            const content = <Inline tokens={block.children} emojis={emojis} channels={channels} />;
            if (block.level === 1) return <h1 className="dc-h dc-h1">{content}</h1>;
            if (block.level === 2) return <h2 className="dc-h dc-h2">{content}</h2>;
            return <h3 className="dc-h dc-h3">{content}</h3>;
        }
        case "subtext": return <div className="dc-sub"><Inline tokens={block.children} emojis={emojis} channels={channels} /></div>;
        case "list": return <ul className="dc-list">{block.lines.map((l, i) => <li key={i}><Inline tokens={l} emojis={emojis} channels={channels} /></li>)}</ul>;
        case "quote": return <blockquote className="dc-quote"><Lines lines={block.lines} emojis={emojis} channels={channels} /></blockquote>;
        default: return <p className="dc-p"><Lines lines={block.lines} emojis={emojis} channels={channels} /></p>;
    }
}

function nowLabel(): string {
    return `Heute um ${formatTime(Date.now())}`;
}

export default function DiscordPreview({ content, buttonLabel, emojis, channels = [], botName = "EventHelper" }: {
    content: string;
    buttonLabel: string;
    emojis: Emoji[];
    channels?: TextChannel[];
    botName?: string;
}) {
    const blocks = parseDiscordMarkdown(content);
    return (
        <div className="dc">
            <div className="dc-row">
                <div className="dc-ava" aria-hidden="true"><CrestIcon /></div>
                <div className="dc-msg">
                    <div className="dc-meta">
                        <span className="dc-name">{botName}</span>
                        <span className="dc-tag">APP</span>
                        <span className="dc-time">{nowLabel()}</span>
                    </div>
                    {blocks.length
                        ? blocks.map((b, i) => <Block key={i} block={b} emojis={emojis} channels={channels} />)
                        : <p className="dc-p dc-empty">Noch kein Text.</p>}
                    {/* Same default label as buildRecruitmentMessage() in src/web/discord.js. */}
                    <div className="dc-btn">{buttonLabel.trim() || "Jetzt bewerben"}</div>
                </div>
            </div>
        </div>
    );
}
