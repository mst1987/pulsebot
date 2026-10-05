// Reading a card() payload (Components V2) in a test: the text of all its text displays, its buttons and controls and its
// colour, whatever the nesting (builders or API JSON). test/helpers/card.js reads a card the way an old embed was read.

/** Every component of a payload, nested ones and accessories included, as API JSON. */
function nodes(payload) {
    const out = [];
    const walk = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const json = typeof node.toJSON === "function" ? node.toJSON() : node;
        out.push(json);
        walk(json.components);
        walk(json.accessory);
    };
    walk(payload && payload.components);
    return out;
}

/** All text displays of a card, joined by a newline; "" for a payload without components. */
function cardText(payload) {
    return nodes(payload).filter((n) => n.type === 10 && typeof n.content === "string").map((n) => n.content).join("\n");
}

/** All buttons of a card (`{ label, url, style, … }`). */
function cardButtons(payload) {
    return nodes(payload).filter((n) => n.type === 2);
}

/** Every button / select of a card (flat). */
function cardControls(payload) {
    return nodes(payload).filter((n) => n.type === 2 || (n.type >= 3 && n.type <= 8));
}

/** The accent colour of a card's container. */
function cardColor(payload) {
    const c = nodes(payload).find((n) => n.type === 17);
    return c ? c.accent_color : undefined;
}

module.exports = { cardText, cardButtons, cardControls, cardColor };
