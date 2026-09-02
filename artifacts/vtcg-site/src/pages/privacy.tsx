import { Link } from "wouter";
import { ArrowLeft, Database, Eye, Lock, Shield } from "lucide-react";
import { publicConfig } from "@/lib/public-config";

const sections = [
  {
    id: "information",
    title: "Information we handle",
    icon: Database,
    body: [
      "Account details you provide, such as your name, email address, username, profile information, and password-derived authentication data.",
      "Collection, wishlist, trade, scan, pricing, and preference data you choose to add to Verified TCG.",
      "Technical information needed to run and protect the service, such as app version, session information, request diagnostics, and push-notification tokens when notifications are enabled.",
    ],
  },
  {
    id: "use",
    title: "How we use information",
    icon: Eye,
    body: [
      "Provide account access and the collection, wishlist, pricing, community, trade, and support features you request.",
      "Maintain service reliability, diagnose errors, prevent abuse, and enforce account and platform safety controls.",
      "Send transactional email or enabled push notifications, such as account recovery, price alerts, or trade activity.",
    ],
  },
  {
    id: "sharing",
    title: "Service providers and sharing",
    icon: Shield,
    body: [
      "Verified TCG is hosted on Replit and uses a PostgreSQL database for account and product data. Passwords are stored as password hashes; the service uses signed sessions for authentication.",
      "We use service providers only where needed to operate features, including Expo for mobile-app services, Resend for transactional email, and pricing or verification providers such as eBay, PSA, PriceCharting, and JustTCG.",
      "Other collectors only receive profile, wishlist, collection, trade, or sale information that the account owner has made visible through the app's privacy controls. Portfolio totals are not part of the public wishlist response.",
      "We may disclose information when required by applicable law or to protect users and the service. We do not claim that every provider follows a particular certification or legal framework.",
    ],
  },
  {
    id: "storage",
    title: "Storage, security, and retention",
    icon: Lock,
    body: [
      "Data is stored in the service's Replit-hosted application and PostgreSQL environment. Data is transmitted over HTTPS when the service is accessed through its published endpoints.",
      "We use access controls, password hashing, signed sessions, and operational monitoring. No online service can guarantee absolute security.",
      "Account data is kept while needed to provide the service and meet operational or legal requirements. Account deletion removes or de-identifies data where the product supports deletion, except for limited records that must remain for security, fraud prevention, legal obligations, or an append-only audit trail.",
    ],
  },
  {
    id: "choices",
    title: "Your choices",
    icon: Eye,
    body: [
      "Use in-app privacy controls to choose whether your profile, collection, wishlist, for-trade cards, or for-sale cards are visible.",
      "Update account information, disable optional notifications, request an account export, or use the in-app account-deletion flow where available.",
      `For privacy questions or requests, email privacy@verifiedtcg.co. We may need to verify that a request comes from the account owner.`,
    ],
  },
];

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-[#FF1E2D]/30 selection:text-white">
      <LegalHeader />
      <main className="max-w-5xl mx-auto px-6 lg:px-8 py-16">
        <div className="mb-12">
          <p className="text-[#FF1E2D] text-sm uppercase tracking-[0.2em] font-semibold mb-3">Verified TCG</p>
          <h1 className="font-['Rajdhani'] text-5xl sm:text-6xl font-bold mb-4 leading-tight uppercase">Privacy Policy</h1>
          <p className="text-[#888888] text-sm uppercase tracking-widest">Effective 1 August 2026</p>
        </div>

        <div className="rounded-2xl border border-[#2A2A2A] bg-[#141414] p-6 mb-12 text-[#c8c8c8] leading-relaxed">
          This policy explains how Verified TCG handles information across the mobile app, public website, public wishlist pages, and supporting API. Public wishlist pages only display data the API confirms is public; a private or unavailable wishlist is never treated as an empty public list.
        </div>

        <nav aria-label="Privacy policy sections" className="flex flex-wrap gap-2 mb-14">
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="rounded-full border border-[#2A2A2A] px-4 py-2 text-sm text-[#b0b0b0] hover:text-white hover:border-[#555] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF1E2D]">
              {section.title}
            </a>
          ))}
        </nav>

        <article className="space-y-16">
          {sections.map((section, index) => (
            <section key={section.id} id={section.id} className="scroll-mt-28">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-[#FF1E2D]/10 flex items-center justify-center">
                  <section.icon className="w-5 h-5 text-[#FF1E2D]" aria-hidden="true" />
                </div>
                <h2 className="font-['Rajdhani'] text-3xl font-semibold uppercase">{index + 1}. {section.title}</h2>
              </div>
              <ul className="space-y-4 text-[#c8c8c8] leading-relaxed">
                {section.body.map((paragraph) => (
                  <li key={paragraph} className="rounded-xl border border-[#2A2A2A] bg-[#111] p-5">{paragraph}</li>
                ))}
              </ul>
            </section>
          ))}

          <section id="children" className="scroll-mt-28">
            <h2 className="font-['Rajdhani'] text-3xl font-semibold uppercase mb-5">6. Children and changes</h2>
            <div className="space-y-4 text-[#c8c8c8] leading-relaxed">
              <p>Verified TCG is not directed to children under 13. If you believe a child has provided personal information, contact us so we can review the account and take appropriate action.</p>
              <p>We may revise this policy as the service changes. The effective date above will be updated when a revised policy is published.</p>
            </div>
          </section>

          <section id="contact" className="scroll-mt-28 rounded-2xl border border-[#2A2A2A] bg-[#141414] p-8 text-center">
            <h2 className="font-['Rajdhani'] text-3xl font-semibold uppercase mb-3">Contact</h2>
            <p className="text-[#888] mb-6">Questions about privacy or this policy can be sent to our privacy contact.</p>
            <a href="mailto:privacy@verifiedtcg.co" className="inline-flex items-center gap-2 rounded-xl bg-white text-black px-6 py-3 font-semibold hover:bg-[#e0e0e0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF1E2D]">
              <Shield className="w-5 h-5" aria-hidden="true" /> privacy@verifiedtcg.co
            </a>
          </section>
        </article>

        <footer className="mt-20 pt-8 border-t border-[#2A2A2A] flex flex-wrap items-center justify-between gap-4 text-sm text-[#777]">
          <p>© {new Date().getFullYear()} Verified TCG.</p>
          <div className="flex gap-5">
            <Link href="/subscription-terms" className="hover:text-white">Subscription Terms</Link>
            <a href={`mailto:${publicConfig.supportEmail}`} className="hover:text-white">Support</a>
          </div>
        </footer>
      </main>
    </div>
  );
}

function LegalHeader() {
  return (
    <header className="sticky top-0 z-50 bg-[#0A0A0A]/90 backdrop-blur-md border-b border-[#2A2A2A] h-20 flex items-center">
      <div className="max-w-5xl mx-auto px-6 lg:px-8 w-full flex items-center justify-between">
        <span className="font-['Rajdhani'] font-bold text-2xl tracking-widest uppercase">Verified<span className="text-[#FF1E2D]">TCG</span></span>
        <Link href="/" className="flex items-center gap-2 text-sm font-medium text-[#888] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF1E2D] rounded">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to Home
        </Link>
      </div>
    </header>
  );
}