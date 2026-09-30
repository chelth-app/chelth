import { z } from "zod";

import { ROLES } from "@/lib/authz";
import { emailSchema } from "@/lib/validation";

const roleKeySchema = z.enum(ROLES, { error: "Choose a role." });

export const organisationIdSchema = z.uuid();

export const createOrganisationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Use at least 2 characters.")
    .max(200, "Use at most 200 characters.")
    .regex(/^[^\p{Cc}]*$/u, "Remove unsupported characters."),
});

export const inviteMemberSchema = z.object({
  organisationId: organisationIdSchema,
  email: emailSchema,
  roleKey: roleKeySchema,
});

export const inviteIdSchema = z.object({
  organisationId: organisationIdSchema,
  inviteId: z.uuid(),
});

export const membershipRoleSchema = z.object({
  organisationId: organisationIdSchema,
  membershipId: z.uuid(),
  roleKey: roleKeySchema,
});

export const membershipStatusSchema = z.object({
  organisationId: organisationIdSchema,
  membershipId: z.uuid(),
  status: z.enum(["active", "suspended", "revoked"]),
});

export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isInviteTokenFormat(value: string | null | undefined): value is string {
  return typeof value === "string" && INVITE_TOKEN_PATTERN.test(value);
}
export const inviteTokenSchema = z.string().regex(INVITE_TOKEN_PATTERN);

export const selectOrganisationSchema = z.object({ organisationId: organisationIdSchema });
