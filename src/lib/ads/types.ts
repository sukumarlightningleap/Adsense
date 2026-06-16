/**
 * String-literal types that mirror the Postgres enums in
 * `prisma/schema.prisma`. Defined locally (rather than imported from
 * `@prisma/client`) because Prisma 7 nests its enum types under
 * `$Enums` which isn't re-exported through the package barrel.
 *
 * Keep this file in sync with the schema (add/remove values together).
 */

export type CampaignStatus = "ENABLED" | "PAUSED" | "REMOVED";

export type ChannelType =
  | "SEARCH"
  | "PMAX"
  | "DISPLAY"
  | "VIDEO"
  | "DISCOVERY";

export type AssetKind = "image" | "logo" | "pdf" | "video";

export type AssetRole =
  | "marketing_image"
  | "square_marketing_image"
  | "portrait_marketing_image"
  | "logo"
  | "square_logo"
  | "landscape_logo";

export const ALL_CHANNELS: readonly ChannelType[] = [
  "SEARCH",
  "PMAX",
  "DISPLAY",
  "VIDEO",
  "DISCOVERY",
];
