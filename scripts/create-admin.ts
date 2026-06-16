#!/usr/bin/env -S node --experimental-strip-types
/**
 * Bootstrap an admin user from the CLI.
 *
 * Public signup is disabled — admins are seeded here, members + demo
 * users are created by an admin from the /app/admin/users UI later.
 *
 *   npm run create-admin -- --email you@example.com --name "Your Name" --password "S3cure!pass"
 *
 * If the email already exists, the script PROMOTES that user to admin
 * (idempotent — rerun-safe).
 */
import { parseArgs } from "node:util";
import bcrypt from "bcryptjs";

import { db } from "../src/lib/db.ts";
import { ROLES } from "../src/lib/auth/roles.ts";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      password: { type: "string" },
    },
    strict: true,
  });

  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  const password = values.password;

  if (!email || !email.includes("@")) {
    console.error("error: --email is required and must look like an email");
    return 2;
  }
  if (!name) {
    console.error("error: --name is required");
    return 2;
  }
  if (!password || password.length < 8) {
    console.error("error: --password is required and must be ≥ 8 characters");
    return 2;
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const existing = await db.user.findUnique({ where: { email } });

  if (existing) {
    const updated = await db.user.update({
      where: { id: existing.id },
      data: {
        role: ROLES.admin,
        isActive: true,
        hashedPassword,
        name,
      },
    });
    console.log(`admin updated: id=${updated.id}, email=${email}`);
  } else {
    const created = await db.user.create({
      data: {
        email,
        name,
        hashedPassword,
        role: ROLES.admin,
        isActive: true,
      },
    });
    console.log(`admin created: id=${created.id}, email=${email}`);
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
