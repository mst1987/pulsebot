// A small Markdown-to-HTML step for the two end-user guides (#474):
// docs/guide-discord.md and docs/guide-web-admin.md are the one source of the
// help page /docs (docsPage.js). No dependency — the guides only use a narrow
// subset: `#`/`##`/`###` headings, paragraphs, `-` and `1.` lists (nested by
// indentation), **bold**, *italic*, `code` and [links](target). Everything else
// is plain text: every character from the file is HTML-escaped, raw HTML in the
// Markdown never reaches the page.
const { esc } = require("../report/render");

// GitHub's heading anchors, so the links the guides already use
// (`guide-web-admin.md#historie--loot`) keep working: lower case, everything
// except letters, digits, spaces and hyphens dropped, spaces become hyphens.
function slugify(text) {
    return String(text).trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .replace(/\s/g, "-");
}

// Placeholders for already rendered pieces (code spans, links). \u0000 never
// occurs in a guide and survives esc() untouched.
const HOLD = "\u0000";

function emphasis(escaped) {
    return escaped
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*\p{L}\p{N}])\*(?![\s*])(.+?)\*(?![*\p{L}\p{N}])/gu, "$1<em>$2</em>");
}

/**
 * One line of inline Markdown to safe HTML.
 * @param {string} text
 * @param {(href: string) => ({ href: string, external?: boolean } | null)} resolveLink
 *   where a link points; null keeps only its text.
 */
function renderInline(text, resolveLink) {
    const held = [];
    const hold = (html) => `${HOLD}${held.push(html) - 1}${HOLD}`;
    let s = String(text).replace(/`([^`]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
        const inner = emphasis(esc(label)).replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, "g"), (m, i) => held[Number(i)]);
        const target = resolveLink ? resolveLink(href) : null;
        if (!target) return hold(inner);
        const ext = target.external ? " target=\"_blank\" rel=\"noopener noreferrer\"" : "";
        return hold(`<a href="${esc(target.href)}"${ext}>${inner}</a>`);
    });
    s = emphasis(esc(s));
    // Placeholders may nest (a code span inside a link label) — resolve until none is left.
    const re = new RegExp(`${HOLD}(\\d+)${HOLD}`, "g");
    while (re.test(s)) s = s.replace(re, (m, i) => held[Number(i)]);
    return s;
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

// Nested list items ({ indent, ordered, text }) to <ul>/<ol>; deeper-indented
// items belong to the item before them.
function renderList(items, inline) {
    const base = items[0].indent;
    const top = [];
    for (const item of items) {
        if (item.indent > base && top.length) top[top.length - 1].children.push(item);
        else top.push({ ...item, children: [] });
    }
    const tag = top[0].ordered ? "ol" : "ul";
    const lis = top.map((it) => `<li>${inline(it.text)}${it.children.length ? renderList(it.children, inline) : ""}</li>`).join("");
    return `<${tag}>${lis}</${tag}>`;
}

/**
 * Splits a guide into its parts.
 * @returns {{ title: string, blocks: object[] }} blocks are
 *   { type: "heading", level, text } | { type: "para", text } | { type: "list", items }.
 */
function parseBlocks(markdown) {
    const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let title = "";
    let para = null;
    let list = null;
    const flush = () => {
        if (para) blocks.push({ type: "para", text: para.join(" ") });
        if (list) blocks.push({ type: "list", items: list });
        para = null;
        list = null;
    };
    for (const raw of lines) {
        const line = raw.replace(/\s+$/, "");
        if (!line.trim()) { flush(); continue; }
        const h = HEADING.exec(line);
        if (h) {
            flush();
            if (h[1].length === 1 && !title) title = h[2];
            else blocks.push({ type: "heading", level: h[1].length, text: h[2] });
            continue;
        }
        const li = LIST_ITEM.exec(line);
        if (li) {
            if (para) { blocks.push({ type: "para", text: para.join(" ") }); para = null; }
            list = list || [];
            list.push({ indent: li[1].length, ordered: /\d/.test(li[2]), text: li[3] });
            continue;
        }
        // A plain line right under a list item continues that item.
        if (list) { list[list.length - 1].text += ` ${line.trim()}`; continue; }
        (para = para || []).push(line.trim());
    }
    flush();
    return { title, blocks };
}

// A paragraph that is one short italic phrase (`*Bereich "Raids"*`) — the
// section's scope, shown as a badge on the card instead of in its body.
function scopeOf(block) {
    if (!block || block.type !== "para") return null;
    const m = /^\*([^*]+)\*$/.exec(block.text);
    return m && m[1].length <= 40 ? m[1] : null;
}

/**
 * A guide as page sections: the intro (everything before the first `##`) and
 * one section per `##` heading with its `###` sub-headings inside.
 * Paragraphs starting with "Technik:" point developers to the technical docs
 * and are left out — the help page is for raiders and the orga.
 * @param {string} markdown
 * @param {object} opts { idPrefix, resolveLink }
 * @returns {{ title, intro: string[], sections: { id, slug, title, scope, html }[] }}
 *   intro is a list of rendered blocks (HTML strings).
 */
function parseGuide(markdown, { idPrefix = "", resolveLink = null } = {}) {
    const { title, blocks } = parseBlocks(markdown);
    const inline = (t) => renderInline(t, resolveLink);
    const idOf = (text) => `${idPrefix ? `${idPrefix}-` : ""}${slugify(text)}`;
    const intro = [];
    const sections = [];
    let current = null;
    for (const block of blocks) {
        if (block.type === "para" && /^Technik:/.test(block.text)) continue;
        if (block.type === "heading" && block.level <= 2) {
            current = { id: idOf(block.text), slug: slugify(block.text), title: block.text, scope: null, parts: [] };
            sections.push(current);
            continue;
        }
        let html;
        if (block.type === "heading") html = `<h3 id="${esc(idOf(block.text))}">${inline(block.text)}</h3>`;
        else if (block.type === "list") html = renderList(block.items, inline);
        else {
            const scope = current && !current.parts.length && !current.scope ? scopeOf(block) : null;
            if (scope) { current.scope = scope; continue; }
            html = `<p>${inline(block.text)}</p>`;
        }
        (current ? current.parts : intro).push(html);
    }
    return {
        title,
        intro,
        sections: sections.map(({ parts, ...s }) => ({ ...s, html: parts.join("\n") })),
    };
}

module.exports = { parseGuide, parseBlocks, renderInline, slugify };
