import { useState } from "react";
import { getServerPlans, saveServerPlan, type ApiError, type ServerPlanInput, type ServerPlanRow } from "../../../api";
import { useApi } from "../../../hooks/useApi";
import { useToast } from "../../../components/shell/Jobs";
import DataTable, { type Column } from "../../../components/ui/table/DataTable";
import { useTableSort } from "../../../lib/ui/tableSort";
import { tOr, useT } from "../../../i18n";

// Alle Server › Einstellungen › Tarife (docs/server-plans.md): which plan each server is on,
// until when, and a note for the full admins. One plain table; every change is saved at once
// through its own route (full admins only), never the page's draft.

type SortKey = "server" | "plan" | "until" | "note";

const SORT_DEFAULTS: Record<SortKey, "asc" | "desc"> = { server: "asc", plan: "asc", until: "asc", note: "asc" };

export default function ServerPlansSection() {
    const t = useT();
    const toast = useToast();
    const view = useApi(getServerPlans, []);
    const sort = useTableSort<SortKey>("server-plans-sort", SORT_DEFAULTS, "server");
    const [busy, setBusy] = useState("");

    if (!view.data) {
        return view.error ? <p className="note">{t("settings.serverPlans.loadError")}</p> : null;
    }
    const { plans, maxNote, servers } = view.data;

    const nameOf = (row: ServerPlanRow) => row.name || row.guildId;

    const save = async (row: ServerPlanRow, patch: Partial<ServerPlanInput>) => {
        setBusy(row.guildId);
        try {
            const { guildId, plan, until, note } = row;
            view.setData(await saveServerPlan({ guildId, plan, until, note, ...patch }));
            toast(t("settings.serverPlans.saved"));
        } catch (e) {
            toast((e as ApiError).message, "err");
        } finally {
            setBusy("");
        }
    };

    const sortValue = (row: ServerPlanRow, key: SortKey) => {
        if (key === "server") return nameOf(row).toLowerCase();
        if (key === "plan") return row.plan;
        if (key === "until") return row.until;
        return row.note.toLowerCase();
    };

    const columns: Column<ServerPlanRow, SortKey>[] = [
        {
            id: "server", label: t("settings.serverPlans.server"), sortKey: "server",
            cell: (row) => (row.name
                ? <b data-tip={row.guildId}>{row.name}</b>
                : <span className="srv-muted">{t("settings.serverPlans.gone", { id: row.guildId })}</span>),
        },
        {
            id: "plan", label: t("settings.serverPlans.plan"), sortKey: "plan",
            cell: (row) => (
                <select
                    aria-label={t("settings.serverPlans.planOf", { name: nameOf(row) })}
                    value={row.plan}
                    disabled={busy === row.guildId}
                    onChange={(e) => void save(row, { plan: e.target.value })}
                >
                    {plans.map((id) => <option key={id} value={id}>{tOr(`settings.serverPlans.plans.${id}`, id)}</option>)}
                </select>
            ),
        },
        {
            id: "until", label: t("settings.serverPlans.until"), sortKey: "until",
            cell: (row) => (
                <>
                    {/* saved on leaving the field: a typed date passes through values nobody means */}
                    <input
                        key={row.until}
                        className="inp-sm"
                        type="date"
                        aria-label={t("settings.serverPlans.untilOf", { name: nameOf(row) })}
                        defaultValue={row.until}
                        onBlur={(e) => { if (e.target.value !== row.until) void save(row, { until: e.target.value }); }}
                    />
                    {row.expired && <span className="plan-expired srv-muted">{t("settings.serverPlans.expired")}</span>}
                </>
            ),
        },
        {
            id: "note", label: t("settings.serverPlans.note"), sortKey: "note",
            cell: (row) => (
                <input
                    key={row.note}
                    className="inp-sm plan-note"
                    type="text"
                    aria-label={t("settings.serverPlans.noteOf", { name: nameOf(row) })}
                    defaultValue={row.note}
                    maxLength={maxNote}
                    onBlur={(e) => { if (e.target.value !== row.note) void save(row, { note: e.target.value }); }}
                />
            ),
        },
    ];

    return (
        <DataTable
            rows={servers}
            columns={columns}
            rowKey={(row) => row.guildId}
            wrapClassName="plan-wrap"
            sort={sort}
            sortValue={sortValue}
            empty={<div className="sync-empty">{t("settings.serverPlans.empty")}</div>}
        />
    );
}
