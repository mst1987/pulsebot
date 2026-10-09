// The layout and selection rules of the raid plan's pickers (docs/raidplan.md), pure: one flyout that opens beside
// what opened it, shows its entries as a grid of compact chips in sections, never scrolls (a page ends where the room
// ends, more entries mean another page, a search or a tab), lets several be ticked at once and range / all at a click.
// The component is components/raidplan/Flyout.tsx.
//
// Written to be strippable (src/web-client/src/lib/flyout.test.ts runs it): one-line signatures, no typed locals or casts.

export type FlyItem = { key: string; label: string; on: boolean; group: string };
export type FlySection = { title: string; items: FlyItem[] };
export type FlyPage = { sections: FlySection[] };

/** What a section's title takes of a page, counted in chips. */
export const TITLE_COST = 2;
/** From this many entries on the flyout has a search field. */
export const SEARCH_FROM = 24;

/** The entries grouped in sections, in the order the groups first appear. */
export function sectionsOf(items: FlyItem[]): FlySection[] {
    const out: FlySection[] = [];
    for (const it of items) {
        let s = out.find((x) => x.title === it.group);
        if (!s) { s = { title: it.group, items: [] }; out.push(s); }
        s.items.push(it);
    }
    return out;
}

/** The entries a search text (label) and a tab (a group; "" = all) let through. */
export function filterItems(items: FlyItem[], query: string, tab: string): FlyItem[] {
    const q = query.trim().toLowerCase();
    return items.filter((i) => (!tab || i.group === tab) && (!q || i.label.toLowerCase().indexOf(q) >= 0));
}

/**
 * Splits the sections into pages of at most \`capacity\` chips (a section title counts \`TITLE_COST\`): a section stays
 * together on a page when it fits, a bigger one continues on the next page under the same title, nothing scrolls.
 */
export function paginate(sections: FlySection[], capacity: number): FlyPage[] {
    const cap = Math.max(TITLE_COST + 1, Math.floor(capacity));
    const pages: FlyPage[] = [];
    let page = emptyPage();
    let used = 0;
    const flush = () => { if (page.sections.length > 0) pages.push(page); page = emptyPage(); used = 0; };
    for (const s of sections) {
        const room = cap - TITLE_COST;
        for (let i = 0; i < s.items.length; i += room) {
            const piece = s.items.slice(i, i + room);
            if (used > 0 && used + TITLE_COST + piece.length > cap) flush();
            page.sections.push({ title: s.title, items: piece });
            used += TITLE_COST + piece.length;
        }
    }
    flush();
    return pages;
}

function emptyPage(): FlyPage {
    return { sections: [] };
}

/** The keys between two clicked ones (both included), in the order of \`order\`; one key alone when either is unknown. */
export function rangeKeys(order: string[], a: string, b: string): string[] {
    const i = order.indexOf(a);
    const j = order.indexOf(b);
    if (i < 0 || j < 0) return [b];
    return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** What "all of this section" does: every entry is switched on, or, when all are on already, off. Returns the keys to toggle. */
export function toggleAllKeys(section: FlySection): string[] {
    const allOn = section.items.length > 0 && section.items.every((i) => i.on);
    return section.items.filter((i) => allOn || !i.on).map((i) => i.key);
}

/** How many entries are ticked. */
export function ticked(items: FlyItem[]): number {
    return items.filter((i) => i.on).length;
}
