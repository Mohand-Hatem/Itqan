#!/usr/bin/env node
// `npm run headers:check` (step 10.2a): the local header scan. Requests a page and the API
// through Nginx and fails if a security header from docs/09 §2 is missing, sent twice, or if a
// header leaks the server software. A public scan (Mozilla Observatory) runs at step 10.8.
//
// Usage: npm run headers:check [-- <base-url>]   (default http://localhost:8080, the local stack)

const base = (process.argv[2] ?? "http://localhost:8080").replace(/\/$/, "");
const https = base.startsWith("https://");

const everywhere = {
  "x-content-type-options": (v) => v === "nosniff",
  "referrer-policy": (v) => v === "strict-origin-when-cross-origin",
  "permissions-policy": (v) => v.includes("camera=()") && v.includes("microphone=()"),
  ...(https ? { "strict-transport-security": (v) => /max-age=\d{7,}/.test(v) } : {}),
};
const apiOnly = {
  "content-security-policy": (v) =>
    v.includes("default-src 'none'") && v.includes("frame-ancestors 'none'"),
  "x-frame-options": (v) => v === "DENY",
};

const targets = [
  { path: "/", required: everywhere },
  { path: "/api/health", required: { ...everywhere, ...apiOnly } },
  { path: "/api/no-such-route", required: { ...everywhere, ...apiOnly } },
];

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};

for (const { path, required } of targets) {
  const url = base + path;
  let res;
  try {
    // An Origin header from another site: the API must not grant it CORS access.
    res = await fetch(url, { redirect: "manual", headers: { origin: "https://evil.example" } });
  } catch (err) {
    console.error(
      `✗ ${url}: ${err.cause?.code ?? err.message}. Is the Docker stack up (docker compose up -d)?`,
    );
    process.exit(1);
  }
  console.log(`${url} → ${res.status}`);
  if (res.status >= 500) fail(`server error ${res.status}`);

  for (const [name, ok] of Object.entries(required)) {
    const value = res.headers.get(name);
    if (value === null) fail(`${name} missing`);
    // fetch joins repeated headers with ", ": a doubled header shows up as "x, x".
    else if (value.split(", ").length > 1 && new Set(value.split(", ")).size === 1)
      fail(`${name} sent twice`);
    else if (!ok(value)) fail(`${name} has an unexpected value: ${value}`);
  }

  if (res.headers.get("x-powered-by") !== null)
    fail(`x-powered-by present: ${res.headers.get("x-powered-by")}`);
  const server = res.headers.get("server");
  if (server && /\d/.test(server)) fail(`server header shows a version: ${server}`);
  if (path.startsWith("/api") && res.headers.get("access-control-allow-origin") !== null) {
    fail(`CORS granted to another origin: ${res.headers.get("access-control-allow-origin")}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} header problem(s).`);
  process.exit(1);
}
console.log("\nAll security headers present.");
