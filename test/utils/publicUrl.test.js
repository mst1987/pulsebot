jest.mock("../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example/" }));

const variables = require("../../src/config/variables");
const { publicBaseUrl } = require("../../src/utils/publicUrl");

describe("utils/publicUrl", () => {
    afterEach(() => {
        variables.publicBaseUrl = "https://eh.example/";
    });

    it("drops trailing slashes, so a path can be appended", () => {
        expect(publicBaseUrl()).toBe("https://eh.example");
        variables.publicBaseUrl = "https://eh.example///";
        expect(`${publicBaseUrl()}/profile`).toBe("https://eh.example/profile");
    });

    it("reads the config at call time and is empty when unset", () => {
        variables.publicBaseUrl = "http://localhost:3014";
        expect(publicBaseUrl()).toBe("http://localhost:3014");
        variables.publicBaseUrl = "";
        expect(publicBaseUrl()).toBe("");
        variables.publicBaseUrl = undefined;
        expect(publicBaseUrl()).toBe("");
    });
});
