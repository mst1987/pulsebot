// The editor's section chips (BossNav) since #534: the bosses the linked log shows killed are dimmed with a check, and
// "Automatisch mitgehen" ends the bar while a log is read.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RaidplanBoss } from "../../../api";
import BossNav from "./BossNav";

const boss = (key: string, name: string) => ({ key, name, iconUrl: "", instanceId: "bt", instanceName: "Black Temple" }) as unknown as RaidplanBoss;
const BOSSES = [boss("bt/high-warlord-najentus", "High Warlord Naj'entus"), boss("bt/supremus", "Supremus"), boss("bt/shade-of-akama", "Shade of Akama")];

describe("BossNav (#534)", () => {
    it("marks killed bosses and keeps the others as they were", () => {
        const { container } = render(<BossNav bosses={BOSSES} selected="bt/supremus" draft={{}} onSelect={vi.fn()} killedKeys={new Set(["bt/high-warlord-najentus"])} />);
        const killed = Array.from(container.querySelectorAll(".rp-bosschip.is-killed"));
        expect(killed.map((b) => b.textContent)).toEqual(["High Warlord Naj'entus"]);
        expect(killed[0].getAttribute("data-tip")).toBe("Im Log getötet");
        expect(screen.getByRole("button", { name: "Supremus" }).getAttribute("data-tip")).toBeNull();
        expect(container.querySelector(".rp-autofollow")).toBeNull();
    });

    it("hands a chip click to onSelect and the switch to its toggle", () => {
        const onSelect = vi.fn();
        const onToggle = vi.fn();
        render(<BossNav bosses={BOSSES} selected="bt/supremus" draft={{}} onSelect={onSelect} follow={{ on: false, onToggle }} />);
        fireEvent.click(screen.getByRole("button", { name: "Shade of Akama" }));
        expect(onSelect).toHaveBeenCalledWith("bt/shade-of-akama");
        const sw = screen.getByRole("button", { name: "Automatisch mitgehen" });
        expect(sw.getAttribute("aria-pressed")).toBe("false");
        fireEvent.click(sw);
        expect(onToggle).toHaveBeenCalled();
    });
});
