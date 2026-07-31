import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { getHistoryChar, type ApiError, type CharGearReport, type GearItem, type HistoryCharData } from "../api";
import { fmtMs } from "../lib/format";
import { itemQualityColor, itemQualityProps } from "../lib/itemQuality";
import { usePersistedSearchParam } from "../lib/persistedState";
import { refreshWowheadLinks } from "../lib/wowheadTooltips";
import { CLASS_SOURCE_LABELS } from "../components/ClassSpec";
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
const GEM_COLOR: Record<string, string> = {
    RED: "#c0392b", YELLOW: "#e0b73a", BLUE: "#3d7dd6", META: "#d8d8d8",
    PRISMATIC: "linear-gradient(135deg, #e05d5d, #e0c65d, #5d8ee0)",
};
const SOCKET_DE: Record<string, string> = { RED: "Rot", YELLOW: "Gelb", BLUE: "Blau", META: "Meta", PRISMATIC: "Prismatisch" };
// The game's own empty-socket art (same files Wowhead's tooltips use), so an
// unfilled socket looks like it does in the item tooltip instead of a coloured
// square. Unknown/blank types fall back to the prismatic frame.
const SOCKET_ICON: Record<string, string> = {
    RED: "socket-red", YELLOW: "socket-yellow", BLUE: "socket-blue", META: "socket-meta", PRISMATIC: "socket-prismatic",
};
function socketIconUrl(type: string): string {
    return `https://wow.zamimg.com/images/icons/${SOCKET_ICON[type] || SOCKET_ICON.PRISMATIC}.gif`;
}

// Slots that can carry a permanent enchant in TBC — same set as the CLA's
// gear audit (config/claData.js ENCHANTABLE_SLOTS), translated from WCL slot
// indices to the Blizzard slot keys this page works with. Rings/neck/trinkets
// are left out on purpose: they are enchanter-only or not enchantable at all,
// so a red cross there would be a false alarm.
const ENCHANTABLE_SLOTS = new Set(["HEAD", "SHOULDER", "CHEST", "LEGS", "FEET", "WRIST", "HANDS", "BACK", "MAIN_HAND", "OFF_HAND"]);

// An off-hand *held* item (tome, orb, idol) sits in OFF_HAND but takes no
// enchant — only shields and off-hand weapons do. Same heuristic the CLA uses
// (gearIssues.js's isShieldMisc): those items' icons are the "_misc_" ones.
function isEnchantable(g: GearItem, slot: string): boolean {
    if (!ENCHANTABLE_SLOTS.has(slot)) return false;
    if (slot === "OFF_HAND" && g.iconUrl.indexOf("_misc_") > -1) return false;
    return true;
}

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
    const color = itemQualityColor(g.quality) || "var(--line)";
    const inner = (
        <>
            <span className="icon-wrap">
                {g.iconUrl ? <img src={g.iconUrl} alt="" loading="lazy" style={{ borderColor: color }} /> : <span className="ph" />}
                {g.enchants.length
                    ? <span className="ench-badge ok" title={`Verzauberung: ${g.enchants.join(" · ")}`} aria-label="verzaubert">✓</span>
                    : isEnchantable(g, slot) && <span className="ench-badge bad" title="Keine Verzauberung" aria-label="nicht verzaubert">✕</span>}
                {!!g.level && <span className="ilvl-badge">{g.level}</span>}
            </span>
            <span className="body">
                <span {...itemQualityProps(g.quality, "item-name")}>{g.name || label}</span>
                <span className="slot-line">
                    <span className="slot-label">{label}</span>
                    {g.sockets.map((s, i) => {
                        const filled = !!(s.gemName || s.gemText);
                        const tip = filled ? (s.gemName || s.gemText) : `Leerer Sockel (${SOCKET_DE[s.type] || s.type || "?"})`;
                        // Socketed: the gem's own item icon. Empty: the game's
                        // empty-socket frame in the socket's colour. A gem we
                        // could not resolve an icon for keeps the coloured dot,
                        // so it still reads as "filled" rather than as a hole.
                        if (filled && !s.gemIconUrl) {
                            return (
                                <span
                                    key={i}
                                    className="gem-dot"
                                    title={tip}
                                    style={{ background: GEM_COLOR[s.type] || "#888", borderColor: GEM_COLOR[s.type] || "var(--muted)" }}
                                />
                            );
                        }
                        return (
                            <img
                                key={i}
                                className={`gem-ico${filled ? " filled" : ""}`}
                                src={filled ? s.gemIconUrl : socketIconUrl(s.type)}
                                alt=""
                                loading="lazy"
                                title={tip}
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

// The gear card: two columns of slot rows with the weapons underneath —
// replaces the old icon-only paperdoll grid, which spent most of its width on
// empty silhouette space and needed a hover per item just to read its name.
// The portrait and the Ø iLvl / socket figures that used to sit on top live in
// the page hero now, so they are not repeated here.
function GearPaperdoll({ gear }: { gear: GearItem[] }) {
    const bySlot = new Map(gear.map((g) => [g.slot, g]));
    const known = new Set([...GEAR_LEFT, ...GEAR_RIGHT, ...GEAR_BOTTOM]);
    const extras = gear.filter((g) => !known.has(g.slot));
    return (
        <div className="gear-card-new">
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

// The gear findings of the character's newest CLA evaluation — the detail
// behind the roster overview's issue count. Sits above the live Battle.net
// paperdoll on purpose: the paperdoll says what is equipped now, this says what
// was wrong with it the last time the raid was logged.
//
// One card per finding (not a wrapped badge row): the item keeps its own line,
// slot and verdict read underneath, and the severity is a coloured rule down
// the left, so "kein Item" is separable from a gem nit at a glance.
function GearIssuesCard({ gear }: { gear: CharGearReport }) {
    const when = gear.generatedAt ? fmtMs(gear.generatedAt, false) : "";
    const high = gear.issues.filter((i) => i.severity === "high").length;
    return (
        <div className="dash-card" style={{ marginBottom: 16 }}>
            <div className="dash-card-head">
                <h3>Gear-Issues</h3>
                {!!gear.issueCount && (
                    <>
                        <span className="lbadge lbadge-warn">{high} kritisch</span>
                        <span className="lbadge lbadge-medium">{gear.issueCount - high} weitere</span>
                    </>
                )}
                <span className="small" style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="sub">{[gear.reportTitle, gear.zone, when].filter(Boolean).join(" · ")}</span>
                    {!!gear.reportRefId && <a className="mlink" href={`/r/${gear.reportRefId}`} target="_blank" rel="noopener noreferrer">Auswertung ↗</a>}
                    {!!gear.reportUrl && <a className="mlink" href={gear.reportUrl} target="_blank" rel="noopener noreferrer">Log ↗</a>}
                </span>
            </div>
            {gear.issueCount
                ? (
                    <div className="gi-list">
                        {gear.issues.map((issue, i) => (
                            <div className={`gi-row${issue.severity === "high" ? " is-high" : ""}`} key={`${issue.itemId}-${issue.kind}-${i}`}>
                                {issue.iconUrl
                                    ? <img className="gi-ico" src={issue.iconUrl} alt="" loading="lazy" />
                                    : <span className="gi-ico gi-ico-ph" />}
                                <div className="gi-body">
                                    <span className="gi-item" title={issue.itemName}>{issue.itemName || "—"}</span>
                                    <span className="gi-meta">
                                        <span className="gi-label">{issue.label}</span>
                                        {!!issue.slotName && <span className="gi-slot">{issue.slotName}</span>}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )
                : <p className="sub" style={{ padding: "2px 16px 14px" }}>Keine Gear-Probleme in der letzten Auswertung.</p>}
        </div>
    );
}

// Ø item level: what the Battle.net summary reports, else the average over the
// equipped items we actually got back.
function averageItemLevel(data: HistoryCharData): number {
    if (data.charSummary?.itemLevel) return data.charSummary.itemLevel;
    const levels = (data.gear || []).map((g) => g.level || 0).filter((n) => n > 0);
    if (!levels.length) return 0;
    return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
}

function HeroStat({ label, value, tone, title }: {
    label: string;
    value: number | string;
    tone?: "total" | "warn" | "ok";
    title?: string;
}) {
    return (
        <div className={`hero-stat${tone ? ` is-${tone}` : ""}`} title={title}>
            <span className="hero-stat-label">{label}</span>
            <span className="hero-stat-value">{value}</span>
        </div>
    );
}

// The character's identity band above the tabs — same three-band hero the raid
// detail page uses, with a class portrait instead of the calendar badge. It
// absorbs what used to be scattered around the Gear tab (the reload button, the
// namespace badge, the "Level 70 · Warrior · Ø iLvl …" diagnostics line), so
// the page opens with one block that answers "wer ist das und wie steht er da".
function CharHero({ data, onReload }: { data: HistoryCharData; onReload: () => void }) {
    const info = data.info;
    const summary = data.charSummary;
    const gear = data.gearIssues;
    const classColor = info?.classColor || "";
    const avgIlvl = averageItemLevel(data);
    const sockets = (data.gear || []).reduce((n, g) => n + g.sockets.length, 0);
    const realm = data.realm || summary?.realm || "";

    return (
        <header className="page-hero char-hero" style={{ "--class-color": classColor || undefined } as CSSProperties}>
            <div className="hero-main">
                <div className="hero-portrait">
                    <span className="hero-portrait-ring" />
                    {info?.iconUrl
                        ? <img src={info.iconUrl} alt="" />
                        : <span className="hero-portrait-ph">{(data.character || "?").slice(0, 1).toUpperCase()}</span>}
                    {!!summary?.level && <span className="hero-portrait-level" title="Level laut Battle.net-API">{summary.level}</span>}
                </div>
                <div className="hero-ident">
                    <div className="hero-eyebrow">
                        <span className="hero-kicker">Charakter</span>
                        {!!info?.source && (
                            <span className="lbadge" title="Woher Klasse und Spec bekannt sind">
                                {CLASS_SOURCE_LABELS[info.source] || info.source}
                            </span>
                        )}
                    </div>
                    {/* The name stays in the text colour — a class colour at
                        title size is unreadable on the light theme's white
                        panels (Priest is literally #ffffff). The class colour
                        carries on the line below, the ring and the top rule. */}
                    <h1 className="hero-title">{data.character}</h1>
                    <div className="hero-sub">
                        {info?.className
                            ? (
                                <span className="hero-class">
                                    {!!info.iconUrl && <img src={info.iconUrl} alt="" />}
                                    {info.spec ? `${info.spec} ${info.className}` : info.className}
                                </span>
                            )
                            : <span className="sub">Klasse noch nicht aufgelöst</span>}
                        {!!realm && <><span className="hero-dot">·</span><span>{realm}</span></>}
                    </div>
                </div>
                <div className="hero-actions">
                    <div className="hero-actions-row">
                        {!!data.wclUrl && <a className="btn btn-ghost btn-sm" href={data.wclUrl} target="_blank" rel="noopener noreferrer">Warcraft Logs ↗</a>}
                        {!!data.armoryUrl && <a className="btn btn-ghost btn-sm" href={data.armoryUrl} target="_blank" rel="noopener noreferrer">Armory ↗</a>}
                        {data.gearConfigured
                            ? <button className="btn btn-ghost btn-sm" type="button" onClick={onReload}>↻ Gear neu laden</button>
                            : <Link className="btn btn-ghost btn-sm" to="/settings">Battle.net einrichten</Link>}
                    </div>
                </div>
            </div>

            <dl className="hero-meta">
                {!!summary?.faction && (
                    <div className="hero-meta-item"><dt>Fraktion</dt><dd>{summary.faction}</dd></div>
                )}
                <div className="hero-meta-item">
                    <dt>Zuletzt online</dt>
                    <dd>{summary?.lastLogin ? fmtMs(summary.lastLogin, false) : <span className="sub">unbekannt</span>}</dd>
                </div>
                <div className="hero-meta-item">
                    <dt>Letzte Auswertung</dt>
                    <dd>{gear?.generatedAt
                        ? (gear.reportRefId
                            ? <a className="mlink" href={`/r/${gear.reportRefId}`} target="_blank" rel="noopener noreferrer">{fmtMs(gear.generatedAt, false)}</a>
                            : fmtMs(gear.generatedAt, false))
                        : <span className="sub">keine</span>}</dd>
                </div>
                {data.gearConfigured && !!data.gearNamespace && (
                    <div className="hero-meta-item">
                        <dt>Profile-Namespace</dt>
                        <dd><span className="lbadge" title="abgefragter Battle.net Profile-Namespace">{data.gearNamespace}</span></dd>
                    </div>
                )}
            </dl>

            <div className="hero-foot">
                <div className="hero-stats">
                    <HeroStat label="Ø iLvl" value={avgIlvl || "—"} tone="total" title="Durchschnittliches Item-Level des aktuellen Gears" />
                    {!!sockets && <HeroStat label="Sockel" value={sockets} title="Sockel im aktuellen Gear" />}
                    <HeroStat label="Loot" value={data.items.length} title="Importierte Items dieses Charakters" />
                    {gear
                        ? (
                            <HeroStat
                                label="Gear-Issues" value={gear.issueCount}
                                tone={gear.issueCount ? "warn" : "ok"}
                                title={gear.issueCount ? `${gear.issueCount} Befund(e) in der letzten Auswertung` : "Letzte Auswertung ohne Befund"}
                            />
                        )
                        : <HeroStat label="Gear-Issues" value="—" title="In keiner der letzten Auswertungen enthalten" />}
                </div>
            </div>
        </header>
    );
}

function GearTab({ data }: { data: HistoryCharData }) {
    const s = data.charSummary;
    // A level that isn't 70 means the profile lookup hit a different era's
    // character — the gear shown would then be the wrong one entirely.
    const wrongLevel = !!(s && s.level && s.level !== 70);

    let gearInner: ReactNode;
    if (Array.isArray(data.gear) && data.gear.length) {
        gearInner = (
            <div className="dash-card gear-card">
                <div className="dash-card-head"><h3>Aktuelles Gear</h3><span className="small" style={{ marginLeft: "auto" }}>Battle.net API</span></div>
                <GearPaperdoll gear={data.gear} />
            </div>
        );
    } else if (data.gearConfigured) {
        gearInner = (
            <>
                <div className="flash flash-err" style={{ margin: "0 0 12px" }}>{data.gearError || "Kein Live-Gear von der Battle.net-API verfügbar."}</div>
                <p className="sub">Nutze solange den Armory-Link oben. „Gear neu laden" fragt erneut ab.</p>
            </>
        );
    } else {
        gearInner = (
            <div className="sheetcard">
                <p className="sub" style={{ margin: 0 }}>
                    Für Live-Gear Battle.net-Zugang in den <Link to="/settings">Einstellungen</Link> hinterlegen.
                    Ohne Zugang steht der Armory-Link oben zur Verfügung.
                </p>
            </div>
        );
    }

    return (
        <>
            {wrongLevel && (
                <div className="flash flash-err" style={{ margin: "0 0 16px" }}>
                    Die Blizzard-API meldet <strong>Level {s!.level}</strong> — wahrscheinlich der falsche Namespace/Char (nicht dein TBC-Char auf Level 70). Passe den Profile-Namespace in den <Link to="/settings">Einstellungen</Link> an (z.B. profile-classicann-…).
                </div>
            )}
            {data.gearIssues && <GearIssuesCard gear={data.gearIssues} />}
            {gearInner}
        </>
    );
}

export default function HistoryCharPage() {
    const [searchParams] = useSearchParams();
    const location = useLocation();
    const name = searchParams.get("name") || "";
    // The same page is mounted under /history/char and /roster/char — the back
    // link has to lead where the visitor came from, not always to the history.
    const from = location.pathname.startsWith("/roster")
        ? { href: "/roster", label: "← Zurück zum Roster" }
        : { href: "/history?tab=chars", label: "← Zurück zur Historie" };
    // Remembered across characters: whoever is comparing loot histories keeps
    // that tab when opening the next raider (?name= is kept by the hook).
    const [tab, switchTab] = usePersistedSearchParam<CharTab>("history-char-tab", "tab", "gear", ["gear", "loot"]);

    const [data, setData] = useState<HistoryCharData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);

    const load = () => {
        getHistoryChar(name).then(setData).catch((err: ApiError) => setError(err));
    };

    useEffect(load, [name]);

    // Attach Wowhead tooltips to the freshly rendered item links (gear tiles +
    // loot table) — the widget's own scan ran before React rendered them.
    useEffect(() => { refreshWowheadLinks(); }, [data, tab]);

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <div className="empty">Lade…</div>;

    return (
        <>
            <p className="note"><Link className="mlink" to={from.href}>{from.label}</Link></p>

            <CharHero data={data} onReload={load} />

            <div className="tabs" role="tablist">
                <button type="button" className={`tab-btn${tab === "gear" ? " active" : ""}`} role="tab" onClick={() => switchTab("gear")}>
                    Gear
                </button>
                <button type="button" className={`tab-btn${tab === "loot" ? " active" : ""}`} role="tab" onClick={() => switchTab("loot")}>
                    Loot-Historie
                    {!!data.items.length && <span className="tab-count">{data.items.length}</span>}
                </button>
            </div>

            {tab === "gear" && <GearTab data={data} />}
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
