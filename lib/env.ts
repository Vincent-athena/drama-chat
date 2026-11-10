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
export const guideFreePerDay = () => num(process.env.GUIDE_FREE_PER_DAY, 1);
export const adMinSeconds = () => num(process.env.AD_MIN_SECONDS, 15);
export const adDailyCap = () => num(process.env.AD_DAILY_CAP, 10);

/** Ad network switch. "google" needs a valid GOOGLE_AD_UNIT_PATH; anything else plays the stand-in. */
export function googleAdUnitPath(): string {
  const v = (process.env.GOOGLE_AD_UNIT_PATH ?? "").trim();
  return v.startsWith("/") && v.length <= 200 && !/\s/.test(v) ? v : "";
}
let warnedNoPath = false;
export function adProvider(): "standin" | "google" {
  if ((process.env.AD_PROVIDER ?? "").trim().toLowerCase() !== "google") return "standin";
  if (googleAdUnitPath()) return "google";
  if (!warnedNoPath) {
    warnedNoPath = true;
    console.warn("AD_PROVIDER=google but GOOGLE_AD_UNIT_PATH is missing or invalid: using the stand-in ad.");
  }
  return "standin";
}
export function googlePublisherId(): string {
  const v = (process.env.GOOGLE_PUBLISHER_ID ?? "").trim();
  return /^pub-\d{10,20}$/.test(v) ? v : "";
}
/** What to show when Google has no ad: the house ad (default) or nothing. */
export const adNoFill = (): "house" | "deny" => ((process.env.AD_NO_FILL ?? "").trim().toLowerCase() === "deny" ? "deny" : "house");
export const contactEmail = () => (process.env.CONTACT_EMAIL ?? "").trim();
export const dayTz = () => process.env.DAY_TZ || "Asia/Ho_Chi_Minh";
export const isProduction = () => process.env.NODE_ENV === "production";

/** Model providers. ByteDance (BytePlus ModelArk) counts as configured only with a key and a chat model id. */
export const arkApiKey = () => process.env.ARK_API_KEY || "";
export const arkBaseUrl = () => process.env.ARK_BASE_URL || "https://ark.ap-southeast.bytepluses.com/api/v3";
export const arkChatModel = () => process.env.ARK_CHAT_MODEL || "";
export const arkStoryModel = () => process.env.ARK_STORY_MODEL || arkChatModel();
export const arkJudgeModel = () => process.env.ARK_JUDGE_MODEL || arkChatModel();
export type ArkThinking = "disabled" | "enabled" | "auto" | "omit";
export const arkThinking = (): ArkThinking => {
  const v = (process.env.ARK_THINKING || "").trim().toLowerCase();
  return v === "enabled" || v === "auto" || v === "omit" ? v : "disabled";
};
export const arkJsonMode = (): "json_object" | "none" =>
  (process.env.ARK_JSON_MODE || "").trim().toLowerCase() === "none" ? "none" : "json_object";
export const deepseekApiKey = () => process.env.DEEPSEEK_API_KEY || "";
export const deepseekBaseUrl = () => process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
export const deepseekModel = () => process.env.DEEPSEEK_MODEL || "deepseek-chat";
export const llmPrimary = (): "bytedance" | "deepseek" =>
  (process.env.LLM_PRIMARY || "").trim().toLowerCase() === "deepseek" ? "deepseek" : "bytedance";
