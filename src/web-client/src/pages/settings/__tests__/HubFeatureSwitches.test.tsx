// The parts of a category's Discord hub, one switch each (#969): a missing key is on,
// a click saves at once through the hub's own API, all off shows a note (Raid-Zentrale only).
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { renderPage } from "../../../test/render";
import HubFeatureSwitches from "../HubFeatureSwitches";

const RAID_KEYS = ["nextRaid", "attendance", "evaluation", "guildBank", "links"];
const label = (kind: string, key: string) => t(`settings.categories.hubFeature.${kind}.${key}`);

function show(features: Record<string, boolean> = {}, keys = RAID_KEYS, kind: "raid" | "orga" = "raid") {
    const save = vi.fn(async (_id: string, change: Record<string, boolean>) => ({ features: { ...Object.fromEntries(keys.map((k) => [k, features[k] !== false])), ...change } }));
    const onSaved = vi.fn();
    renderPage(<HubFeatureSwitches kind={kind} categoryId="c1" keys={keys} features={features} save={save} onSaved={onSaved} />);
    return { save, onSaved };
}

describe("HubFeatureSwitches", () => {
    it("shows one switch per part in the server's order, a missing key as on", () => {
        show({ evaluation: false });
        const switches = screen.getAllByRole("switch");
        expect(switches).toHaveLength(5);
        expect(screen.getByRole("switch", { name: label("raid", "nextRaid") })).toBeChecked();
        expect(screen.getByRole("switch", { name: label("raid", "evaluation") })).not.toBeChecked();
        expect(screen.queryByText(t("settings.categories.hubFeaturesAllOff"))).not.toBeInTheDocument();
    });

    it("saves only the switched part at once and hands the server's answer on", async () => {
        const user = userEvent.setup();
        const { save, onSaved } = show();
        await user.click(screen.getByRole("switch", { name: label("raid", "guildBank") }));
        expect(save).toHaveBeenCalledWith("c1", { guildBank: false });
        expect(onSaved).toHaveBeenCalledWith("c1", expect.objectContaining({ guildBank: false, nextRaid: true }));
        expect(await screen.findByText(t("settings.categories.hubFeatureSaved"))).toBeInTheDocument();
    });

    it("says that only the heading stays when every part of the raid hub is off", () => {
        show(Object.fromEntries(RAID_KEYS.map((k) => [k, false])));
        expect(screen.getByRole("switch", { name: label("raid", "links") })).not.toBeChecked();
        expect(screen.getByText(t("settings.categories.hubFeaturesAllOff"))).toBeInTheDocument();
    });

    it("gives the orga hub no note when every part is off, its raid list always stays", () => {
        show({ newRaid: false, links: false, summary: false }, ["newRaid", "links", "summary"], "orga");
        expect(screen.getByRole("switch", { name: label("orga", "summary") })).not.toBeChecked();
        expect(screen.queryByText(t("settings.categories.hubFeaturesAllOff"))).not.toBeInTheDocument();
    });

    it("shows the error of a refused save", async () => {
        const user = userEvent.setup();
        const save = vi.fn().mockRejectedValue(Object.assign(new Error("Den Bereich gibt es nicht."), { status: 400 }));
        renderPage(<HubFeatureSwitches kind="raid" categoryId="c1" keys={RAID_KEYS} features={{}} save={save} onSaved={vi.fn()} />);
        await user.click(screen.getByRole("switch", { name: label("raid", "links") }));
        expect(await screen.findByText("Den Bereich gibt es nicht.")).toBeInTheDocument();
    });

    it("renders nothing without parts (an older server)", () => {
        const { container } = renderPage(<HubFeatureSwitches kind="orga" categoryId="c1" keys={[]} features={{}} save={vi.fn()} onSaved={vi.fn()} />);
        expect(container.querySelector(".cat-features")).toBeNull();
    });
});
