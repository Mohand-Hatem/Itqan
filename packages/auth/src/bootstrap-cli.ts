// npm run admin:bootstrap                    → create the first super admin (SUPER_ADMIN_EMAIL)
// npm run admin:bootstrap -- --recover <email> → set a new password for that super admin
// In the production image: docker compose exec api node packages/auth/dist/bootstrap-cli.js
// The password is typed at the prompt (SUPER_ADMIN_PASSWORD only for scripted CI runs) and is
// never printed or logged.
import process from "node:process";
import { readSecret } from "./prompt.js";

try {
  process.loadEnvFile(); // local runs: the repo's .env; the server passes real variables
} catch {
  // No .env here: the environment already has the variables.
}

const { BootstrapError, bootstrapSuperAdmin, recoverSuperAdmin } = await import("./bootstrap.js");
const { systemPrisma } = await import("@itqan/database");

async function password() {
  const fromEnv = process.env["SUPER_ADMIN_PASSWORD"];
  if (fromEnv) return fromEnv;
  const first = await readSecret("New super admin password (12+ characters): ");
  const again = await readSecret("Type it again: ");
  if (first !== again) throw new BootstrapError("The two passwords differ.");
  return first;
}

try {
  const args = process.argv.slice(2);
  const at = args.indexOf("--recover");
  if (at >= 0) {
    const email = args[at + 1];
    if (!email) throw new BootstrapError("Usage: --recover <email>");
    const { sessionsEnded } = await recoverSuperAdmin({ email, password: await password() });
    console.log(`Password set for ${email}. Sessions ended: ${sessionsEnded}.`);
  } else {
    const email = process.env["SUPER_ADMIN_EMAIL"];
    if (!email) throw new BootstrapError("Set SUPER_ADMIN_EMAIL first.");
    const name = process.env["SUPER_ADMIN_NAME"] || "Super Admin";
    await bootstrapSuperAdmin({ email, name, password: await password() });
    console.log(`Super admin ${email} created. Sign in on the admin host.`);
  }
} catch (error) {
  // Only our own messages or an error code: a raw database error can echo the query (the hash).
  const code = (error as { code?: string })?.code ?? (error as Error)?.name ?? "unknown";
  console.error(error instanceof BootstrapError ? error.message : `Bootstrap failed (${code}).`);
  process.exitCode = 1;
} finally {
  await systemPrisma.$disconnect();
}
