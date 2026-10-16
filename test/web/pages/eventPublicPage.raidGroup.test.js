// The public page of a raid of a raid group (#811): it says which raid it is and
// links the evening's other raids (their public pages — titles and links only),
// and its signup link goes to the group's first raid, where the raiders sign up.
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));
const { publicEventView, renderPublicEventBody, VIEW_KEYS } = require("../../../src/web/pages/eventPublicPage");
const { ownEvent } = require("../../factories/events");

const group = {
    id: "eh-za", primaryId: "eh-za", count: 2, places: 20,
    raids: [{ id: "eh-za", title: "Zul'Aman", index: 1 }, { id: "eh-za2", title: "Zul'Aman 2", index: 2 }],
};
const sibling = ownEvent({ id: "eh-za2", title: "Zul'Aman 2", raidGroupId: "eh-za", raidGroupIndex: 2 });
const primary = ownEvent({ id: "eh-za", title: "Zul'Aman", raidGroupId: "eh-za", raidGroupIndex: 1 });

/** Every key of a payload, at every level. */
function keysOf(value, out = new Set()) {
    if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { out.add(k); keysOf(v, out); }
    return out;
}

describe("the public page of a raid group", () => {
    it("names the raid and links the other raids; the first raid's page links the others", () => {
        const view = publicEventView(primary, [], { lang: "en", group });
        expect(view.group).toEqual({
            index: 1, count: 2,
            raids: [
                { id: "eh-za", title: "Zul'Aman", index: 1, url: "/e/eh-za", current: true },
                { id: "eh-za2", title: "Zul'Aman 2", index: 2, url: "/e/eh-za2", current: false },
            ],
        });
        const html = renderPublicEventBody(view, { lang: "en" });
        expect(html).toContain("Raid 1 of 2");
        expect(html).toContain("href=\"/e/eh-za2\"");
    });

    it("sends the signup of a further raid to the first raid", () => {
        const view = publicEventView(sibling, [], { lang: "de", group });
        expect(view.signupUrl).toBe("/signups?event=eh-za");
        expect(renderPublicEventBody(view, { lang: "de" })).toContain("Raid 2 von 2");
    });

    it("carries nothing beyond the allowed keys, and no group outside one", () => {
        for (const key of keysOf(publicEventView(sibling, [], { group }))) expect(VIEW_KEYS).toContain(key);
        expect(publicEventView(ownEvent(), [], {}).group).toBeNull();
    });
});
