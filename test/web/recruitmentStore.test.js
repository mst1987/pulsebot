const fs = require("fs");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/web/recruitmentStore");

let templatesFile;
let postsFile;

beforeEach(() => {
    templatesFile = tempStoreFile("recruitment.json");
    postsFile = tempStoreFile("recruitment-posts.json");
    store.useFile(templatesFile, postsFile);
});

afterAll(() => store.useFile(null, null));

describe("web/recruitmentStore templates", () => {
    it("is empty without a file", () => {
        expect(store.listRecruitment()).toEqual([]);
        expect(store.getRecruitment("x")).toBeNull();
    });

    it("creates, updates, lists newest-edited first and deletes", () => {
        const now = jest.spyOn(Date, "now").mockReturnValue(1000);
        const a = store.saveRecruitment({ name: " Heiler ", content: "c", title: " T ", body: "b", buttonLabel: " Go " });
        expect(a).toMatchObject({ name: "Heiler", title: "T", buttonLabel: "Go", createdAt: 1000, updatedAt: 1000 });
        now.mockReturnValue(2000);
        const b = store.saveRecruitment({ name: "Tanks" });
        expect(store.listRecruitment().map((t) => t.id)).toEqual([b.id, a.id]);
        now.mockReturnValue(3000);
        const again = store.saveRecruitment({ id: a.id, name: "Heiler neu" });
        expect(again).toMatchObject({ id: a.id, name: "Heiler neu", createdAt: 1000, updatedAt: 3000 });
        expect(store.listRecruitment().map((t) => t.id)).toEqual([a.id, b.id]);
        expect(store.getRecruitment(b.id).name).toBe("Tanks");
        expect(store.deleteRecruitment(b.id)).toBe(true);
        expect(store.deleteRecruitment(b.id)).toBe(false);
        expect(JSON.parse(fs.readFileSync(templatesFile, "utf8")).templates).toHaveLength(1);
        now.mockRestore();
    });

    it("tolerates a file without a template list", () => {
        fs.writeFileSync(templatesFile, JSON.stringify({ other: 1 }));
        expect(store.listRecruitment()).toEqual([]);
    });
});

describe("web/recruitmentStore posts", () => {
    const post = () => ({ guildId: "g", channelId: "c1", messageId: "m1", channelName: "#rec", content: "hi", source: "scan" });

    it("is empty without a file", () => {
        expect(store.listRecruitmentPosts()).toEqual([]);
        expect(store.getRecruitmentPost("x")).toBeNull();
    });

    it("records a post once per channel + message and keeps a web origin", () => {
        const first = store.saveRecruitmentPost({ ...post(), source: "web", templateId: "t1" });
        const again = store.saveRecruitmentPost({ channelId: "c1", messageId: "m1", source: "scan" });
        expect(again.id).toBe(first.id);
        expect(again).toMatchObject({ source: "web", templateId: "t1", guildId: "g", channelName: "#rec" });
        expect(store.listRecruitmentPosts()).toHaveLength(1);
        expect(store.getRecruitmentPost(first.id).messageId).toBe("m1");
    });

    it("updates by id, sorts newest first and deletes", () => {
        const now = jest.spyOn(Date, "now").mockReturnValue(1000);
        const a = store.saveRecruitmentPost(post());
        now.mockReturnValue(2000);
        const b = store.saveRecruitmentPost({ ...post(), messageId: "m2" });
        expect(store.listRecruitmentPosts().map((p) => p.id)).toEqual([b.id, a.id]);
        expect(store.saveRecruitmentPost({ id: a.id, content: "neu" })).toMatchObject({ id: a.id, content: "neu", source: "scan" });
        expect(store.deleteRecruitmentPost(a.id)).toBe(true);
        expect(store.deleteRecruitmentPost(a.id)).toBe(false);
        expect(store.listRecruitmentPosts().map((p) => p.id)).toEqual([b.id]);
        now.mockRestore();
    });

    it("a post without a source defaults to web", () => {
        expect(store.saveRecruitmentPost({ channelId: "c9", messageId: "m9" })).toMatchObject({ source: "web", templateId: "" });
    });
});
