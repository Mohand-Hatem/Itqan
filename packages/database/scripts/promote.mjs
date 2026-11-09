// Promote migrations from local Docker to a Neon branch: `npm run db:promote:dev`.
// Order: full test suite on Docker → migrate deploy (direct URL) → migrate status → pooled query.
// `migrate deploy` only applies new migration files; it never resets or drops data.
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import pg from "pg";

// Only `dev` for now. `main` (production) is added in step 10.12 with an extra confirmation.
export const TARGETS = {
  dev: { pooled: "NEON_DEV_DATABASE_URL", direct: "NEON_DEV_DIRECT_URL" },
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

// Returns the target's URLs or throws a readable reason. Exported for tests.
export function checkTarget(target, env) {
  const names = TARGETS[target];
  if (!names) {
    throw new Error(`Unknown target "${target}". Allowed: ${Object.keys(TARGETS).join(", ")}.`);
  }
  const urls = {};
  for (const [kind, name] of Object.entries(names)) {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set in .env (see docs/10-dev-setup.md).`);
    let host;
    try {
      host = new URL(value).hostname;
    } catch {
      throw new Error(`${name} is not a valid connection string.`);
    }
    if (LOCAL_HOSTS.has(host)) throw new Error(`${name} points at a local database (${host}).`);
    urls[kind] = value;
  }
  return urls;
}

function step(label, command, options = {}) {
  console.log(`\n▶ ${label}`);
  execSync(command, { stdio: "inherit", ...options });
}

async function main() {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const dbDir = fileURLToPath(new URL("../", import.meta.url));
  config({ path: `${root}.env`, quiet: true });

  const target = process.argv[2] ?? "";
  const urls = checkTarget(target, process.env);
  const onTarget = { cwd: dbDir, env: { ...process.env, DATABASE_URL: urls.direct } };

  step("1/4 Full test suite on Docker Postgres", "npm test", { cwd: root });
  step(`2/4 Apply migrations to Neon ${target}`, "npx prisma migrate deploy", onTarget);
  step(`3/4 Check Neon ${target} matches our migrations`, "npx prisma migrate status", onTarget);

  console.log(`\n▶ 4/4 Test query over the pooled connection`);
  const client = new pg.Client({ connectionString: urls.pooled });
  await client.connect();
  const { rows } = await client.query("SELECT current_database() AS db, version() AS version");
  await client.end();
  console.log(`  connected to "${rows[0].db}" (${rows[0].version.split(",")[0]})`);
  console.log(`\n✔ Neon ${target} is up to date.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`\n✖ Promotion stopped: ${error.message}`);
    process.exit(1);
  });
}
