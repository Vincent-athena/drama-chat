import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { contactEmail } from "@/lib/env";

// OWNER: this text is a plain-language draft written from what the app does. It is not legal advice.
// Please review it (and have it checked where the law requires) before relying on it.
const UPDATED = "2026-11-11";

export const metadata: Metadata = { title: "Terms · Drama Chat" };
export const dynamic = "force-dynamic"; // the contact address comes from the environment at request time

export default function TermsPage() {
  const email = contactEmail();
  return (
    <LegalPage title="Terms" updated={UPDATED}>
      {/* OWNER: name the legal entity or person who runs Drama Chat, and the country whose law governs these terms. */}
      <p>By using Drama Chat you agree to these terms. If you do not agree, please do not use the site.</p>

      <h2>Acceptable use</h2>
      <ul>
        <li>You must be at least 13 years old.</li>
        <li>Do not break the law, attack or overload the service, or try to get around its limits.</li>
        <li>Do not use the service to harass people or to produce content that exploits children.</li>
      </ul>

      <h2>AI-generated fiction</h2>
      <p>Characters reply with text written by AI models. It is fiction: it may be inaccurate, surprising, or mature in theme. Do not rely on it as advice.</p>

      <h2>Ads and rewards</h2>
      <p>Watching ads is optional. Rewards work only inside Drama Chat, have no cash value and can change or end.</p>

      <h2>No warranty</h2>
      <p>The service is provided as is, without promises that it will always be available or error free. To the extent the law allows, we are not liable for losses from using it. Keep an exported copy of saves you care about.</p>

      <h2>Account removal</h2>
      <p>You can delete your account from your profile at any time. We may suspend or remove accounts that break these terms.</p>

      <h2>Changes</h2>
      <p>We may update these terms. The date above shows the latest version; continuing to use the site means you accept the change.</p>

      {email && (
        <p>
          Contact: <a href={`mailto:${email}`}>{email}</a>
        </p>
      )}
    </LegalPage>
  );
}
