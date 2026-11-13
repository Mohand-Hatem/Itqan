// The link carries the invitation token, so it is https everywhere except local dev (*.localhost).
// The host is already a known tenant host: TenantMiddleware 404s any other.
export function joinLink(host: string, rawToken: string): string {
  const name = host.replace(/:\d+$/, "");
  const scheme = name === "localhost" || name.endsWith(".localhost") ? "http" : "https";
  return `${scheme}://${host}/join?token=${rawToken}`;
}
