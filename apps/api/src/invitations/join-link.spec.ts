// Security audit, Phase 6: invitation links carry a token, so they must use https outside local dev.
import { describe, expect, it } from "vitest";
import { joinLink } from "./join-link.js";

describe("joinLink", () => {
  it("uses https for real hosts", () => {
    expect(joinLink("acme.itqan.app", "tok")).toBe("https://acme.itqan.app/join?token=tok");
  });

  it("keeps http only for localhost", () => {
    expect(joinLink("acme.localhost", "tok")).toBe("http://acme.localhost/join?token=tok");
    expect(joinLink("acme.localhost:3000", "tok")).toBe(
      "http://acme.localhost:3000/join?token=tok",
    );
    expect(joinLink("localhost", "tok")).toBe("http://localhost/join?token=tok");
  });

  it("does not treat a look-alike host as local", () => {
    expect(joinLink("localhost.evil.com", "tok")).toBe("https://localhost.evil.com/join?token=tok");
  });
});
