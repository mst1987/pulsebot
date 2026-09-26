import { get, send } from "./client";

// ===== Raid detail (per-event page) =====
// Part A (Setup/Anwesenheit/Loot, read-only) — see renderAdmin.js's renderEventDetail().
// Part B (this section's remainder): the mutating tabs (Anmeldung & Sheet, Softres) +
// header quick-post buttons, plus the standalone Notify-Templates CRUD page.

// Anmelde-Aufruf template — same shape src/web/settingsStore.js's listNotify()/saveNotify()
// persist (id/name/title/body; createdAt/updatedAt are stored but not surfaced here).
export type NotifyTemplate = { id: string; name: string; title: string; body: string };

export function getNotifyTemplates(): Promise<{ templates: NotifyTemplate[] }> {
    return get<{ templates: NotifyTemplate[] }>("/api/notify-templates");
}

export function saveNotifyTemplate(
    input: { id?: string; name: string; title: string; body: string },
): Promise<{ template: NotifyTemplate }> {
    return send("POST", "/api/notify-templates", input);
}

export function deleteNotifyTemplate(id: string): Promise<{ id: string }> {
    return send("POST", "/api/notify-templates/delete", { id });
}
