import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL

export async function sendClaimInviteEmail({
  to,
  name,
  token,
  entityName,
}: {
  to: string
  name: string
  token: string
  entityName: string
}) {
  const claimUrl = `${BASE_URL}/claim/${token}`

  await resend.emails.send({
    from: 'Aletia Index <noreply@aletia-index.com>',
    to,
    replyTo: 'info@aletia-index.com',
    subject: `Your listing on Aletia Index — ${entityName}`,
    html: `
      <p>Hi ${name},</p>
      <p><strong>${entityName}</strong> is listed on the Aletia Index,
      the regulatory reference standard for AI/ML medical devices across
      FDA, MHRA, and CE Mark jurisdictions.</p>
      <p>Claiming your listing gives you control over what clinicians
      and investors see. It takes 5 minutes.</p>
      <p><a href="${claimUrl}">Claim your listing →</a></p>
      <p>This link expires in 72 hours.</p>
    `,
  })
}

export async function sendClaimRequestConfirmationEmail({
  to,
  name,
  token,
}: {
  to: string
  name: string
  token: string
}) {
  const claimUrl = `${BASE_URL}/claim/${token}`

  await resend.emails.send({
    from: 'Aletia Index <noreply@aletia-index.com>',
    to,
    replyTo: 'info@aletia-index.com',
    subject: 'Confirm your claim — Aletia Index',
    html: `
      <p>Hi ${name},</p>
      <p>Click below to claim your listing on Aletia Index.</p>
      <p><a href="${claimUrl}">Claim your listing →</a></p>
      <p>This link expires in 72 hours. If you did not request this, ignore this email.</p>
    `,
  })
}