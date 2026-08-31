import type { Category, Role } from "../api";

// Everything that is configured *per raid category*, on one card per category
// instead of scattered over four tabs (Events / Loot / Raidsheets / Raider-Chars,
// as it used to be): the raider roles, the loot addon in use and the fixed
// sheet. Adding a category is one pass down one card, not four visits to the
// same category list.
//
// A category that isn't an event category shows nothing but its switch — those
// settings would have no effect, and the guild's Discord usually holds far more
// categories than raid ones.

export type CategorySheet = { url: string; name: string };

type Row = { id: string; name: string; unknown: boolean };

/**
 * The categories to render: the guild's live ones, plus any id that is
 * configured but no longer exists in Discord (a deleted or renamed category).
 * Dropping those silently would delete their settings on the next save without
 * anyone seeing it happen.
 */
function rowsFor(categories: Category[], configured: string[]): Row[] {
    const known = new Set(categories.map((c) => c.id));
    const extra: Row[] = [];
    for (const id of configured) {
        if (known.has(id)) continue;
        known.add(id);
        extra.push({ id, name: id, unknown: true });
    }
    return [...categories.map((c) => ({ id: c.id, name: c.name, unknown: false })), ...extra];
}

export default function CategoryMatrix({
    categories, roles, categoryIds, categoryRoles, categoryLootTool, categorySheets,
    onToggleCategory, onToggleRole, onLootTool, onSheet,
}: {
    categories: Category[];
    roles: Role[];
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    categoryLootTool: Record<string, string>;
    categorySheets: Record<string, CategorySheet>;
    onToggleCategory: (id: string) => void;
    onToggleRole: (categoryId: string, roleId: string) => void;
    onLootTool: (categoryId: string, tool: string) => void;
    onSheet: (categoryId: string, sheet: CategorySheet) => void;
}) {
    const configured = [
        ...categoryIds,
        ...Object.keys(categoryRoles),
        ...Object.keys(categoryLootTool),
        ...Object.keys(categorySheets),
    ];
    const rows = rowsFor(categories, configured);
    // Only roles whose name says "raid" are offered — the same filter the
    // category/role matrix has always used, to keep a guild's dozens of cosmetic
    // roles out of the picker.
    const raidRoles = roles.filter((r) => /raid/i.test(r.name || ""));

    if (!rows.length) {
        return <p className="hint">Keine Kategorien geladen (Server gewählt und Bot online?). Die Auswahl ist verfügbar, sobald der Bot verbunden ist.</p>;
    }

    return (
        <>
            {rows.map((cat) => {
                const active = categoryIds.includes(cat.id);
                const assigned = new Set(categoryRoles[cat.id] || []);
                const sheet = categorySheets[cat.id] || { url: "", name: "" };
                return (
                    <section className="catcard" key={cat.id}>
                        <div className={`catcard-head${active ? "" : " is-off"}`}>
                            <label className="switch-row">
                                <span className="switch">
                                    <input type="checkbox" checked={active} onChange={() => onToggleCategory(cat.id)} />
                                    <span className="switch-track"><span className="switch-thumb" /></span>
                                </span>
                                <b>{cat.name}</b>
                            </label>
                            {cat.unknown && <span className="hint">unbekannte ID — abwählen zum Entfernen</span>}
                            {active && (
                                <span className="catcard-tags">
                                    <span className="cat-badge">{assigned.size} {assigned.size === 1 ? "Rolle" : "Rollen"}</span>
                                    {!!categoryLootTool[cat.id] && (
                                        <span className="cat-badge">{categoryLootTool[cat.id] === "gargul" ? "Gargul" : "RCLootcouncil"}</span>
                                    )}
                                    {!!sheet.url && <span className="cat-badge">Sheet</span>}
                                </span>
                            )}
                        </div>

                        {active && (
                            <div className="catcard-body">
                                <div className="field">
                                    <label>Raider-Rollen</label>
                                    <div className="rolegrid">
                                        {raidRoles.length
                                            ? raidRoles.map((r) => (
                                                <label className="rolebox" key={r.id}>
                                                    <input type="checkbox" checked={assigned.has(r.id)} onChange={() => onToggleRole(cat.id, r.id)} />
                                                    @{r.name}
                                                </label>
                                            ))
                                            : <span className="hint">Keine Rolle gefunden, deren Name „Raid" enthält.</span>}
                                    </div>
                                </div>

                                <div className="catcard-grid">
                                    <div className="field">
                                        <label htmlFor={`loottool-${cat.id}`}>Loot-Tool</label>
                                        <select
                                            id={`loottool-${cat.id}`}
                                            value={categoryLootTool[cat.id] || ""}
                                            onChange={(e) => onLootTool(cat.id, e.target.value)}
                                        >
                                            <option value="">— nicht gesetzt —</option>
                                            <option value="gargul">Gargul</option>
                                            <option value="rclc">RCLootcouncil</option>
                                        </select>
                                        <div className="hint">Wählt beim Loot-Import den passenden Parser vor.</div>
                                    </div>

                                    <div className="field">
                                        <label htmlFor={`catsheet-url-${cat.id}`}>Festes Raidsheet</label>
                                        <input
                                            id={`catsheet-url-${cat.id}`}
                                            type="url"
                                            value={sheet.url}
                                            onChange={(e) => onSheet(cat.id, { ...sheet, url: e.target.value })}
                                            placeholder="https://docs.google.com/spreadsheets/… (leer = keins)"
                                        />
                                        <input
                                            type="text"
                                            style={{ marginTop: 6 }}
                                            value={sheet.name}
                                            onChange={(e) => onSheet(cat.id, { ...sheet, name: e.target.value })}
                                            placeholder="Anzeigename (optional), z. B. „SSC/TK Setup“"
                                        />
                                        <div className="hint">Jeder Raid dieser Kategorie verlinkt dieses Sheet — außer es wurde für den Raid selbst eins erstellt.</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>
                );
            })}
        </>
    );
}
