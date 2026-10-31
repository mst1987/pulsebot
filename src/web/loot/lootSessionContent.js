// Welcher Raid war das? — abgeleitet aus den Item-IDs einer Addon-Session.
//
// Das Addon beschriftet einen Raid-Abend mit der Instanz, die die Loot-Addons
// aufgezeichnet haben. Zwei Fälle bleiben dabei offen, und beide kommen
// regelmässig vor:
//
//   * Gargul speichert überhaupt keine Instanz. Ein reiner Gargul-Abend kommt
//     ohne Namen an.
//   * RCLootcouncil schreibt den Kontinent statt des Raids, wenn ein Item
//     ausserhalb der Instanz vergeben wurde ("Eastern Kingdoms"). Ein
//     Karazhan-Abend heisst dann nach einem halben Erdteil.
//
// Die Item-IDs wissen es besser: config/data/tbcContent.js kennt zu jedem TBC-Drop
// seinen Raid. Diese Ableitung geschieht auf dem Server und nicht im Addon —
// die Tabelle wird hier gepflegt und wächst mit jedem Patch, ohne dass jemand
// ein Addon nachziehen muss.
//
// Bewusst mehrdeutig, wo die Daten mehrdeutig sind: TBC-Abende kombinieren
// Raids (SSC + Tempest Keep, Gruul + Magtheridon). Erkannt wird deshalb nicht
// "der eine Raid", sondern die Raids, die einen nennenswerten Anteil ausmachen.
const { contentForLoot, content: contentMeta } = require("../../config/data/raidContent");

// Ab welchem Anteil der zugeordneten Items ein Raid mitgenannt wird. Darunter
// sind es Einzelstücke — ein mitgeschleppter Gruul-Kill oder ein Item, das die
// Tabelle mehreren Orten zuordnet.
const MIN_SHARE = 0.2;
// Wie viele Raids höchstens genannt werden. Mehr als drei liest niemand mehr,
// und ein Abend mit vier Raids ist ohnehin kein Abend, sondern eine Woche.
const MAX_NAMED = 3;

// Label and short name of a content of any version (rule set).
const labelOf = (id) => (contentMeta(id) || {}).label || id;
const shortOf = (id) => { const c = contentMeta(id) || {}; return c.short || c.label || id; };

// Kontinente und Zonen, die RCLootcouncil einträgt, wenn kein Raid erkannt
// wurde. Sie sehen wie ein Ortsname aus, sagen aber nichts über den Raid — ein
// aus den Items abgeleiteter Name ist dort immer die bessere Auskunft.
const VAGUE_INSTANCE = /^(eastern kingdoms|kalimdor|outland|northrend|azeroth|unknown)$/i;

/**
 * Den Instanznamen so aufräumen, wie RCLootcouncil ihn hinterlässt: mit
 * Raidgrösse ("-25 Player") und, wenn ausserhalb einer Instanz vergeben wurde,
 * mit einem nackten Bindestrich am Ende ("Eastern Kingdoms-").
 *
 * Das Addon tut das seit 1.2.0 selbst — hier trotzdem noch einmal, weil der
 * Server nicht wissen kann, welche Addon-Version gerade hochlädt, und ein
 * übrig gebliebener Bindestrich sonst dafür sorgt, dass ein Kontinent nicht als
 * Kontinent erkannt wird.
 */
function cleanInstance(raw) {
    return String(raw || "").trim().replace(/-\d+\s*Player$/i, "").replace(/-\s*$/, "").trim();
}

/**
 * Die Raids, aus denen die Items einer Session stammen.
 *
 * @param {Array<{itemId?: number, itemName?: string, instance?: string}>} items
 * @returns {{
 *   contentIds: string[],   die erkannten Raids, häufigster zuerst
 *   label: string,          "Karazhan" bzw. "SSC + Tempest Keep", "" wenn nichts erkannt
 *   matched: number,        wie viele Items zugeordnet werden konnten
 *   total: number,
 * }}
 */
function deriveContent(items, opts = {}) {
    const list = Array.isArray(items) ? items : [];
    const counts = new Map();
    let matched = 0;

    for (const item of list) {
        // `instance` bewusst nicht mitgeben: contentForLoot() würde sonst auf
        // die Instanz zurückfallen, und genau die soll hier überprüft werden.
        const { contentId } = contentForLoot({ itemId: item && item.itemId, itemName: item && item.itemName }, { versionId: opts && opts.versionId });
        if (!contentId) continue;
        counts.set(contentId, (counts.get(contentId) || 0) + 1);
        matched += 1;
    }

    if (!matched) return { contentIds: [], label: "", matched: 0, total: list.length };

    const ranked = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .filter(([, n], i) => i === 0 || n / matched >= MIN_SHARE)
        .slice(0, MAX_NAMED);

    // Ein einzelner Raid wird ausgeschrieben; bei mehreren sind die Kürzel
    // lesbarer als drei volle Namen nebeneinander.
    const label = ranked.length === 1
        ? labelOf(ranked[0][0])
        : ranked.map(([id]) => shortOf(id)).join(" + ");

    return { contentIds: ranked.map(([id]) => id), label, matched, total: list.length };
}

/**
 * Der Name, unter dem eine Session angezeigt wird.
 *
 * Was das Addon gemeldet hat, hat Vorrang — es hat die Instanz zum Zeitpunkt
 * der Vergabe gesehen. Nur wenn es nichts oder bloss einen Kontinent gemeldet
 * hat, übernimmt die Ableitung aus den Items.
 *
 * @returns {{ label: string, source: "addon"|"items"|"" , derived: object }}
 */
function sessionContentLabel(session) {
    const reported = cleanInstance(session && session.instance);
    const derived = deriveContent(session && session.items, { versionId: session && session.versionId });

    if (reported && !VAGUE_INSTANCE.test(reported)) {
        return { label: reported, source: "addon", derived };
    }
    if (derived.label) {
        return { label: derived.label, source: "items", derived };
    }
    return { label: reported, source: reported ? "addon" : "", derived };
}

module.exports = { deriveContent, sessionContentLabel, cleanInstance, MIN_SHARE, MAX_NAMED, VAGUE_INSTANCE };
