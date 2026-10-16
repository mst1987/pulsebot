import { useState } from "react";
import type { SystemStatus } from "../../api";
import { useT } from "../../i18n";
import { PartHead } from "../../components/ui/PartHead";
import Badge from "../../components/ui/Badge";
import Bar from "../../components/ui/Bar";
import Expand from "../../components/ui/Expand";
import { formatTime } from "../../lib/format";
import { bytes, pct } from "../../lib/system/systemFormat";

// "Prozesse auf dem Server" and "Speicherplatz": what else runs on the host
// (only where the server could measure it - Linux), and what takes the space
// under data/.

type Processes = NonNullable<SystemStatus["processes"]>;
type Disk = NonNullable<SystemStatus["disk"]>;

export function ProcessesSection({ processes }: { processes: Processes }) {
    const t = useT();
    const top = Math.max(100, ...processes.list.map((p) => p.cpu));
    return (
        <section className="sy-section">
            <PartHead
                icon="inv_gizmo_02"
                tone="system"
                title={t("system.procs.title")}
                crumb={t("system.procs.at", { time: formatTime(processes.at) })}
                tip={t("system.procs.title")}
                tipSub={processes.source === "ps" ? t("system.procs.tipPs") : t("system.procs.tip")}
            />
            <ul className="sy-rows">
                {processes.list.map((p) => (
                    <li key={p.pid} className={p.self ? "sy-self" : undefined}>
                        <span className="sy-row-name">
                            <code>{p.name}</code>
                            {p.self && <Badge size="sm" tone="accent">{t("system.procs.self")}</Badge>}
                            <span className="sy-label">{t("system.procs.pid", { pid: p.pid })}</span>
                        </span>
                        <Bar value={p.cpu} max={top} label={t("system.procs.cpu", { cpu: pct(p.cpu) })} tip={t("system.procs.cpuTip")} />
                        <span className="sy-row-fig" data-tip={t("system.procs.memTip")}>{t("system.procs.mem", { mem: pct(p.mem), rss: bytes(p.rss) })}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export function DiskSection({ disk }: { disk: Disk }) {
    const t = useT();
    const [openFiles, setOpenFiles] = useState(false);
    const top = Math.max(1, ...disk.entries.map((e) => e.size));
    return (
        <section className="sy-section">
            <PartHead
                icon="inv_misc_bag_10"
                tone="system"
                title={t("system.disk.title")}
                crumb={t("system.disk.at", { time: formatTime(disk.at) })}
                tip={t("system.disk.title")}
                tipSub={t("system.disk.tip")}
            />
            {disk.entries.length === 0
                ? <p className="hint sy-empty">{t("system.disk.empty")}</p>
                : (
                    <ul className="sy-rows">
                        {disk.entries.map((e) => (
                            <li key={e.name}>
                                <span className="sy-row-name">
                                    <code>{e.dir ? `${e.name}/` : e.name}</code>
                                    {e.dir && <span className="sy-label">{t("system.disk.files", { count: e.files })}</span>}
                                </span>
                                <Bar value={e.size} max={top} label={bytes(e.size)} />
                            </li>
                        ))}
                    </ul>
                )}
            {disk.truncated && <p className="hint">{t("system.disk.truncated")}</p>}
            {disk.files.length > 0 && (
                <div className="sy-slow">
                    <Expand open={openFiles} onToggle={() => setOpenFiles(!openFiles)} label={t("system.disk.biggest", { count: disk.files.length })} />
                    {openFiles && (
                        <ul className="sy-slow-list">
                            {disk.files.map((f) => (
                                <li key={f.path}>
                                    <code>{f.path}</code>
                                    <strong>{bytes(f.size)}</strong>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            {!disk.known && <p className="hint">{t("system.disk.noSpace")}</p>}
        </section>
    );
}
