jest.mock("../../src/stores/raiderCharactersStore", () => ({ charactersForUser: jest.fn() }));
jest.mock("../../src/stores/raiderProfileStore", () => ({ getProfile: jest.fn() }));

const { charactersForUser } = require("../../src/stores/raiderCharactersStore");
const { getProfile } = require("../../src/stores/raiderProfileStore");
const { myCharacters } = require("../../src/web/userCharacters");

beforeEach(() => jest.clearAllMocks());

describe("web/userCharacters", () => {
    it("puts the raid lead's assignment first and adds the profile's characters once", () => {
        charactersForUser.mockReturnValue([{ character: "Elesham", categoryIds: ["mon"] }]);
        getProfile.mockReturnValue({ characters: [{ name: "elesham" }, { name: "Dorn" }, { name: "" }] });
        expect(myCharacters("u1")).toEqual([
            { character: "Elesham", categoryIds: ["mon"] },
            { character: "Dorn", categoryIds: [] },
        ]);
        expect(getProfile).toHaveBeenCalledWith("u1");
    });

    it("works without a profile and when the profile store fails", () => {
        charactersForUser.mockReturnValue([]);
        getProfile.mockReturnValue(null);
        expect(myCharacters("u1")).toEqual([]);
        getProfile.mockImplementation(() => { throw new Error("kaputt"); });
        expect(myCharacters("u1")).toEqual([]);
    });
});
