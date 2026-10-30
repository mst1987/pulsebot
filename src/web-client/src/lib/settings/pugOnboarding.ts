import type { Tone } from "../../components/ui/Badge";
import type { PugCategory, PugItemStatus, PugOnboardingOverview, PugPrerequisite, PugPrompt, PugPromptOption, PugRole } from "../../api";

// Roles & onboarding of a PuG server (#906, pages/settings/discord/PugOnboardingPart.tsx):
// what the page shows as blocked, what the button may do and what the preview
// lists. Pure functions over the overview of GET /api/discord/pug-onboarding.

/** The badge tone of a status: same = ok, new and changed = mid (something will change), lost = bad. */
export function statusTone(status: PugItemStatus): Tone {
    if (status === "same") return "ok";
    if (status === "lost") return "bad";
    return "mid";
}

/** The prerequisites that are known to fail (null = unknown, not a blocker). */
export function blockers(ov: PugOnboardingOverview | null): PugPrerequisite[] {
    return ((ov && ov.prerequisites) || []).filter((p) => p.ok === false);
}

/** Has the server at least one PuG category (an open raid category)? */
export const hasPug = (ov: PugOnboardingOverview | null): boolean => !!(ov && ov.online && (ov.pugCategories || []).length);

/** May the button run: online, PuG categories (at least one switched on), something to change, nothing blocking, onboarding readable. */
export function canApply(ov: PugOnboardingOverview | null): boolean {
    if (!ov || !hasPug(ov)) return false;
    if (!selectedIdsOf(ov).length || !ov.fingerprint) return false;
    if (!ov.changes) return false;
    if (ov.onboardingError) return false;
    return blockers(ov).length === 0;
}

/** The name of the role a key stands for ("version:tbc" → "TBC"), the key itself when unknown. */
export function roleNameOf(ov: PugOnboardingOverview, roleKey: string): string {
    const role = (ov.roles || []).find((r) => r.key === roleKey);
    return role ? role.name : roleKey;
}

export type PugPreview = {
    newRoles: PugRole[];
    changedRoles: PugRole[];
    categories: PugCategory[];
    /** the bot's questions that are new or change */
    prompts: PugPrompt[];
    /** questions of someone else: the apply removes them */
    lostPrompts: PugPrompt[];
    /** answers of the bot's questions that are not the bot's: they go away */
    lostOptions: PugPromptOption[];
};

/** What the dialog "Das ändert sich in Discord" lists, grouped. */
export function previewOf(ov: PugOnboardingOverview): PugPreview {
    const roles = ov.roles || [];
    const prompts = ov.prompts || [];
    const own = prompts.filter((p) => p.status !== "lost");
    return {
        newRoles: roles.filter((r) => r.status === "new"),
        changedRoles: roles.filter((r) => r.status === "changed"),
        categories: (ov.categories || []).filter((c) => c.status !== "same"),
        prompts: own.filter((p) => p.status !== "same"),
        lostPrompts: prompts.filter((p) => p.status === "lost"),
        lostOptions: own.flatMap((p) => p.options.filter((o) => o.status === "lost")),
    };
}

/** How many single changes the apply made (for the toast). */
export const doneCount = (done: { roles: number; categories: number; channels?: number; onboarding: boolean }): number =>
    done.roles + done.categories + (done.channels || 0) + (done.onboarding ? 1 : 0);

/** The categories switched on (all of them while nothing was chosen yet). */
export const selectedIdsOf = (ov: PugOnboardingOverview | null): string[] =>
    ((ov && ov.pugCategories) || []).filter((c) => c.selected !== false).map((c) => c.id);

/** The selection after switching one category on or off, in the order of the list. */
export function toggleCategory(ov: PugOnboardingOverview, id: string, on: boolean): string[] {
    const set = new Set(selectedIdsOf(ov));
    if (on) set.add(id); else set.delete(id);
    return (ov.pugCategories || []).map((c) => c.id).filter((x) => set.has(x));
}

/** Channels with their own rights in the switched-on categories: they stay visible to everyone. */
export const visibleChannelsOf = (ov: PugOnboardingOverview): { category: string; channel: string }[] =>
    (ov.categories || []).flatMap((c) => (c.unsynced || []).map((ch) => ({ category: c.name, channel: ch.name })));

/** The switched-on categories whose version is only the default (no version set for them). */
export const fallbackCategoriesOf = (ov: PugOnboardingOverview): string[] =>
    (ov.pugCategories || []).filter((c) => c.selected !== false && c.fallback).map((c) => c.name);

export type PugSortKey = "what" | "want" | "have" | "status";

/** One line of the wanted/actual table: a role, a question or a category. */
export type PugRow =
    | { id: string; order: number; kind: "role"; role: PugRole }
    | { id: string; order: number; kind: "prompt"; prompt: PugPrompt }
    | { id: string; order: number; kind: "category"; category: PugCategory };

/** The table's lines in their natural order: roles, then questions, then categories. */
export function rowsOf(ov: PugOnboardingOverview): PugRow[] {
    const rows: PugRow[] = [
        ...(ov.roles || []).map((role) => ({ id: `role:${role.key}`, order: 0, kind: "role" as const, role })),
        ...(ov.prompts || []).map((prompt) => ({ id: `prompt:${prompt.key || `lost:${prompt.id}`}`, order: 0, kind: "prompt" as const, prompt })),
        ...(ov.categories || []).map((category) => ({ id: `category:${category.id}`, order: 0, kind: "category" as const, category })),
    ];
    return rows.map((row, order) => ({ ...row, order }));
}

/** Lost first, then new, then changed, last what already fits: the order "Status" sorts ascending in. */
const STATUS_RANK: Record<PugItemStatus, number> = { lost: 0, new: 1, changed: 2, same: 3 };

const statusOf = (row: PugRow): PugItemStatus =>
    row.kind === "role" ? row.role.status : row.kind === "prompt" ? row.prompt.status : row.category.status;

/** What a column sorts a line by: "what" keeps the natural order, names compare lowercase. */
export function sortValueOf(row: PugRow, key: PugSortKey): string | number {
    if (key === "what") return row.order;
    if (key === "status") return STATUS_RANK[statusOf(row)];
    if (row.kind === "role") return ((key === "want" ? row.role.name : row.role.current?.name) || "").toLowerCase();
    if (row.kind === "prompt") {
        const absent = (key === "want" && row.prompt.status === "lost") || (key === "have" && row.prompt.status === "new");
        return absent ? "" : row.prompt.title.toLowerCase();
    }
    return key === "want" ? row.category.name.toLowerCase() : row.category.missing.length;
}
