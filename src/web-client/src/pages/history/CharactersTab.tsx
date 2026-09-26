import { useMemo, useState } from "react";
import { resolveCharacters, type ApiError, type AnnotatedCharacter, type Category } from "../../api";
import { usePersistedState } from "../../lib/persistedState";
import { sortRows, type Dir } from "../../lib/tableSort";
import { SortTh } from "../../components/SortTh";
import { CharLootHover } from "../../components/CharLootHover";
import { ClassSpecCell, CharacterLink, CLASS_SOURCE_LABELS } from "../../components/ClassSpec";
import { SearchBox } from "../../components/LootFilters";
import { useToast } from "../../components/Jobs";
import { Button } from "../../components/ui/Button";
import { PartHead } from "../../components/ui/PartHead";
import Badge from "../../components/ui/Badge";

type CharSortKey = "character" | "classSpec" | "category" | "count" | "source";

const CHAR_SORT_DEFAULTS: Record<CharSortKey, Dir> = { character: "asc", classSpec: "asc", category: "asc", count: "desc", source: "asc" };

// Everything the Charaktere view remembers between visits (see usePersistedState).
type CharView = { search: string; category: string; classSpec: string; sort: CharSortKey; dir: Dir };

const CHAR_VIEW_DEFAULT: CharView = { search: "", category: "", classSpec: "", sort: "count", dir: CHAR_SORT_DEFAULTS.count };

// The category cell holds badges, one per raid series the character shows up
// in; it sorts by their names (the ids are snowflakes and would sort by channel
// creation date), a character without any last.
function charSortValue(c: AnnotatedCharacter, key: CharSortKey, categoryNames: (c: AnnotatedCharacter) => string): string | number {
    switch (key) {
        case "character": return c.character.toLowerCase();
        case "classSpec": return `${c.className} ${c.spec}`.toLowerCase().trim();
        case "category": return categoryNames(c) || "zzz";
        case "count": return c.count;
        case "source": return (CLASS_SOURCE_LABELS[c.source] || c.source || "").toLowerCase();
        default: return "";
    }
}

function CharTable({ chars, categoryNameById, sort, dir, onSort }: {
    chars: AnnotatedCharacter[];
    categoryNameById: Map<string, string>;
    sort: CharSortKey;
    dir: Dir;
    onSort: (key: CharSortKey) => void;
}) {
    return (
        <table className="idx" style={{ margin: 0 }}>
            <thead>
                <tr>
                    <SortTh sortKey="character" label="Charakter" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="classSpec" label="Klasse & Spec" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="category" label="Kategorie" sort={sort} dir={dir} onSort={onSort} />
                    <SortTh sortKey="count" label="Items" sort={sort} dir={dir} onSort={onSort} tip="Items" tipSub="Hover über die Zahl zeigt die Items." />
                    <SortTh sortKey="source" label="Quelle" sort={sort} dir={dir} onSort={onSort} tip="Quelle" tipSub="Woher Klasse und Spec stammen." />
                </tr>
            </thead>
            <tbody>
                {chars.map((c) => (
                    <tr key={c.key}>
                        <td><CharacterLink character={c.character} classColor={c.classColor} /></td>
                        <td><ClassSpecCell className={c.className} spec={c.spec} classColor={c.classColor} iconUrl={c.iconUrl} /></td>
                        <td className="small">
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {c.categoryIds.length
                                    ? c.categoryIds.map((id) => <Badge key={id} tone="accent">{categoryNameById.get(id) || id}</Badge>)
                                    : <span className="sub">—</span>}
                            </div>
                        </td>
                        <td className="small">
                            <CharLootHover
                                items={c.items || []}
                                count={c.count}
                                categoryNameById={categoryNameById}
                                showCategory={c.categoryIds.length > 1}
                            />
                        </td>
                        <td className="small">{CLASS_SOURCE_LABELS[c.source]
                            ? <Badge>{CLASS_SOURCE_LABELS[c.source]}</Badge>
                            : <span className="sub">—</span>}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function CharactersTab({ chars, categories, onChanged }: {
    chars: AnnotatedCharacter[];
    categories: Category[];
    onChanged: (msg: string) => void;
}) {
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    // Search, filters, grouping and sort live in localStorage, so they survive a
    // reload and switching away to another view (which unmounts this component).
    // Stored values are treated as untrusted: a sort key from an older build
    // falls back to the default instead of sorting by nothing.
    const [view, setView] = usePersistedState<CharView>("history-chars-view", CHAR_VIEW_DEFAULT);
    const search = view.search;
    const categoryFilter = view.category;
    const classFilter = view.classSpec;
    const sort: CharSortKey = CHAR_SORT_DEFAULTS[view.sort] ? view.sort : CHAR_VIEW_DEFAULT.sort;
    const dir: Dir = view.dir === "asc" ? "asc" : "desc";
    const patch = (p: Partial<CharView>) => setView((v) => ({ ...v, ...p }));

    // The result has to be a toast: the old page-level flash line was rendered
    // far above the fold, so a finished lookup looked like nothing had happened.
    const resolve = async () => {
        setBusy(true);
        try {
            const r = await resolveCharacters();
            onChanged(r.message);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    // Discord category names (e.g. "Montagsraid", "Pug") — the raid *type* a
    // character raids under, not the individual dated raid event.
    const categoryNameById = useMemo(() => {
        const m = new Map<string, string>();
        for (const c of categories) m.set(c.id, c.name);
        return m;
    }, [categories]);

    const categoryOptions = useMemo(() => {
        const ids = new Set<string>();
        for (const c of chars) for (const id of c.categoryIds) ids.add(id);
        return [...ids]
            .map((id) => ({ id, label: categoryNameById.get(id) || id }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [chars, categoryNameById]);

    const classOptions = useMemo(() => {
        const byKey = new Map<string, string>();
        for (const c of chars) {
            if (!c.className) continue;
            const key = `${c.className}||${c.spec}`;
            if (!byKey.has(key)) byKey.set(key, c.spec ? `${c.spec} ${c.className}` : c.className);
        }
        return [...byKey.entries()]
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [chars]);

    const onSort = (key: CharSortKey) => {
        if (key === sort) { patch({ dir: dir === "asc" ? "desc" : "asc" }); return; }
        patch({ sort: key, dir: CHAR_SORT_DEFAULTS[key] });
    };

    const missing = chars.filter((c) => !c.className || !c.spec).length;

    const head = (
        <PartHead
            icon="achievement_guildperk_everybodysfriend" tone="history" title="Charaktere" crumb="Charaktere"
            tip="Charaktere" tipSub="Jeder Charakter mit Loot, gruppiert nach Raid-Kategorie. Der Name öffnet die Loot-Historie samt Armory."
            action={chars.length ? (
                <Button
                    variant="run"
                    icon="inv_misc_spyglass_03"
                    running={busy}
                    data-tip="Klassen & Specs ergänzen"
                    data-tip-sub="Nimmt die Klasse aus dem Loot-Export bzw. einer vorhandenen Auswertung und liest den Rest aus dem Warcraft-Log des Raids."
                    onClick={resolve}
                >
                    {`Klassen & Specs ergänzen${missing ? ` (${missing} offen)` : ""}`}
                </Button>
            ) : undefined}
        />
    );

    if (!chars.length) return <div className="dash-card hl-card">{head}<div className="empty">Noch keine Charaktere mit Loot.</div></div>;

    const searchLower = search.trim().toLowerCase();
    const filtered = chars.filter((c) => {
        if (searchLower && !c.character.toLowerCase().includes(searchLower)) return false;
        if (categoryFilter && !c.categoryIds.includes(categoryFilter)) return false;
        if (classFilter && `${c.className}||${c.spec}` !== classFilter) return false;
        return true;
    });

    const categoryNames = (c: AnnotatedCharacter) =>
        c.categoryIds.map((id) => (categoryNameById.get(id) || id).toLowerCase()).sort().join(", ");
    const sorted = sortRows(filtered, (c) => charSortValue(c, sort, categoryNames), dir);

    // Group by raid category (Pug, Montagsraid, …), not by the individual dated
    // raid — a character raiding under several categories shows up in each, so
    // "nach Kategorie filtern" and "nach Kategorie gruppiert" are the same
    // mechanism: picking one just narrows the groups down to it.
    const groups = categoryOptions
        .filter((o) => !categoryFilter || o.id === categoryFilter)
        .map((o) => ({ ...o, chars: sorted.filter((c) => c.categoryIds.includes(o.id)) }))
        .filter((g) => g.chars.length);
    const ungrouped = sorted.filter((c) => !c.categoryIds.length);

    // A filter that outlives the visit needs a visible way back — otherwise a
    // search typed last week silently hides half the roster on the next one.
    const hasFilters = !!(search || categoryFilter || classFilter);

    return (
        <div className="dash-card hl-card">
            {head}
            <div className="filter-bar hl-filters">
                {/* the module's own search field (icon, tokens, focus ring) —
                    the bare input this used to be was the one control on the
                    page still wearing the browser's own look */}
                <SearchBox id="chars-search" value={search} onChange={(s) => patch({ search: s })} placeholder="Charaktername …" />
                <select id="chars-category" className="hl-sel" aria-label="Kategorie" value={categoryFilter} onChange={(e) => patch({ category: e.target.value })}>
                    <option value="">Alle Kategorien</option>
                    {categoryOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <select id="chars-class" className="hl-sel" aria-label="Klasse & Spec" value={classFilter} onChange={(e) => patch({ classSpec: e.target.value })}>
                    <option value="">Alle Klassen</option>
                    {classOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {hasFilters && (
                    <Button
                        variant="ghost"
                        data-tip="Filter zurücksetzen"
                        data-tip-sub="Suche und Filter werden lokal im Browser gespeichert."
                        onClick={() => patch({ search: "", category: "", classSpec: "" })}
                    >
                        Filter zurücksetzen
                    </Button>
                )}
            </div>
            {!sorted.length && <div className="empty">Keine Charaktere gefunden.</div>}
            {groups.map((g) => (
                <div key={g.id}>
                    <div className="hl-linked-head">
                        <strong>{g.label}</strong>
                        <Badge count>{g.chars.length}</Badge>
                    </div>
                    <CharTable chars={g.chars} categoryNameById={categoryNameById} sort={sort} dir={dir} onSort={onSort} />
                </div>
            ))}
            {!!ungrouped.length && (
                <div>
                    <div className="hl-linked-head"><strong>Ohne Kategorie</strong><Badge count>{ungrouped.length}</Badge></div>
                    <CharTable chars={ungrouped} categoryNameById={categoryNameById} sort={sort} dir={dir} onSort={onSort} />
                </div>
            )}
        </div>
    );
}
