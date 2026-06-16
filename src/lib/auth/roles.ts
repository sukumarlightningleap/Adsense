/**
 * Role constants + RBAC helpers — ported from
 * adwords-benchmarks/src/launcher/auth/roles.py.
 *
 * Three roles, hardened semantics:
 *
 *   admin:  full access, manages users, sees both live AND demo data,
 *           demo toggle is theirs to flip.
 *   member: live data only, demo toggle is HIDDEN / forced off.
 *   demo:   demo data only, demo toggle is HIDDEN / forced on,
 *           browse-only (no create/edit).
 */
// Mirrors `enum UserRole` in prisma/schema.prisma. Prisma 7 nests the
// generated enum types under a `$Enums` namespace that isn't re-exported
// through the package barrel, so we declare the type locally. Keep this
// in sync with the schema (3 values).
export type UserRole = "admin" | "member" | "demo";

export const ROLES = {
  admin: "admin",
  member: "member",
  demo: "demo",
} as const satisfies Record<UserRole, UserRole>;

export const ALL_ROLES: readonly UserRole[] = [
  ROLES.admin,
  ROLES.member,
  ROLES.demo,
];

export function isAdmin(role: UserRole | null | undefined): boolean {
  return role === ROLES.admin;
}

export function isMember(role: UserRole | null | undefined): boolean {
  return role === ROLES.member;
}

export function isDemo(role: UserRole | null | undefined): boolean {
  return role === ROLES.demo;
}

/**
 * What the demo toggle actually resolves to, given the user's role.
 *
 * - demo user:   always true   (the toggle is hidden in the UI)
 * - member user: always false  (live data only)
 * - admin:       whatever they asked for
 *
 * Match this with the Streamlit version's behavior 1:1 so seed data and
 * query scoping behave identically.
 */
export function effectiveDemoMode(
  role: UserRole | null | undefined,
  requested: boolean,
): boolean {
  if (role === ROLES.demo) return true;
  if (role === ROLES.member) return false;
  return requested;
}

/**
 * Throw if the current role isn't in the allow list. Used at the top of
 * server actions / route handlers to gate access. Catch upstream and turn
 * into a 403 (API) or redirect (page).
 *
 * Note: parameter properties (`constructor(public x: ...)`) are avoided
 * because Node's `--experimental-strip-types` flag (used by our
 * `create-admin` script) only strips type syntax, not constructor
 * shorthand. Explicit field assignment keeps it portable.
 */
export class RoleAccessError extends Error {
  readonly required: readonly UserRole[];

  constructor(required: readonly UserRole[]) {
    super(`access denied: required one of [${required.join(", ")}]`);
    this.name = "RoleAccessError";
    this.required = required;
  }
}

export function requireRole(
  role: UserRole | null | undefined,
  ...allowed: UserRole[]
): asserts role is UserRole {
  if (!role || !allowed.includes(role)) {
    throw new RoleAccessError(allowed);
  }
}
