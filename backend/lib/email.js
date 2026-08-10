const { Resend } = require("resend");

// Lazy singleton — created on first send so dotenv has loaded by then
let resendClient = null;
const getResend = () => {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
};

// Resend requires a verified domain in production;
// onboarding@resend.dev works for testing (delivers to your own account email)
const fromAddress = () =>
  process.env.RESEND_FROM_EMAIL || "TeamSpace <onboarding@resend.dev>";

const escapeHtml = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const inviteEmailHtml = ({
  organizationName,
  inviterName,
  role,
  inviteUrl,
  personalMessage,
  expiresAt,
}) => {
  const org = escapeHtml(organizationName);
  const inviter = escapeHtml(inviterName);
  const safeRole = escapeHtml(role);
  const note = personalMessage
    ? `<blockquote style="margin:16px 0;padding:12px 16px;background:#f4f4f5;border-left:4px solid #6366f1;border-radius:4px;color:#3f3f46;">${escapeHtml(
        personalMessage
      )}</blockquote>`
    : "";
  const expiry = expiresAt
    ? `<p style="color:#71717a;font-size:13px;">This invitation expires on ${new Date(
        expiresAt
      ).toDateString()}.</p>`
    : "";

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#18181b;">
    <h2 style="margin:0 0 8px;">Join ${org} on TeamSpace</h2>
    <p style="margin:0 0 16px;color:#3f3f46;">
      <strong>${inviter}</strong> has invited you to join
      <strong>${org}</strong> as <strong>${safeRole}</strong>.
    </p>
    ${note}
    <a href="${inviteUrl}"
       style="display:inline-block;margin:16px 0;padding:12px 24px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
      Accept Invitation
    </a>
    <p style="color:#71717a;font-size:13px;">
      Or copy this link into your browser:<br/>
      <a href="${inviteUrl}" style="color:#6366f1;word-break:break-all;">${inviteUrl}</a>
    </p>
    ${expiry}
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;"/>
    <p style="color:#a1a1aa;font-size:12px;">
      If you weren't expecting this invitation, you can ignore this email.
    </p>
  </div>`;
};

// Sends an org invitation email. Never throws — returns { sent, reason?, id? }
// so invite creation still succeeds when email is unavailable.
const sendInviteEmail = async ({
  to,
  organizationName,
  inviterName,
  role,
  inviteUrl,
  personalMessage,
  expiresAt,
}) => {
  const resend = getResend();
  if (!resend) {
    console.warn(`📧 RESEND_API_KEY not set — invite email skipped for ${to}`);
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to,
      subject: `You're invited to join ${organizationName} on TeamSpace`,
      html: inviteEmailHtml({
        organizationName,
        inviterName,
        role,
        inviteUrl,
        personalMessage,
        expiresAt,
      }),
    });

    if (error) {
      console.error("📧 Resend error:", error);
      return { sent: false, reason: error.message || "Email send failed" };
    }

    console.log(`📧 Invite email sent to ${to} (id: ${data?.id})`);
    return { sent: true, id: data?.id };
  } catch (err) {
    console.error("📧 Email send exception:", err.message);
    return { sent: false, reason: err.message };
  }
};

// Generic important-notification email (mentions, task assignments,
// urgent announcements). Never throws — returns { sent, reason?, id? }.
const sendNotificationEmail = async ({
  to,
  subject,
  heading,
  body,
  ctaLabel = "Open TeamSpace",
  ctaUrl,
  footnote,
}) => {
  const resend = getResend();
  if (!resend) {
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }

  const url =
    ctaUrl || `${process.env.CLIENT_URL || "http://localhost:3000"}/app`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#18181b;">
    <h2 style="margin:0 0 8px;">${escapeHtml(heading)}</h2>
    <p style="margin:0 0 16px;color:#3f3f46;white-space:pre-wrap;">${escapeHtml(
      body || ""
    )}</p>
    <a href="${url}"
       style="display:inline-block;margin:12px 0;padding:12px 24px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
      ${escapeHtml(ctaLabel)}
    </a>
    ${
      footnote
        ? `<p style="color:#71717a;font-size:13px;">${escapeHtml(footnote)}</p>`
        : ""
    }
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;"/>
    <p style="color:#a1a1aa;font-size:12px;">
      You're receiving this because email notifications are enabled in your
      TeamSpace settings.
    </p>
  </div>`;

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress(),
      to,
      subject,
      html,
    });
    if (error) {
      console.error("📧 Resend error:", error);
      return { sent: false, reason: error.message || "Email send failed" };
    }
    console.log(`📧 Notification email sent to ${to} (id: ${data?.id})`);
    return { sent: true, id: data?.id };
  } catch (err) {
    console.error("📧 Email send exception:", err.message);
    return { sent: false, reason: err.message };
  }
};

// Honors the recipient's email preference. `user` needs email + notificationSettings.
const emailUserIfEnabled = async (user, args) => {
  if (!user || !user.email) return { sent: false, reason: "no email" };
  if (user.notificationSettings && user.notificationSettings.emailEnabled === false) {
    return { sent: false, reason: "user disabled email notifications" };
  }
  return sendNotificationEmail({ to: user.email, ...args });
};

module.exports = { sendInviteEmail, sendNotificationEmail, emailUserIfEnabled };
