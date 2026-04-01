"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
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

    if (!apiKey) throw new Error("RESEND_API_KEY not set in Convex environment");
    if (!to)     throw new Error("RECIPIENT_EMAIL not set in Convex environment");

    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from,
      to,
      subject,
      text: body,
      attachments: [{ filename, content: pdfBase64 }],
    });

    if (error) throw new Error(error.message);
  },
});
