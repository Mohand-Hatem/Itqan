import { describe, expect, it } from "vitest";
import { parseHost } from "./parse-host.js";

describe("parseHost", () => {
  const root = "itqan.com";

  it.each([
    ["drahmed.itqan.com", { kind: "tenant", slug: "drahmed" }],
    ["DrAhmed.Itqan.com", { kind: "tenant", slug: "drahmed" }],
    ["drahmed.itqan.com:8080", { kind: "tenant", slug: "drahmed" }],
    ["drahmed.itqan.com.", { kind: "tenant", slug: "drahmed" }],
    ["admin.itqan.com", { kind: "admin" }],
    ["itqan.com", { kind: "unknown" }],
    ["a.b.itqan.com", { kind: "unknown" }],
    ["dr_ahmed.itqan.com", { kind: "unknown" }],
    ["ab.itqan.com", { kind: "unknown" }],
    ["drahmed.evil.com", { kind: "unknown" }],
    ["drahmed.notitqan.com", { kind: "unknown" }],
    [undefined, { kind: "unknown" }],
  ])("%s → %o", (host, expected) => {
    expect(parseHost(host, root)).toEqual(expected);
  });

  it("works with localhost as the root domain", () => {
    expect(parseHost("drahmed.localhost:8080", "localhost")).toEqual({
      kind: "tenant",
      slug: "drahmed",
    });
  });
});
