export type MailResult = "sent" | "skipped" | "failed";

export async function sendInviteMail(input: {
  to: string;
  inviteUrl: string;
  mailServiceUrl?: string;
  gatewaySecret: string;
}): Promise<MailResult> {
  if (!input.mailServiceUrl) {
    return "skipped";
  }

  const base = input.mailServiceUrl.endsWith("/") ? input.mailServiceUrl : `${input.mailServiceUrl}/`;
  try {
    const response = await fetch(new URL("send", base), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-caller": "team-2-gateway",
        "x-gateway-secret": input.gatewaySecret,
      },
      body: JSON.stringify({
        to: input.to,
        subject: "Your hackathon research invite",
        text: [
          "You have been invited to the hackathon research app.",
          "",
          "Open this link to set your password:",
          input.inviteUrl,
          "",
          "The link expires in 7 days.",
        ].join("\n"),
      }),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
