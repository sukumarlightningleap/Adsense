import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { createDecipheriv } from "node:crypto";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

function decryptToken(stored) {
  const key = Buffer.from(
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY.trim().replace(/^['"]|['"]$/g, ""),
    "hex",
  );
  const [ivHex, tagHex, ctHex] = stored.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8",
  );
}

const account = await db.adsAccount.findFirst({
  where: { customerId: "5560219168" },
  select: {
    oauthRefreshToken: true,
    oauthScope: true,
    connectedAt: true,
  },
});

console.log("Account row:", {
  scope: account.oauthScope,
  connectedAt: account.connectedAt,
  tokenLen: account.oauthRefreshToken?.length,
});

let refreshToken;
try {
  refreshToken = decryptToken(account.oauthRefreshToken);
  console.log(
    "\nDecryption OK. Token preview:",
    refreshToken.slice(0, 12) + "..." + refreshToken.slice(-6),
    `(${refreshToken.length} chars)`,
  );
} catch (e) {
  console.error("\nDECRYPT FAILED:", e.message);
  console.error(
    "This means OAUTH_TOKEN_ENCRYPTION_KEY changed since the token was stored.",
  );
  process.exit(1);
}

const clientId = process.env.GOOGLE_ADS_TEST_CLIENT_ID;
const clientSecret = process.env.GOOGLE_ADS_TEST_CLIENT_SECRET;
console.log("\nUsing OAuth client:", clientId?.slice(0, 16) + "...");

const body = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  refresh_token: refreshToken,
  grant_type: "refresh_token",
});

const resp = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});
const json = await resp.json();
console.log("\nGoogle response:", resp.status, json);

await db.$disconnect();
