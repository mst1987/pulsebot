// How a tooltip text splits into its bold head and its explanation (ui/Tip.tsx).

/**
 * Head and explanation of a tip. A `data-tip` without a sub that is long or has
 * several lines — most of the former `title` texts — is split at its first line
 * break, or shown as plain explanation when it is one long sentence, instead of
 * being set in bold as a whole.
 */
export function tipParts(tip: string, sub: string | null): { head: string; sub: string } {
    if (sub) return { head: tip, sub };
    const nl = tip.indexOf("\n");
    if (nl > 0) return { head: tip.slice(0, nl).trim(), sub: tip.slice(nl + 1).trim() };
    if (tip.length > 60) return { head: "", sub: tip };
    return { head: tip, sub: "" };
}
