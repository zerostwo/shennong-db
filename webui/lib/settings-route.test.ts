import { describe, expect, it } from "vitest";
import { settingsHash, settingsSectionFromHash } from "./settings-route";

describe("settings hash routing", () => {
  it("uses ChatGPT-style settings fragments", () => {
    expect(settingsHash("account")).toBe("#settings/Account");
    expect(settingsHash("models")).toBe("#settings/Models");
    expect(settingsHash("skills")).toBe("#settings/Skills");
    expect(settingsHash("memory")).toBe("#settings/Memory");
  });

  it("parses settings routes case-insensitively and rejects unrelated hashes", () => {
    expect(settingsSectionFromHash("#settings/Account")).toBe("account");
    expect(settingsSectionFromHash("#SETTINGS/apitokens")).toBe("tokens");
    expect(settingsSectionFromHash("#project/Account")).toBeNull();
  });
});
