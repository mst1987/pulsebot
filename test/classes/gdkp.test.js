jest.mock("axios");
jest.mock("../../src/utils/httpAgent");

const axios = require("axios");
const GDKP = require("../../src/classes/gdkp.js");
const { API_BASE_URL } = require("../../src/config/variables.js");
const agent = require("../../src/utils/httpAgent");

describe("classes/GDKP", () => {
    let client;

    beforeEach(() => {
        client = new GDKP();
    });

    it("builds the base url from API_BASE_URL", () => {
        expect(client.baseUrl).toBe(`${API_BASE_URL}/gargul-import`);
    });

    describe("getTotalItems", () => {
        it("requests the correct url with the shared https agent and returns data", async () => {
            const items = [{ item: "Thunderfury" }, { item: "Sulfuras" }];
            axios.get.mockResolvedValue({ data: items });

            const result = await client.getTotalItems("user-123");

            expect(axios.get).toHaveBeenCalledTimes(1);
            expect(axios.get).toHaveBeenCalledWith(
                `${API_BASE_URL}/gargul-import/totalitems/user/user-123`,
                { httpsAgent: agent }
            );
            expect(result).toBe(items);
        });

        it("re-throws when the request rejects", async () => {
            const err = new Error("network down");
            axios.get.mockRejectedValue(err);

            await expect(client.getTotalItems("user-123")).rejects.toThrow(
                "network down"
            );
            expect(axios.get).toHaveBeenCalledTimes(1);
        });
    });
});
