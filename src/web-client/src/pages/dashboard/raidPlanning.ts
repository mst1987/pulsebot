// How a raid of the start page is planned — shared by the next-raid card and its details modal.
import type { DashboardRaid } from "../../api";

/**
 * Whether the raid's category plans with a Google Sheet (planning.js on the server) —
 * only then is a sheet badge or a "Sheet füllen" button worth showing.
 */
export function usesSheet(raid: Pick<DashboardRaid, "planning">): boolean {
    return raid.planning === "sheet";
}
