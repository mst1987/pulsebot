// lib/ui/tipParts.ts (#415): how a tooltip text splits into its bold head and its
// explanation. Moved out of components/ui/Tip.tsx so that file exports
// components only (react-refresh); the ui barrel still re-exports it.
// The split itself runs in src/web-client/src/lib/ui/tipParts.test.ts (Vitest).
const { read } = require("../clientSource");

describe("tipParts", () => {
    it("is used by Tip.tsx and still reachable through the ui barrel", () => {
        expect(read("components/ui/Tip.tsx")).toContain("import { tipParts } from \"../../lib/ui/tipParts\";");
        expect(read("components/ui/Tip.tsx")).not.toContain("export function tipParts");
        expect(read("components/ui/index.ts")).toContain("export { tipParts } from \"../../lib/ui/tipParts\";");
    });
});
