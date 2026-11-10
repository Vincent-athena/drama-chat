/** Typed access to environment variables. Everything is read lazily so tests can set env first. */
import path from "node:path";

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};

export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET is missing or shorter than 32 characters. Run `npm run setup` to generate one.");
  }
  return s;
}

export const dataDir = () => process.env.DATA_DIR || path.join(process.cwd(), "data");
export const adminEmails = () =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
export const appOrigin = () => process.env.APP_ORIGIN || "";
export const resendApiKey = () => process.env.RESEND_API_KEY || "";
export const mailFrom = () => process.env.MAIL_FROM || "Drama Chat <login@example.com>";
export const dailyMessageCap = () => num(process.env.DAILY_MESSAGE_CAP, 200);
export const dayTz = () => process.env.DAY_TZ || "Asia/Ho_Chi_Minh";
export const isProduction = () => process.env.NODE_ENV === "production";
