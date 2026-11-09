import { TenantSlugSchema } from "@itqan/shared";

export type HostTarget = { kind: "tenant"; slug: string } | { kind: "admin" } | { kind: "unknown" };

const ADMIN_SUBDOMAIN = "admin";

// "<slug>.<root>" → tenant, "admin.<root>" → super admin site, anything else → unknown.
export function parseHost(host: string | undefined, rootDomain: string): HostTarget {
  if (!host) return { kind: "unknown" };
  const name = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const suffix = `.${rootDomain.toLowerCase()}`;
  if (!name.endsWith(suffix)) return { kind: "unknown" };

  const sub = name.slice(0, -suffix.length);
  if (sub === ADMIN_SUBDOMAIN) return { kind: "admin" };
  if (sub.includes(".") || !TenantSlugSchema.safeParse(sub).success) return { kind: "unknown" };
  return { kind: "tenant", slug: sub };
}

export function getRootDomain(): string {
  const root = process.env["PLATFORM_ROOT_DOMAIN"];
  if (root) return root;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("PLATFORM_ROOT_DOMAIN must be set in production.");
  }
  return "localhost";
}
