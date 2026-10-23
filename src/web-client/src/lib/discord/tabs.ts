import { matchesHref } from "../app/menu";

// The tabs of System › Discord (components/channels/DiscordTabs.tsx): which one a
// path belongs to. Kept out of the component file so it stays a pure component
// module (react-refresh/only-export-components).

/** The id of the tab a path belongs to: the longest href it lies under. */
export function activeTab(items: { id: string; href: string }[], pathname: string): string {
    return [...items].sort((a, b) => b.href.length - a.href.length).find((i) => matchesHref(i.href, pathname))?.id || "";
}

/**
 * The tabs in the order they are shown: the family's landing page (the overview,
 * menu.json "landing") first, the rest in menu order. Items without a landing
 * entry keep their order.
 */
export function discordTabOrder<T extends { href: string; landing?: string }>(items: T[]): T[] {
    const landing = items.find((i) => i.landing)?.landing;
    const first = landing ? items.find((i) => i.href === landing) : undefined;
    return first ? [first, ...items.filter((i) => i !== first)] : items;
}
