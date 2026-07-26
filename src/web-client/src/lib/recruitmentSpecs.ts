// Ported 1:1 from src/utils/recruitmentSpecs.js (the SSR admin's spec-picker
// parsing logic) — same regex, same block-detection/insert/remove behavior, so
// a template's "## <emoji> Spec Name" block round-trips identically whether
// edited in the classic admin or here. The class/spec catalog itself is NOT
// duplicated here — it comes from GET /api/recruitment's `specCatalog` field
// (computed once server-side from config/classlist.js) to avoid data drift.

export type SpecCatalogEntry = { key: string; name: string; icon: string; sodclazz: string };

export type SpecEntry = {
    index: number;
    raw: string;
    iconName: string;
    iconId: string;
    label: string;
    spec: SpecCatalogEntry | null;
};

export type ParsedWantedBlock = {
    lines: string[];
    blockStart: number;
    blockEnd: number;
    entries: SpecEntry[];
};

// A "## <emoji> Label" (or "## Label") heading line.
export const SPEC_LINE_RE = /^##\s+(?:<a?:([A-Za-z0-9_~]+):(\d+)>\s*)?(.+?)\s*$/;

/** Find the catalog entry for a detected icon name and/or label text. */
export function resolveSpec(iconName: string, label: string, catalog: SpecCatalogEntry[]): SpecCatalogEntry | null {
    const icon = (iconName || "").toLowerCase();
    const text = (label || "").trim().toLowerCase();
    if (icon) {
        const byIcon = catalog.find((s) => s.icon.toLowerCase() === icon);
        if (byIcon) return byIcon;
        // Guild-uploaded emoji names don't always match classlist.js exactly
        // (e.g. a guild's "beastmastery" emoji vs. classlist's "beastmaster" icon
        // key) — a same-prefix fallback catches these common near-misses.
        const byIconPrefix = catalog.find((s) => {
            const si = s.icon.toLowerCase();
            return si.length > 3 && icon.length > 3 && (si.startsWith(icon) || icon.startsWith(si));
        });
        if (byIconPrefix) return byIconPrefix;
    }
    if (text) {
        const byName = catalog.find((s) => s.name.toLowerCase() === text);
        if (byName) return byName;
    }
    return null;
}

/**
 * Scan a template body for the contiguous run of "## …" heading lines that
 * make up the wanted-specs block: the longest consecutive run of heading
 * lines containing at least one line that resolves to a known spec. Returns
 * line indices (into body.split("\n")) so callers can splice the block.
 */
export function parseWantedBlock(body: string, catalog: SpecCatalogEntry[]): ParsedWantedBlock {
    const lines = String(body || "").split("\n");
    const runs: { start: number; entries: SpecEntry[] }[] = [];
    let current: { start: number; entries: SpecEntry[] } | null = null;
    for (let i = 0; i < lines.length; i++) {
        const m = SPEC_LINE_RE.exec(lines[i]);
        if (m) {
            const spec = resolveSpec(m[1], m[3], catalog);
            const entry: SpecEntry = { index: i, raw: lines[i], iconName: m[1] || "", iconId: m[2] || "", label: m[3], spec };
            if (!current) { current = { start: i, entries: [entry] }; } else { current.entries.push(entry); }
        } else if (current) {
            runs.push(current);
            current = null;
        }
    }
    if (current) runs.push(current);

    const block = runs.find((r) => r.entries.some((e) => e.spec)) || null;
    return {
        lines,
        blockStart: block ? block.start : -1,
        blockEnd: block ? block.start + block.entries.length - 1 : -1,
        entries: block ? block.entries : [],
    };
}

/** Render a single "## <emoji> Name" line for a catalog spec. */
export function buildSpecLine(spec: SpecCatalogEntry, emojiCode: string): string {
    return emojiCode ? `## ${emojiCode} ${spec.name}` : `## ${spec.name}`;
}

/**
 * Append `spec` to the body's wanted-specs block, creating the block if none
 * exists yet — right after a line that looks like a "Gesucht"/"wanted"
 * heading, or at the end of the body as a last resort. Never touches
 * unrelated lines.
 */
export function insertSpecLine(body: string, spec: SpecCatalogEntry, emojiCode: string, catalog: SpecCatalogEntry[]): string {
    const parsed = parseWantedBlock(body, catalog);
    const { lines } = parsed;
    const newLine = buildSpecLine(spec, emojiCode);

    if (parsed.blockEnd >= 0) {
        lines.splice(parsed.blockEnd + 1, 0, newLine);
        return lines.join("\n");
    }

    const headingIdx = lines.findIndex((l) => /gesucht|wanted|looking for/i.test(l.replace(/^#+\s*/, "").replace(/<a?:\w+:\d+>/g, "")));
    if (headingIdx >= 0) {
        lines.splice(headingIdx + 1, 0, newLine);
        return lines.join("\n");
    }

    const prefix = lines.length && lines.some((l) => l.trim()) ? [...lines, "", "## Gesucht", newLine] : ["## Gesucht", newLine];
    return prefix.join("\n");
}

/** Remove the block line at `lineIndex` (as returned in parseWantedBlock entries) verbatim. */
export function removeSpecLine(body: string, lineIndex: number): string {
    const lines = String(body || "").split("\n");
    if (lineIndex < 0 || lineIndex >= lines.length) return body;
    lines.splice(lineIndex, 1);
    return lines.join("\n");
}
