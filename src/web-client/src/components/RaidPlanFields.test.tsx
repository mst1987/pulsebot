// The plan fields both the "Event anlegen" dialog (#261) and the Raid-Vorlagen
// editor (#266) are built from, drawn with the server's real rule set: the
// instances as icon chips (with "Infos fehlen"), the size segment with "frei",
// and the "Aussehen" line (#307) with its small preview of the event message.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GameVersion } from "../api";
import { t } from "../i18n";
import { EMBED_ACCENT, allowedSizes, leadInstance } from "../lib/raidTemplates";
import { requireBackend } from "../test/backend";
import { AppearanceFields, InstancePicker, SizePicker } from "./RaidPlanFields";

const { publicVersions } = requireBackend("config/gameVersions");
const versions: GameVersion[] = publicVersions();
const tbc = versions.find((v) => v.id === "tbc")!;
const incomplete = versions.flatMap((v) => v.instances.map((i) => ({ v, i }))).find(({ i }) => i.status === "incomplete");

describe("InstancePicker", () => {
    it("offers the version's instances as toggle chips", async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        render(<InstancePicker version={tbc} value={["kara"]} onToggle={onToggle} />);
        const group = screen.getByRole("group", { name: t("raidPlan.fields.instances") });
        const chips = within(group).getAllByRole("button");
        expect(chips).toHaveLength(tbc.instances.length);
        const kara = tbc.instances.find((i) => i.id === "kara")!;
        const chip = within(group).getByRole("button", { name: new RegExp(kara.short) });
        expect(chip).toHaveAttribute("aria-pressed", "true");
        expect(chip).toHaveAttribute("data-tip", kara.name);
        await user.click(chips.find((c) => c !== chip)!);
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(t("raidPlan.fields.incomplete"))).not.toBeInTheDocument();
    });

    it.runIf(!!incomplete)("marks a chosen instance whose information is still missing with the badge", () => {
        const { v, i } = incomplete!;
        render(<InstancePicker version={v} value={[i.id]} onToggle={() => {}} />);
        expect(screen.getByText(t("raidPlan.fields.incomplete"))).toBeInTheDocument();
        expect(screen.getByRole("button", { name: new RegExp(i.short) })).toHaveAttribute("data-tip-sub", t("raidPlan.fields.incompleteTip"));
    });
});

describe("SizePicker", () => {
    it("offers the allowed sizes as a segment, plus „frei“ with a number field", async () => {
        const user = userEvent.setup();
        const onFree = vi.fn();
        const onSize = vi.fn();
        const { rerender } = render(<SizePicker version={tbc} instanceIds={["kara", "ssc"]} size={10} free={false} onFree={onFree} onSize={onSize} />);
        const segment = screen.getByRole("radiogroup", { name: t("raidPlan.fields.size") });
        const labels = within(segment).getAllByRole("radio").map((r) => r.textContent);
        expect(labels).toEqual([...allowedSizes(tbc, ["kara", "ssc"]).map(String), t("raidPlan.fields.free")]);
        expect(within(segment).getByRole("radio", { name: "10" })).toHaveAttribute("aria-checked", "true");
        expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

        await user.click(within(segment).getByRole("radio", { name: "25" }));
        expect(onSize).toHaveBeenCalledWith(25);
        await user.click(within(segment).getByRole("radio", { name: t("raidPlan.fields.free") }));
        expect(onFree).toHaveBeenCalledWith(true);

        rerender(<SizePicker version={tbc} instanceIds={["kara", "ssc"]} size={12} free onFree={onFree} onSize={onSize} />);
        expect(screen.getByRole("spinbutton", { name: t("raidPlan.fields.freeAria") })).toHaveValue(12);
    });
});

describe("Aussehen (#307)", () => {
    const look = (over: Partial<Parameters<typeof AppearanceFields>[0]> = {}) => (
        <AppearanceFields idPrefix="x" version={tbc} instanceIds={["kara"]} color="" image={{ mode: "thumbnail", url: "" }} emojiStyle="arcane" onChange={() => {}} {...over} />
    );

    it("shows colour and picture with a small preview instead of just a hex field — the rule in the tooltip, not a paragraph", () => {
        const { container } = render(look({ color: "#123456", image: { mode: "banner", url: "https://example.org/b.png" } }));
        expect(screen.getByLabelText(t("raidPlan.fields.pickColor"))).toHaveAttribute("type", "color");
        expect(screen.getByRole("textbox", { name: t("raidPlan.fields.colorHex") })).toHaveValue("#123456");
        const mode = screen.getByRole("radiogroup", { name: t("raidPlan.fields.image") });
        expect(within(mode).getAllByRole("radio").map((r) => r.textContent)).toEqual([t("raidPlan.fields.thumbnail"), t("raidPlan.fields.banner")]);
        // the preview: the colour bar and the picture as a banner
        const preview = container.querySelector("[aria-hidden=\"true\"]")!;
        // the colour goes in as --rt-look (#441)
        expect((preview.querySelector("span") as HTMLElement).style.getPropertyValue("--rt-look")).toBe("#123456");
        expect(preview.querySelector("img")).toHaveAttribute("src", "https://example.org/b.png");
        // the rule sits in the label's tooltip, never as a paragraph on the page
        expect(screen.getByText(t("raidPlan.fields.look"))).toHaveAttribute("data-tip-sub", t("raidPlan.fields.lookTip"));
        expect(t("raidPlan.fields.lookTip")).not.toContain("Boss-Icon");
        expect(container.querySelector("p")).toBeNull();
    });

    it("shows no picture without one — never the boss icon as a fallback (#353)", () => {
        const { container } = render(look());
        expect(container.querySelector("img")).toBeNull();
        expect(screen.getByText(new RegExp(t("raidPlan.fields.noImage")))).toBeInTheDocument();
    });

    it("takes the colour of the leading instance from the shared rule, the accent without one", () => {
        const lead = leadInstance(tbc, ["kara", "gruul"]);
        const { container, rerender } = render(look({ instanceIds: ["kara", "gruul"] }));
        const bar = () => (container.querySelector("[aria-hidden=\"true\"] span") as HTMLElement).style.getPropertyValue("--rt-look");
        const swatch = () => screen.getByLabelText(t("raidPlan.fields.pickColor"));
        expect(swatch()).toHaveValue((lead?.color || EMBED_ACCENT).toLowerCase());
        expect(bar()).not.toBe("");
        rerender(look({ instanceIds: [] }));
        expect(swatch()).toHaveValue(EMBED_ACCENT);
        expect(screen.getByText(new RegExp(t("raidPlan.fields.defaultColor")))).toBeInTheDocument();
    });
});
