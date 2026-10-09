import { useState, type ReactNode } from "react";
import type { SystemStatus } from "../../api";
import { useT } from "../../i18n";
import Segment from "../../components/ui/Segment";
import Expand from "../../components/ui/Expand";
import {
    TILE_LIMITS, bytes, millis, num, pct, seriesOf, sparkPath, toneHigh, toneLow, uptime, within,
    type FigureTone, type Point, type Range,
} from "../../lib/system/systemFormat";

// The five tiles: one large figure, a small label, a sparkline of the last
// hour or 24 hours. What sits behind a figure is its tooltip; the rest of the
// host's details (cores, load, swap, heap, Node, uptimes) is one fold below.

/** A small inline line chart; decorative (the figure next to it says the value). */
export function Sparkline({ points, max, floor }: { points: Point[]; max?: number; floor?: number }) {
    const { line, area } = sparkPath(points, { width: 100, height: 28, max, floor });
    if (!line) return <span className="sy-spark sy-spark-empty" aria-hidden="true" />;
    return (
        <svg className="sy-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path className="sy-spark-area" d={area} />
            <path className="sy-spark-line" d={line} />
        </svg>
    );
}

function Tile({ label, value, sub, tone, tip, tipSub, children }: {
    label: string; value: string; sub: string; tone: FigureTone; tip: string; tipSub?: string; children: ReactNode;
}) {
    return (
        <div className={`sy-tile${tone ? ` sy-tone-${tone}` : ""}`} data-tip={tip} data-tip-sub={tipSub} tabIndex={0}>
            <div className="sy-label">{label}</div>
            <div className="sy-value">{value}</div>
            <div className="sy-sub">{sub}</div>
            {children}
        </div>
    );
}

export function Tiles({ status, range, onRange }: { status: SystemStatus; range: Range; onRange: (r: Range) => void }) {
    const t = useT();
    const c = status.current;
    const h = status.history;
    const disk = status.disk;
    const diskPct = disk && disk.known && disk.total ? (disk.free / disk.total) * 100 : null;
    const diskPoints = within((disk?.history || []).map((p) => [p[0], p[1]] as Point), range, status.now);
    const loadText = status.info.loadSupported && c ? t("system.tiles.load", { load: num(c.load1, 2) }) : t("system.tiles.noLoad");
    return (
        <section className="sy-tiles-wrap" aria-label={t("system.tiles.aria")}>
            <div className="sy-tiles-head">
                <Segment
                    ariaLabel={t("system.tiles.range")}
                    size="sm"
                    value={range}
                    onChange={onRange}
                    options={[{ value: "hour", label: t("system.tiles.hour") }, { value: "day", label: t("system.tiles.day") }]}
                />
            </div>
            {!c && <p className="hint">{t("system.tiles.noSample")}</p>}
            <div className="sy-tiles">
                <Tile
                    label={t("system.tiles.hostCpu")}
                    value={c ? pct(c.hostCpu) : "–"}
                    sub={`${t("system.tiles.cores", { count: status.info.cores })} · ${loadText}`}
                    tone={c ? toneHigh(c.hostCpu, TILE_LIMITS.hostCpu) : ""}
                    tip={t("system.tiles.hostCpuTip")}
                    tipSub={t("system.tiles.hostCpuSub")}
                >
                    <Sparkline points={seriesOf(h, range, "hostCpu")} max={100} />
                </Tile>
                <Tile
                    label={t("system.tiles.procCpu")}
                    value={c ? pct(c.procCpu) : "–"}
                    sub={c ? t("system.tiles.elu", { elu: pct(c.elu) }) : ""}
                    tone={c ? toneHigh(c.procCpu, TILE_LIMITS.procCpu) : ""}
                    tip={t("system.tiles.procCpuTip")}
                    tipSub={t("system.tiles.procCpuSub")}
                >
                    <Sparkline points={seriesOf(h, range, "procCpu")} max={100} />
                </Tile>
                <Tile
                    label={t("system.tiles.mem")}
                    value={c ? bytes(c.memAvail) : "–"}
                    sub={c ? t("system.tiles.memSub", { pct: pct(c.memAvailPct), total: bytes(c.memTotal) }) : ""}
                    tone={c ? toneLow(c.memAvailPct, TILE_LIMITS.memAvailPct) : ""}
                    tip={t("system.tiles.memTip")}
                    tipSub={c && c.swapKnown ? t("system.tiles.swap", { used: bytes(c.swapUsed), total: bytes(c.swapTotal) }) : t("system.tiles.memSubNoSwap")}
                >
                    <Sparkline points={seriesOf(h, range, "memAvailPct")} max={100} />
                </Tile>
                <Tile
                    label={t("system.tiles.loop")}
                    value={c ? millis(c.loopP99) : "–"}
                    sub={c ? t("system.tiles.loopSub", { max: millis(c.loopMax) }) : ""}
                    tone={c ? toneHigh(c.loopP99, TILE_LIMITS.loopP99) : ""}
                    tip={t("system.tiles.loopTip")}
                    tipSub={t("system.tiles.loopSub2")}
                >
                    <Sparkline points={seriesOf(h, range, "loopP99")} floor={50} />
                </Tile>
                <Tile
                    label={t("system.tiles.disk")}
                    value={diskPct === null ? "–" : pct(diskPct)}
                    sub={disk && disk.known ? t("system.tiles.diskSub", { free: bytes(disk.free), total: bytes(disk.total) }) : t("system.tiles.diskUnknown")}
                    tone={diskPct === null ? "" : toneLow(diskPct, TILE_LIMITS.diskFreePct)}
                    tip={t("system.tiles.diskTip")}
                    tipSub={t("system.tiles.diskSub2")}
                >
                    <Sparkline points={diskPoints} max={100} />
                </Tile>
            </div>
        </section>
    );
}

/** The fold with everything else about host and process. */
export function HostDetails({ status }: { status: SystemStatus }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const c = status.current;
    const i = status.info;
    const rows: [string, string][] = [
        [t("system.details.cpu"), `${i.cpuModel || "–"} · ${t("system.tiles.cores", { count: i.cores })}`],
        [t("system.details.load"), i.loadSupported && c ? `${num(c.load1, 2)} · ${num(c.load5, 2)} · ${num(c.load15, 2)}` : t("system.details.na")],
        [t("system.details.swap"), c && c.swapKnown ? t("system.tiles.swap", { used: bytes(c.swapUsed), total: bytes(c.swapTotal) }) : t("system.details.na")],
        [t("system.details.rss"), c ? bytes(c.rss) : "–"],
        [t("system.details.heap"), c ? t("system.details.heapValue", { used: bytes(c.heapUsed), total: bytes(c.heapTotal), external: bytes(c.external) }) : "–"],
        [t("system.details.loop"), c ? t("system.details.loopValue", { p50: millis(c.loopP50), p99: millis(c.loopP99), max: millis(c.loopMax) }) : "–"],
        [t("system.details.node"), `${i.nodeVersion} · ${i.platform}`],
        [t("system.details.runtime"), i.runtime.kind === "pm2" ? t("system.details.pm2", { id: i.runtime.pmId || "?" }) : i.runtime.kind === "docker" ? t("system.meta.docker") : t("system.details.plain")],
        [t("system.details.processUptime"), uptime(i.processUptime)],
        [t("system.details.hostUptime"), uptime(i.hostUptime)],
    ];
    return (
        <div className="sy-details">
            <Expand open={open} onToggle={() => setOpen(!open)} label={t("system.details.toggle")} />
            {open && (
                <dl className="sy-dl">
                    {rows.map(([k, v]) => (
                        <div key={k} className="sy-dl-row">
                            <dt className="sy-label">{k}</dt>
                            <dd>{v}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    );
}
