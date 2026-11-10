import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { contactEmail } from "@/lib/env";

// OWNER: this text is a plain-language draft written from what the app does. It is not legal advice.
// Please review it (and have it checked where the law requires) before relying on it.
const UPDATED = "2026-11-11";

export const metadata: Metadata = { title: "Privacy · Drama Chat" };
export const dynamic = "force-dynamic"; // the contact address comes from the environment at request time

export default function PrivacyPage() {
  const email = contactEmail();
  return (
    <LegalPage title="Privacy" updated={UPDATED}>
      {/* OWNER: name the legal entity or person who runs Drama Chat, and the country whose law applies. */}
      <p>This page explains what Drama Chat keeps about you and who it is shared with. Drama Chat is not directed at children under 13, and we do not knowingly collect data from them.</p>

      <h2>What we keep on our server</h2>
      <ul>
        <li>Your email address, display name and avatar emoji.</li>
        <li>Your sign-in sessions, with the browser user agent, so you can see and end them on your profile.</li>
        <li>One-time login codes, stored hashed and short-lived.</li>
        <li>Records of rewarded ads you started or watched, and the story items those ads unlocked.</li>
        <li>Daily usage counters, which enforce limits on messages, guides and ads.</li>
        <li>Your IP address and email address in sign-in rate-limit counters, kept for up to an hour, including when a sign-in is not completed.</li>
      </ul>

      <h2>What stays in your browser</h2>
      <p>Your chats, story progress and found items are stored in your own browser (IndexedDB), not on our server. Clearing your browser storage removes them. You can export a save file from your profile and import it on another device.</p>

      <h2>AI replies</h2>
      <p>When you send a message, the message and recent context are sent to our server and passed to AI model providers (ByteDance BytePlus ModelArk and DeepSeek) so they can write the reply. Our server does not store the chat text.</p>

      <h2>Services we use</h2>
      <ul>
        <li>Resend delivers login emails.</li>
        <li>The site is served through Cloudflare and hosted on the owner&apos;s own server.</li>
      </ul>

      <h2>Cookies</h2>
      <p>We set one essential cookie, <code>dc_session</code>, to keep you signed in. If ads are shown, Google may also set cookies or use identifiers to serve and measure ads. See{" "}
        <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">How Google uses information from sites or apps that use our services</a>, and manage your choices in{" "}
        <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">Ads Settings</a>.
      </p>

      <h2>Rewarded ads</h2>
      <p>Watching an ad is always optional. Rewards work only inside Drama Chat and have no cash value.</p>

      <h2>Deleting your data</h2>
      <p>On your profile, choose Delete my account to remove your account and everything tied to it: your sign-in sessions, ad records and unlocked items. Short-lived usage and rate-limit counters are not deleted at once; they expire on their own within a day. Clear your browser storage to remove local saves.</p>

      {/* OWNER: set CONTACT_EMAIL to show a contact section here. Unset, the section is left out. */}
      {email && (
        <>
          <h2>Contact</h2>
          <p>
            Questions: <a href={`mailto:${email}`}>{email}</a>
          </p>
        </>
      )}
    </LegalPage>
  );
}
