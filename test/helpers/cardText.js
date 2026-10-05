// The texts of a card() payload (Components V2) as one string, for tests that used to assert on `content`.
// Walks the component tree and joins every TextDisplay content (type 10) with a newline.
function collect(components, out) {
    for (const c of Array.isArray(components) ? components : []) {
        if (!c) continue;
        const json = typeof c.toJSON === "function" ? c.toJSON() : c;
        if (json.type === 10 && typeof json.content === "string") out.push(json.content);
        if (json.accessory) collect([json.accessory], out);
        collect(json.components, out);
    }
}

/** All text of a card payload; "" for a payload without components. */
function cardText(payload) {
    const out = [];
    collect(payload && payload.components, out);
    return out.join("\n");
}

/** Every button/select/link component of a card (flat). */
function cardControls(payload) {
    const out = [];
    const walk = (list) => {
        for (const c of Array.isArray(list) ? list : []) {
            const json = c && typeof c.toJSON === "function" ? c.toJSON() : c;
            if (!json) continue;
            if (json.type === 2 || (json.type >= 3 && json.type <= 8)) out.push(json);
            walk(json.components);
        }
    };
    walk(payload && payload.components);
    return out;
}

module.exports = { cardText, cardControls };
