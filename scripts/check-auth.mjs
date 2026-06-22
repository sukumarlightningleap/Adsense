import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const accounts = await db.adsAccount.findMany({
  where: { demoMode: false },
  select: {
    id: true,
    customerId: true,
    descriptiveName: true,
    oauthRefreshToken: true,
    loginCustomerId: true,
    mccCustomerId: true,
    isManager: true,
  },
});

console.log(`Found ${accounts.length} account(s):\n`);
for (const a of accounts) {
  console.log({
    name: a.descriptiveName,
    customerId: a.customerId,
    isManager: a.isManager,
    authPath: a.oauthRefreshToken
      ? "per-account OAuth (encrypted token in DB)"
      : "env fallback (GOOGLE_ADS_TEST_REFRESH_TOKEN)",
    perAccountTokenPresent: !!a.oauthRefreshToken,
    loginCustomerId: a.loginCustomerId,
    mccCustomerId: a.mccCustomerId,
  });
}

console.log("\n--- Env profile ---");
console.log({
  GOOGLE_ADS_PROFILE: process.env.GOOGLE_ADS_PROFILE,
  GOOGLE_ADS_TEST_REFRESH_TOKEN_set:
    !!process.env.GOOGLE_ADS_TEST_REFRESH_TOKEN,
  GOOGLE_ADS_TEST_LOGIN_CUSTOMER_ID:
    process.env.GOOGLE_ADS_TEST_LOGIN_CUSTOMER_ID,
});

await db.$disconnect();
