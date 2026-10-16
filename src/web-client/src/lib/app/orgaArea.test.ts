import { describe, expect, it } from "vitest";
import { audienceText, isOrga, orgaAudience, orgaOnly, pageAudience } from "./orgaArea";

const audience = {
    signup: { everyone: true, roles: [], writers: [], accounts: 0 },
    roster: { everyone: false, roles: ["Raidleitung"], writers: [], accounts: 0 },
    raids: { everyone: false, roles: ["Mo Raider", "Raidleitung"], writers: ["Raidleitung"], accounts: 2 },
};

describe("orgaAudience", () => {
    it("marks an area no base access opens, naming its readers or its writers", () => {
        expect(orgaAudience({ audience }, ["raids"])).toEqual({ roles: ["Mo Raider", "Raidleitung"], accounts: 2 });
        expect(orgaAudience({ audience }, ["raids"], "write")).toEqual({ roles: ["Raidleitung"], accounts: 0 });
    });

    it("leaves a page alone when one of its areas is for everyone (Abwesenheiten: signup or roster)", () => {
        expect(orgaAudience({ audience }, ["signup", "roster"])).toBeNull();
        expect(orgaAudience({ audience }, ["signup"])).toBeNull();
    });

    it("joins the readers of several orga areas, and marks nothing without the server's audience", () => {
        expect(orgaAudience({ audience }, ["roster", "raids"])).toEqual({ roles: ["Mo Raider", "Raidleitung"], accounts: 2 });
        expect(orgaAudience({}, ["raids"])).toBeNull();
        expect(orgaAudience({ audience }, [])).toBeNull();
        // an area the account may not open is not in its audience
        expect(orgaAudience({ audience }, ["kader"])).toBeNull();
    });
});

describe("pageAudience", () => {
    it("takes a page's areas, and calls a page only full admins open an orga page without further readers", () => {
        expect(pageAudience({ audience }, { areas: ["raids"] })).toEqual({ roles: ["Mo Raider", "Raidleitung"], accounts: 2 });
        expect(pageAudience({ audience }, { areas: [], adminOnly: true })).toEqual({ roles: [], accounts: 0 });
        expect(pageAudience({ audience }, { areas: ["signup"] })).toBeNull();
    });
});

describe("isOrga / orgaOnly", () => {
    it("counts a full admin or an orga role as orga, and names the orga roles for an orga-only part", () => {
        expect(isOrga({ isAdmin: true })).toBe(true);
        expect(isOrga({ isAdmin: false, isOrga: true })).toBe(true);
        expect(isOrga({ isAdmin: false })).toBe(false);
        expect(orgaOnly({ orgaRoles: ["Raidleitung"] })).toEqual({ roles: ["Raidleitung"], accounts: 0 });
        expect(orgaOnly({})).toEqual({ roles: [], accounts: 0 });
    });
});

describe("audienceText", () => {
    it("names the admins first, then the roles, then the single accounts", () => {
        expect(audienceText({ roles: ["Raidleitung"], accounts: 0 })).toBe("Admins · @Raidleitung");
        expect(audienceText({ roles: [], accounts: 2 })).toBe("Admins · 2 einzelne Konten");
    });
});
