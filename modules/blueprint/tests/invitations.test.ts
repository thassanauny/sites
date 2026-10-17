import { describe, expect, it } from "vitest";
import {
  boardCodeFromHash,
  invitationCode,
  invitationFromHash,
  invitationLink,
} from "../src/domain/sharing/invitations";
const code = "a1".repeat(16);
describe("shared invitations on static hosts", () => {
  it("normalizes complete codes and accepts invitation links", () => {
    expect(invitationCode("A1".repeat(16))).toBe(code);
    expect(invitationCode("https://example.com/app/#/join/" + code)).toBe(code);
    expect(invitationCode(code.match(/.{1,8}/g)!.join("-"))).toBe(code);
  });
  it("preserves the hosting path and removes unrelated query parameters", () => {
    expect(
      invitationLink(
        code,
        "https://example.com/everydayapps/blueprint/?old=1#/board/x",
      ),
    ).toBe("https://example.com/everydayapps/blueprint/#/board/" + code);
  });
  it("selects a board only with a complete invitation in the route", () => {
    expect(boardCodeFromHash("#/board/" + code)).toBe(code);
    for (const hash of ["", "#/board", "#/board/", "#/editor", "#/boards", "#/board/abcd"])
      expect(boardCodeFromHash(hash)).toBeNull();
  });
  it("requires complete invitations and treats ordinary routes as no invitation", () => {
    expect(invitationFromHash("#/join/" + code)).toBe(code);
    expect(invitationFromHash("#/board/" + code)).toBeNull();
    for (const value of [
      "a".repeat(64),
      "abcd",
      "https://example.com/#/settings",
    ])
      expect(() => invitationCode(value)).toThrow();
    expect(() => invitationFromHash("#/join/%zz")).toThrow("invalid");
  });
});
