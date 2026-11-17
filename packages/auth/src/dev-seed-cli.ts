// npm run db:seed:dev → development test accounts in the seeded tenant (10R.4). Refused in production.
import process from "node:process";

try {
  process.loadEnvFile();
} catch {
  // No .env: the environment already has the variables.
}

const { seedDevAccounts } = await import("./dev-seed.js");
const { systemPrisma } = await import("@itqan/database");

try {
  const staffPassword = process.env["SEED_STAFF_PASSWORD"] ?? "";
  const studentPassword = process.env["SEED_STUDENT_PASSWORD"] ?? "";
  if (!staffPassword || !studentPassword) {
    throw new Error("Set SEED_STAFF_PASSWORD and SEED_STUDENT_PASSWORD in .env first.");
  }
  const emails = await seedDevAccounts({
    tenantSlug: process.env["SEED_TENANT_SLUG"] || "demo",
    staffPassword,
    studentPassword,
  });
  console.log(`Dev accounts ready: ${emails.join(", ")} (passwords from .env).`);
} catch (error) {
  console.error(error instanceof Error && !("code" in error) ? error.message : "Dev seed failed.");
  process.exitCode = 1;
} finally {
  await systemPrisma.$disconnect();
}
