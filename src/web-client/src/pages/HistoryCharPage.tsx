import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getHistoryChar, type ApiError, type GearItem, type HistoryCharData } from "../api";
import { fmtMs } from "../lib/format";
import { refreshWowheadLinks } from "../lib/wowheadTooltips";
import { ClassSpecIcon } from "../components/ClassSpec";
import { LootTable } from "../components/LootTable";

type CharTab = "gear" | "loot";

// Classic character-sheet slot layout: armor down the left, accessories down
// the right, weapons centered underneath (matches the in-game paperdoll).
const GEAR_LEFT = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST"];
const GEAR_RIGHT = ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"];
const GEAR_BOTTOM = ["MAIN_HAND", "OFF_HAND", "RANGED"];
const SLOT_LABELS: Record<string, string> = {
    HEAD: "Kopf", NECK: "Hals", SHOULDER: "Schulter", BACK: "Rücken", CHEST: "Brust", SHIRT: "Hemd", TABARD: "Wappenrock",
    WRIST: "Handgelenk", HANDS: "Hände", WAIST: "Taille", LEGS: "Beine", FEET: "Füße",
    FINGER_1: "Ring 1", FINGER_2: "Ring 2", TRINKET_1: "Schmuck 1", TRINKET_2: "Schmuck 2",
    MAIN_HAND: "Haupthand", OFF_HAND: "Nebenhand", RANGED: "Fernkampf",
};
// Poor/Common map to theme text colors, not the game's raw grey/white — those
// read fine on WoW's always-dark UI but a literal #ffffff is invisible against
// this app's light-theme white panels.
const QUALITY_COLOR: Record<string, string> = {
    POOR: "var(--muted)", COMMON: "var(--text)", UNCOMMON: "#1eff00", RARE: "#0070dd",
    EPIC: "#a335ee", LEGENDARY: "#ff8000", ARTIFACT: "#e6cc80", HEIRLOOM: "#00ccff",
};
const GEM_COLOR: Record<string, string> = {
    RED: "#c0392b", YELLOW: "#e0b73a", BLUE: "#3d7dd6", META: "#d8d8d8",
    PRISMATIC: "linear-gradient(135deg, #e05d5d, #e0c65d, #5d8ee0)",
};
const SOCKET_DE: Record<string, string> = { RED: "Rot", YELLOW: "Gelb", BLUE: "Blau", META: "Meta", PRISMATIC: "Prismatisch" };

// Wowhead item URL carrying the character's actual enchant + gems, so the
// widget tooltip (power.js in index.html) shows them like the in-game tooltip.
function gearWowheadUrl(g: GearItem): string {
    const params: string[] = [];
    if (g.enchantIds.length) params.push(`ench=${g.enchantIds[0]}`);
    const gemIds = g.sockets.map((s) => s.gemId).filter((id): id is number => !!id);
    if (gemIds.length) params.push(`gems=${gemIds.join(":")}`);
    return `https://www.wowhead.com/tbc/item=${g.itemId}${params.length ? `?${params.join("&")}` : ""}`;
}

// One equipment row: icon (quality border, iLvl + enchant badges on its
// corners) followed by the item name in its quality color and a slot/socket
// line — the name and slot are readable at a glance instead of only via the
// Wowhead hover tooltip. A missing item renders as a dimmed placeholder row
// so the two columns keep their shape.
function GearRow({ g, slot }: { g?: GearItem; slot: string }) {
    const label = SLOT_LABELS[slot] || slot;
    if (!g) {
        return (
            <div className="gear-row empty">
                <span className="icon-wrap"><span className="ph" /></span>
                <span className="body">
                    <span className="item-name">— leer —</span>
                    <span className="slot-line"><span className="slot-label">{label}</span></span>
                </span>
            </div>
        );
    }
    const color = QUALITY_COLOR[g.quality] || "var(--line)";
    const inner = (
        <>
            <span className="icon-wrap">
                {g.iconUrl ? <img src={g.iconUrl} alt="" loading="lazy" style={{ borderColor: color }} /> : <span className="ph" />}
                {!!g.enchants.length && <span className="ench-badge" title={`Verzauberung: ${g.enchants.join(" · ")}`}>+</span>}
                {!!g.level && <span className="ilvl-badge">{g.level}</span>}
            </span>
            <span className="body">
                <span className="item-name" style={{ color }}>{g.name || label}</span>
                <span className="slot-line">
                    <span className="slot-label">{label}</span>
                    {g.sockets.map((s, i) => {
                        const filled = !!(s.gemName || s.gemText);
                        const tip = filled ? (s.gemName || s.gemText) : `Leerer Sockel (${SOCKET_DE[s.type] || s.type || "?"})`;
                        return (
                            <span
                                key={i}
                                className="gem-dot"
                                title={tip}
                                style={{ background: filled ? (GEM_COLOR[s.type] || "#888") : "transparent", borderColor: GEM_COLOR[s.type] || "var(--muted)" }}
                            />
                        );
                    })}
                </span>
            </span>
        </>
    );
    return g.itemId
        ? <a className="gear-row" href={gearWowheadUrl(g)} target="_blank" rel="noopener noreferrer" title={g.name || label}>{inner}</a>
        : <div className="gear-row" title={g.name || label}>{inner}</div>;
}

// The gear card: a compact summary strip (portrait, Ø iLvl, socket count)
// above two columns of slot rows, weapons underneath — replaces the old
// icon-only paperdoll grid, which spent most of its width on empty silhouette
// space and needed a hover per item just to read its name.
function GearPaperdoll({ gear, classIconUrl, itemLevel }: { gear: GearItem[]; classIconUrl: string; itemLevel: number }) {
    const bySlot = new Map(gear.map((g) => [g.slot, g]));
    const known = new Set([...GEAR_LEFT, ...GEAR_RIGHT, ...GEAR_BOTTOM]);
    const extras = gear.filter((g) => !known.has(g.slot));
    const ilvls = gear.map((g) => g.level || 0).filter((n) => n > 0);
    const avg = itemLevel || (ilvls.length ? Math.round(ilvls.reduce((a, b) => a + b, 0) / ilvls.length) : 0);
    const socketCount = gear.reduce((n, g) => n + g.sockets.length, 0);
    return (
        <div className="gear-card-new">
            <div className="gear-summary">
                {!!classIconUrl && <img className="gear-portrait" src={classIconUrl} alt="" />}
                <div className="gear-stats">
                    {!!avg && <div className="stat"><b>{avg}</b><span>Ø iLvl</span></div>}
                    {!!socketCount && <div className="stat"><b>{socketCount}</b><span>Sockel</span></div>}
                </div>
            </div>
            <div className="gear-grid">
                <div>{GEAR_LEFT.map((slot) => <GearRow key={slot} g={bySlot.get(slot)} slot={slot} />)}</div>
                <div>{GEAR_RIGHT.map((slot) => <GearRow key={slot} g={bySlot.get(slot)} slot={slot} />)}</div>
            </div>
            <div className="gear-weapons">
                {GEAR_BOTTOM.map((slot) => <GearRow key={slot} g={bySlot.get(slot)} slot={slot} />)}
                {extras.map((g, i) => <GearRow key={`x${i}`} g={g} slot={g.slot} />)}
            </div>
        </div>
    );
}

function GearTab({ data, onReload }: { data: HistoryCharData; onReload: () => void }) {
    const s = data.charSummary;
    const wrongLevel = !!(s && s.level && s.level !== 70);

    let gearInner: ReactNode;
    if (Array.isArray(data.gear) && data.gear.length) {
        gearInner = (
            <div className="dash-card gear-card">
                <div className="dash-card-head"><h3>Aktuelles Gear</h3><span className="small" style={{ marginLeft: "auto" }}>Battle.net API</span></div>
                <GearPaperdoll
                    gear={data.gear}
                    classIconUrl={data.info?.iconUrl || ""}
                    itemLevel={s?.itemLevel || 0}
                />
            </div>
        );
    } else if (data.gearConfigured) {
        gearInner = (
            <>
                <div className="flash flash-err" style={{ margin: "0 0 12px" }}>{data.gearError || "Kein Live-Gear von der Battle.net-API verfügbar."}</div>
                <p className="sub">Nutze solange den Armory-Link oben. „Neu laden" fragt erneut ab.</p>
            </>
        );
    } else {
        gearInner = <p className="sub">Für Live-Gear Battle.net-Zugang in den <Link to="/settings">Einstellungen</Link> hinterlegen. Ohne Zugang steht der Armory-Link oben zur Verfügung.</p>;
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
                    ? <a className="btn btn-ghost btn-sm" href="#" onClick={(e) => { e.preventDefault(); onReload(); }}>↻ Neu laden</a>
                    : <Link className="btn btn-ghost btn-sm" to="/settings">Battle.net einrichten</Link>}
                {data.gearConfigured && data.gearNamespace && <span className="lbadge" title="abgefragter Profile-Namespace">{data.gearNamespace}</span>}
            </div>
            {s && (
                <div className="sheetcard" style={{ marginBottom: 12 }}>
                    <div className="small">{diagParts.map((p, i) => <span key={i}>{i > 0 && " · "}{p}</span>)}</div>
                    {wrongLevel && (
                        <div className="flash flash-err" style={{ margin: "10px 0 0" }}>
                            Die Blizzard-API meldet <strong>Level {s!.level}</strong> — wahrscheinlich der falsche Namespace/Char (nicht dein TBC-Char auf Level 70). Passe den Profile-Namespace in den <Link to="/settings">Einstellungen</Link> an (z.B. profile-classicann-…).
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

    // Attach Wowhead tooltips to the freshly rendered item links (gear tiles +
    // loot table) — the widget's own scan ran before React rendered them.
    useEffect(() => { refreshWowheadLinks(); }, [data, tab]);

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
                    Gear
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
