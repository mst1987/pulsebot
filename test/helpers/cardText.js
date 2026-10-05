// Reading a card() payload in a test: the text of all its text displays and its buttons, whatever the nesting.

function walk(node, out) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return; }
    out.push(node);
    walk(node.components, out);
    walk(node.accessory, out);
}

function nodes(payload) {
    const out = [];
    walk(payload && payload.components, out);
    return out;
}

/** All text displays of a card, joined by a newline. */
function cardText(payload) {
    return nodes(payload).filter((n) => n.type === 10).map((n) => n.content).join("\n");
}

/** All buttons of a card (`{ label, url, style, … }`). */
function cardButtons(payload) {
    return nodes(payload).filter((n) => n.type === 2);
}

/** The accent colour of a card's container. */
function cardColor(payload) {
    const c = nodes(payload).find((n) => n.type === 17);
    return c ? c.accent_color : undefined;
}

module.exports = { cardText, cardButtons, cardColor };
