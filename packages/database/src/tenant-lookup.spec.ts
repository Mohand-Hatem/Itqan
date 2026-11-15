import { describe, expect, it } from "vitest";
import { createTenantLookup, TENANT_CACHE_MAX } from "./tenant-lookup.js";

// Step 10.3 (audit lead tenant-lookup-cache-unbounded-miss-entries).
describe("createTenantLookup cache", () => {
  it("stays bounded when many distinct unknown subdomains are looked up", async () => {
    const lookup = createTenantLookup({ tenant: { findFirst: async () => null } } as never);
    for (let i = 0; i < TENANT_CACHE_MAX + 50; i++) await lookup.findBySlug(`random-${i}`);
    expect(lookup.size).toBeLessThanOrEqual(TENANT_CACHE_MAX);
  });
});
