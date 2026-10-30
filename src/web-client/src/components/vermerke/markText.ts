// Texts and links of a note mark (#981), shared by the mark, the slot tooltip
// and the setup's shadowban line - outside the component file for fast refresh.
import { NOTE_REASONS, type NoteReason } from "../../api/vermerke";

/** "Späte Abmeldung ×2 · Loot": the reasons in the fixed order, the count from two on. */
export function reasonSummary(t: (key: string) => string, reasons: Partial<Record<NoteReason, number>>): string {
    return NOTE_REASONS
        .filter((r) => (reasons[r] || 0) > 0)
        .map((r) => {
            const word = t(`vermerke.reason.${r}`);
            const n = reasons[r] || 0;
            return n > 1 ? `${word} ×${n}` : word;
        })
        .join(" · ");
}

/** The link target of a person's notes. */
export function vermerkeHref(userId: string): string {
    return `/vermerke?user=${encodeURIComponent(userId)}`;
}
