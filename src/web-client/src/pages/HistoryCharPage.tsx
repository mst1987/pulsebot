import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getHistoryChar, type ApiError, type HistoryCharData, type LootItem } from "../api";
import { fmtMs } from "../lib/format";
import { ClassSpecIcon, CharacterLink } from "../components/ClassSpec";

type CharTab = "gear" | "loot";

const LOOT_TOOL_LABELS: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil" };

// Same as renderAdmin.js's lootTable({ showEvent: true }) — this page's items
// span multiple events (unlike HistoryEventPage's single-event list), so an
// Event column is added.
function LootTable({ items }: { items: LootItem[] }) {
    return (
        <table className="idx" style={{ margin: 0 }}>
            <thead><tr><th>Item</th><th>Charakter</th><th>Response</th><th>Boss</th><th>Event</th><th>Zeit</th><th>Quelle</th></tr></thead>
            <tbody>
                {items.map((it, i) => (
                    <tr key={i}>
                        <td>{it.itemLink ? <a className="mlink" href={it.itemLink} target="_blank" rel="noopener noreferrer">{it.itemName || `Item ${it.itemId}`}</a> : (it.itemName || `Item ${it.itemId}`)}</td>
                        <td><CharacterLink character={it.character} /></td>
                        <td className="small">
                            {it.offspec
                                ? <span className="lbadge lbadge-neutral">{it.response || "Off Spec"}</span>
                                : <span className="lbadge lbadge-ok">{it.response || "Main Spec"}</span>}
                        </td>
                        <td className="small">{it.boss || ""}</td>
                        <td className="small">{it.eventLabel || it.eventId || ""}</td>
                        <td className="small">{fmtMs(it.awardedAt)}</td>
                        <td className="small">{LOOT_TOOL_LABELS[it.source] || it.source || "?"}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function GearTab({ data, onReload }: { data: HistoryCharData; onReload: () => void }) {
    const s = data.charSummary;
    const wrongLevel = !!(s && s.level && s.level !== 70);

    let gearInner: ReactNode;
    if (Array.isArray(data.gear) && data.gear.length) {
        gearInner = (
            <div className="dash-card">
                <div className="dash-card-head"><h3>Aktuelles Gear (Paperdoll)</h3><span className="small" style={{ marginLeft: "auto" }}>Battle.net API</span></div>
                <table className="idx" style={{ margin: 0 }}>
                    <thead><tr><th>Slot</th><th>Item</th><th>iLvl</th><th>Verzauberung</th><th>Sockel</th></tr></thead>
                    <tbody>
                        {data.gear.map((g, i) => {
                            const hasGems = g.gems.length > 0;
                            const hasEmpty = g.emptySockets > 0;
                            return (
                                <tr key={i}>
                                    <td className="small">{g.slot || ""}</td>
                                    <td>{g.itemId
                                        ? <a className="mlink" href={`https://www.wowhead.com/tbc/item=${g.itemId}`} target="_blank" rel="noopener noreferrer">{g.name || `Item ${g.itemId}`}</a>
                                        : (g.name || "")}</td>
                                    <td className="small">{g.level || ""}</td>
                                    <td className="small">{g.enchants.length ? g.enchants.join(", ") : <span className="sub">—</span>}</td>
                                    <td className="small">
                                        {hasGems || hasEmpty
                                            ? <>{g.gems.join(", ")}{hasGems && hasEmpty ? " " : ""}{hasEmpty && <span className="lbadge lbadge-warn">{g.emptySockets} leer</span>}</>
                                            : <span className="sub">—</span>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    } else if (data.gearConfigured) {
        gearInner = (
            <>
                <div className="flash flash-err" style={{ margin: "0 0 12px" }}>{data.gearError || "Kein Live-Gear von der Battle.net-API verfügbar."}</div>
                <p className="sub">Nutze solange den Armory-Link oben. „Paperdoll neu laden" fragt erneut ab.</p>
            </>
        );
    } else {
        gearInner = <p className="sub">Für Live-Gear (Paperdoll) Battle.net-Zugang in den <a href="/admin/settings">Einstellungen</a> hinterlegen. Ohne Zugang steht der Armory-Link oben zur Verfügung.</p>;
    }

    const diagParts = [
        s?.level ? <strong key="level">Level {s.level}</strong> : null,
        s?.className || null,
        s?.itemLevel ? `Ø iLvl ${s.itemLevel}` : null,
        s?.realm ? `Realm: ${s.realm}` : null,
        s?.lastLogin ? `zuletzt online ${fmtMs(s.lastLogin, false)}` : null,
    ].filter((p): p is NonNullable<typeof p> => p !== null);

    return (
        <>
            <div className="row-actions" style={{ marginBottom: 12, alignItems: "center" }}>
                {data.gearConfigured
                    ? <a className="btn btn-ghost btn-sm" href="#" onClick={(e) => { e.preventDefault(); onReload(); }}>↻ Paperdoll neu laden</a>
                    : <a className="btn btn-ghost btn-sm" href="/admin/settings">Battle.net einrichten</a>}
                {data.gearConfigured && data.gearNamespace && <span className="lbadge" title="abgefragter Profile-Namespace">{data.gearNamespace}</span>}
            </div>
            {s && (
                <div className="sheetcard" style={{ marginBottom: 12 }}>
                    <div className="small">{diagParts.map((p, i) => <span key={i}>{i > 0 && " · "}{p}</span>)}</div>
                    {wrongLevel && (
                        <div className="flash flash-err" style={{ margin: "10px 0 0" }}>
                            Die Blizzard-API meldet <strong>Level {s!.level}</strong> — wahrscheinlich der falsche Namespace/Char (nicht dein TBC-Char auf Level 70). Passe den Profile-Namespace in den <a href="/admin/settings">Einstellungen</a> an (z.B. profile-classicann-…).
                        </div>
                    )}
                </div>
            )}
            {gearInner}
        </>
    );
}

export default function HistoryCharPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const name = searchParams.get("name") || "";
    const tab: CharTab = searchParams.get("tab") === "loot" ? "loot" : "gear";

    const [data, setData] = useState<HistoryCharData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);

    const load = () => {
        getHistoryChar(name).then(setData).catch((err: ApiError) => setError(err));
    };

    useEffect(load, [name]);

    const switchTab = (t: CharTab) => {
        const next = new URLSearchParams(searchParams);
        if (t === "gear") next.delete("tab"); else next.set("tab", t);
        setSearchParams(next);
    };

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    const info = data.info;

    return (
        <>
            <p className="note"><Link className="mlink" to="/history">← Zurück zur Historie</Link></p>
            <h1 className="page-title">
                {data.character}
                {data.realm && <span className="sub"> · {data.realm}</span>}
                {info?.className && (
                    <span style={{ fontWeight: 700, color: info.classColor || undefined }}>
                        {" "}· <ClassSpecIcon iconUrl={info.iconUrl || ""} />{info.spec ? `${info.spec} ${info.className}` : info.className}
                    </span>
                )}
            </h1>
            <div className="row-actions" style={{ marginBottom: 16 }}>
                {data.armoryUrl && <a className="btn btn-ghost btn-sm" href={data.armoryUrl} target="_blank" rel="noopener noreferrer">Armory ↗</a>}
                {data.wclUrl && <a className="btn btn-ghost btn-sm" href={data.wclUrl} target="_blank" rel="noopener noreferrer">Warcraft Logs ↗</a>}
            </div>

            <div className="tabs" role="tablist">
                <button type="button" className={`tab-btn${tab === "gear" ? " active" : ""}`} role="tab" onClick={() => switchTab("gear")}>
                    Gear (Paperdoll)
                </button>
                <button type="button" className={`tab-btn${tab === "loot" ? " active" : ""}`} role="tab" onClick={() => switchTab("loot")}>
                    Loot-Historie
                    {!!data.items.length && <span className="tab-count">{data.items.length}</span>}
                </button>
            </div>

            {tab === "gear" && <GearTab data={data} onReload={load} />}
            {tab === "loot" && (
                data.items.length
                    ? (
                        <div className="dash-card">
                            <div className="dash-card-head"><h3>Loot-Historie</h3><span className="small" style={{ marginLeft: "auto" }}>{data.items.length} Item(s)</span></div>
                            <LootTable items={data.items} />
                        </div>
                    )
                    : <p className="sub">Kein Loot für diesen Charakter gespeichert.</p>
            )}
        </>
    );
}
