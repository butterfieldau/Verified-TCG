import { Link } from "wouter";
import { ArrowLeft, Clock } from "lucide-react";
import { publicConfig } from "@/lib/public-config";

export default function SubscriptionTerms() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-[#FF1E2D]/30 selection:text-white">
      <header className="sticky top-0 z-50 bg-[#0A0A0A]/90 backdrop-blur-md border-b border-[#2A2A2A] h-20 flex items-center">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 w-full flex items-center justify-between">
          <span className="font-['Rajdhani'] font-bold text-2xl tracking-widest uppercase">Verified<span className="text-[#FF1E2D]">TCG</span></span>
          <Link href="/" className="flex items-center gap-2 text-sm font-medium text-[#888] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF1E2D] rounded">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to Home
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 lg:px-8 py-16">
        <div className="mb-10 bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-5 flex items-start gap-4" role="status">
          <Clock className="w-5 h-5 text-yellow-300 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[#d0d0d0] text-sm leading-relaxed">
            <strong className="text-white">Subscriptions cannot currently be purchased.</strong>{" "}
            Apple, Google, and other billing flows are not active. Verified TCG has not published a price, renewal schedule, refund process, or free-trial offer.
          </p>
        </div>

        <div className="mb-12">
          <h1 className="font-['Rajdhani'] text-5xl sm:text-6xl font-bold mb-4 leading-tight uppercase">Subscription Terms</h1>
          <p className="text-[#888] text-sm uppercase tracking-widest">Effective 14 August 2026</p>
        </div>

        <div className="space-y-12 text-[#d0d0d0] leading-relaxed">
          <Section title="1. Current availability">
            <p>Verified TCG currently provides product screens that describe a possible Pro tier, but those screens do not create a paid subscription and do not charge a payment method.</p>
            <p>Any account tier currently shown in the app is a product access state, not proof that a paid purchase was processed.</p>
          </Section>

          <Section title="2. No current price or trial">
            <p>No public subscription price or trial has been approved for purchase. Figures shown in older previews or examples are not an offer and do not create a right to purchase at that amount.</p>
          </Section>

          <Section title="3. Future billing terms">
            <p>Before paid subscriptions launch, Verified TCG will publish updated terms describing the available plans, price and currency, billing provider, renewal behavior, cancellation steps, refund handling, and any trial eligibility.</p>
            <p>You will be able to review those terms before completing a purchase. We will not apply the inactive billing descriptions on this page as if a purchase had occurred.</p>
          </Section>

          <Section title="4. Existing app access">
            <p>Free features and any access granted directly by Verified TCG remain governed by the app's product rules and account status. Access may change as features are tested or released, but no recurring charge can begin through the current inactive purchase flow.</p>
          </Section>

          <Section title="5. Privacy and support">
            <p>
              Information handling is described in the{" "}
              <Link href="/privacy" className="text-[#FF1E2D] hover:underline">Privacy Policy</Link>.
              Questions about subscription availability can be sent to{" "}
              <a href={`mailto:${publicConfig.supportEmail}`} className="text-[#FF1E2D] hover:underline">{publicConfig.supportEmail}</a>.
            </p>
          </Section>
        </div>

        <footer className="mt-16 pt-8 border-t border-[#2A2A2A] flex items-center justify-between gap-4 text-sm text-[#777]">
          <p>© {new Date().getFullYear()} Verified TCG.</p>
          <Link href="/privacy" className="hover:text-white">Privacy Policy</Link>
        </footer>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-4 text-white pb-2 border-b border-[#2A2A2A] uppercase">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}