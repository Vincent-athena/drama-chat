import { isProduction, mailFrom, resendApiKey } from "./env";

/**
 * Sends the sign-in code. With RESEND_API_KEY it uses Resend over fetch. Without a key it prints the
 * code to the server log outside production, and refuses in production (the code is never logged there).
 */
export async function sendLoginCode(email: string, code: string): Promise<"sent" | "logged" | "unavailable"> {
  const key = resendApiKey();
  if (!key) {
    if (isProduction()) return "unavailable";
    console.log(`[dev mail] code for ${email}: ${code}`);
    return "logged";
  }
  const text = `Your Drama Chat code is ${code}. It works for 10 minutes. If you did not ask for it, ignore this email.`;
  const html = `<p>Your Drama Chat code is</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${code}</p><p>It works for 10 minutes. If you did not ask for it, ignore this email.</p>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: mailFrom(), to: [email], subject: "Your Drama Chat code", text, html }),
    });
    if (!res.ok) {
      console.error(`mail provider answered ${res.status}`);
      return "unavailable";
    }
    return "sent";
  } catch (err) {
    console.error("mail send failed", err instanceof Error ? err.message : err);
    return "unavailable";
  }
}
