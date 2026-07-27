import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getHistoryChar, type ApiError, type GearItem, type HistoryCharData } from "../api";
import { fmtMs } from "../lib/format";
import { ClassSpecIcon } from "../components/ClassSpec";
import { LootTable } from "../components/LootTable";

type CharTab = "gear" | "loot";

// Blizzard's equipment-slot enum, in the order a character sheet lists them.
const SLOT_ORDER = [
    "HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST",
    "HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2",
    "MAIN_HAND", "OFF_HAND", "RANGED",
];
const SLOT_LABELS: Record<string, string> = {
    HEAD: "Kopf", NECK: "Hals", SHOULDER: "Schulter", BACK: "Rücken", CHEST: "Brust", SHIRT: "Hemd", TABARD: "Wappenrock",
    WRIST: "Handgelenk", HANDS: "Hände", WAIST: "Taille", LEGS: "Beine", FEET: "Füße",
    FINGER_1: "Ring 1", FINGER_2: "Ring 2", TRINKET_1: "Schmuck 1", TRINKET_2: "Schmuck 2",
    MAIN_HAND: "Haupthand", OFF_HAND: "Nebenhand", RANGED: "Fernkampf",
};
const QUALITY_COLOR: Record<string, string> = {
    POOR: "#9d9d9d", COMMON: "#ffffff", UNCOMMON: "#1eff00", RARE: "#0070dd",
    EPIC: "#a335ee", LEGENDARY: "#ff8000", ARTIFACT: "#e6cc80", HEIRLOOM: "#00ccff",
};
const GEM_COLOR: Record<string, string> = {
    RED: "#c0392b", YELLOW: "#e0b73a", BLUE: "#3d7dd6", META: "#d8d8d8",
    PRISMATIC: "linear-gradient(135deg, #e05d5d, #e0c65d, #5d8ee0)",
};

function GearTile({ g }: { g: GearItem }) {
    const color = QUALITY_COLOR[g.quality] || "var(--line)";
    const label = SLOT_LABELS[g.slot] || g.slot || "";
    return (
        <div className="gear-tile">
            <div className="gear-icon" style={{ borderColor: color }}>
                {g.iconUrl
                    ? <img src={g.iconUrl} alt="" loading="lazy" />
                    : <div className="gear-icon-ph" />}
                {!!g.level && <span className="gear-ilvl">{g.level}</span>}
                {!!g.sockets.length && (
                    <span className="gear-gems">
                        {g.sockets.map((s, i) => (
                            <span
                                key={i}
                                className="gear-gem"
                                style={{
                                    background: s.gemName ? (GEM_COLOR[s.type] || "#888") : "transparent",
                                    borderColor: GEM_COLOR[s.type] || "var(--muted)",
                                }}
                            />
                        ))}
                    </span>
                )}
            </div>
            <div className="gear-slotlabel">{label}</div>
            <div className="gear-tip">
                {g.itemId
                    ? <a className="gear-tip-name" style={{ color }} href={`https://www.wowhead.com/tbc/item=${g.itemId}`} target="_blank" rel="noopener noreferrer">{g.name || `Item ${g.itemId}`}</a>
                    : <span className="gear-tip-name" style={{ color }}>{g.name || label}</span>}
                <div className="gear-tip-meta">{label}{g.level ? ` · iLvl ${g.level}` : ""}</div>
                {g.enchants.map((e, i) => <div key={i} className="gear-tip-ench">{e}</div>)}
                {g.sockets.map((s, i) => (
                    <div key={i} className={`gear-tip-socket${s.gemName ? "" : " empty"}`}>
                        <span
                            className="gear-gem-dot"
                            style={{
                                background: s.gemName ? (GEM_COLOR[s.type] || "#888") : "transparent",
                                borderColor: GEM_COLOR[s.type] || "var(--muted)",
                            }}
                        />
                        {s.gemName || `leerer Sockel (${s.type || "?"})`}
                    </div>
                ))}
            </div>
        </div>
    );
}

function GearTab({ data, onReload }: { data: HistoryCharData; onReload: () => void }) {
    const s = data.charSummary;
    const wrongLevel = !!(s && s.level && s.level !== 70);

    let gearInner: ReactNode;
    if (Array.isArray(data.gear) && data.gear.length) {
        const bySlot = new Map(data.gear.map((g) => [g.slot, g]));
        const ordered = SLOT_ORDER.map((slot) => bySlot.get(slot)).filter((g): g is GearItem => !!g);
        const extra = data.gear.filter((g) => !SLOT_ORDER.includes(g.slot));
        gearInner = (
            <div className="dash-card gear-card">
                <div className="dash-card-head"><h3>Aktuelles Gear (Paperdoll)</h3><span className="small" style={{ marginLeft: "auto" }}>Battle.net API</span></div>
                <div className="gear-grid">
                    {ordered.map((g, i) => <GearTile key={i} g={g} />)}
                    {extra.map((g, i) => <GearTile key={`x${i}`} g={g} />)}
                </div>
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
                            <LootTable items={data.items} showEvent />
                        </div>
                    )
                    : <p className="sub">Kein Loot für diesen Charakter gespeichert.</p>
            )}
        </>
    );
}
