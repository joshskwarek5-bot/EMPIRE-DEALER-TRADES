"use node";
import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { Resend } from "resend";

export const sendTradeEmail = action({
  args: {
    subject: v.string(),
    body: v.string(),
    pdfBase64: v.string(),
    filename: v.string(),
  },
  handler: async (_ctx, { subject, body, pdfBase64, filename }) => {
    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.RECIPIENT_EMAIL;
    const from = process.env.RESEND_FROM ?? "onboarding@resend.dev";

    if (!apiKey) throw new ConvexError("RESEND_API_KEY not set in Convex environment");
    if (!to)     throw new ConvexError("RECIPIENT_EMAIL not set in Convex environment");

    const resend = new Resend(apiKey);

    let result;
    try {
      result = await resend.emails.send({
        from,
        to,
        subject,
        text: body,
        attachments: [{ filename, content: Buffer.from(pdfBase64, "base64") }],
      });
    } catch (e: any) {
      throw new ConvexError(`Resend threw: ${e?.message ?? String(e)}`);
    }

    if (result.error) {
      throw new ConvexError(`Resend error: ${JSON.stringify(result.error)}`);
    }
  },
});
