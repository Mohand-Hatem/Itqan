import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load root .env
config({ path: resolve(fileURLToPath(import.meta.url), "../../../../.env") });

const { sendTestEmail } = await import("../dist/index.js");

const to = process.env.TEST_EMAIL_RECIPIENT || process.env.SUPER_ADMIN_EMAIL;
if (!to) {
  console.error("Error: Please set TEST_EMAIL_RECIPIENT (your email address) in .env");
  process.exit(1);
}

console.log(`Sending test email via Resend to ${to}...`);
const result = await sendTestEmail(to);

if (result.error) {
  console.error("Resend API error:", result.error);
  process.exit(1);
}

console.log("Success! Test email sent with Resend ID:", result.id);
