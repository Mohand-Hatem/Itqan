// The link carries a one-time token, so it is https everywhere except local dev (*.localhost).
// The host is already a known tenant host: TenantMiddleware 404s any other.
export function tokenLink(host: string, path: string, rawToken: string): string {
  const name = host.replace(/:\d+$/, "");
  const scheme = name === "localhost" || name.endsWith(".localhost") ? "http" : "https";
  return `${scheme}://${host}${path}?token=${rawToken}`;
}

export const joinLink = (host: string, rawToken: string) => tokenLink(host, "/join", rawToken);
