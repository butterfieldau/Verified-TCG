import { Resend } from "resend";
import { adminAccountsTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createInvitationToken, hashAdminToken } from "./adminSession";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationDeliveryStatus = "sent" | "unavailable" | "failed";

function invitationConfig():
  | { apiKey: string; from: string; appUrl: string }
  | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ADMIN_INVITE_FROM_EMAIL;
  const appUrl = process.env.ADMIN_APP_URL;
  return apiKey && from && appUrl ? { apiKey, from, appUrl } : null;
}

export function isAdminInvitationDeliveryConfigured(): boolean {
  return invitationConfig() !== null;
}

/**
 * Generates a single-use invitation token server-side and sends it directly to
 * the recipient. The raw token is never returned to an operator's browser.
 */
export async function issueAdminInvitation(
  adminId: string,
  email: string,
): Promise<InvitationDeliveryStatus> {
  const config = invitationConfig();
  if (!config) {
    await db
      .update(adminAccountsTable)
      .set({
        invitationTokenHash: null,
        invitationExpiresAt: null,
        invitationDeliveryStatus: "unavailable",
        updatedAt: new Date(),
      })
      .where(eq(adminAccountsTable.id, adminId));
    return "unavailable";
  }

  const token = createInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  await db
    .update(adminAccountsTable)
    .set({
      invitationTokenHash: hashAdminToken(token),
      invitationExpiresAt: expiresAt,
      invitationDeliveryStatus: "not_requested",
      updatedAt: new Date(),
    })
    .where(eq(adminAccountsTable.id, adminId));

  const activateUrl = `${config.appUrl.replace(/\/$/, "")}/activate?token=${encodeURIComponent(token)}`;
  const resend = new Resend(config.apiKey);
  const { error } = await resend.emails.send({
    from: config.from,
    to: email,
    subject: "You’re invited to the Verified TCG Command Centre",
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#18181b">
        <h2>Verified TCG Command Centre</h2>
        <p>An Owner invited you to join the administration team.</p>
        <p><a href="${activateUrl}" style="display:inline-block;background:#e11d2e;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Accept invitation</a></p>
        <p style="font-size:13px;color:#71717a">This single-use link expires in 7 days. If you were not expecting this invitation, ignore this email.</p>
      </div>
    `,
  });

  const status: InvitationDeliveryStatus = error ? "failed" : "sent";
  await db
    .update(adminAccountsTable)
    .set({ invitationDeliveryStatus: status, updatedAt: new Date() })
    .where(eq(adminAccountsTable.id, adminId));
  return status;
}