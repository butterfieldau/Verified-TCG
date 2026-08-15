import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';

export default function SubscriptionTerms() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-[#FF1E2D]/30 selection:text-white">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-[#0A0A0A]/90 backdrop-blur-md border-b border-[#2A2A2A] h-20 flex items-center">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#141414] border border-[#2A2A2A] flex items-center justify-center">
              <div className="w-4 h-4 bg-[#FF1E2D] rounded-sm transform rotate-45" />
            </div>
            <span className="font-['Rajdhani'] font-bold text-2xl tracking-widest uppercase text-white">
              Verified<span className="text-[#FF1E2D]">TCG</span>
            </span>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-medium text-[#888888] hover:text-white transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back to Home
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[760px] mx-auto px-6 lg:px-8 py-16">

        {/* Status notice */}
        <div className="mb-10 bg-[#141414] border border-[#2A2A2A] rounded-xl p-5 flex items-start gap-4">
          <div className="mt-0.5 w-2 h-2 rounded-full bg-yellow-400 shrink-0 mt-2" />
          <p className="text-[#888888] text-sm leading-relaxed">
            <strong className="text-white">Billing not yet active.</strong>{' '}
            In-app subscription purchasing is under development. These terms describe the subscription that will apply when billing is activated. No purchases can be made at this time. This document will be updated when billing launches.
          </p>
        </div>

        <div className="mb-12">
          <h1 className="font-['Rajdhani'] text-5xl sm:text-6xl font-bold mb-4 leading-tight tracking-tight uppercase">
            Subscription Terms
          </h1>
          <p className="text-[#888888] flex items-center gap-2 text-sm uppercase tracking-widest font-['Rajdhani'] font-semibold">
            <span className="w-2 h-2 rounded-full bg-[#FF1E2D]" />
            Last updated: 14 August 2026
          </p>
        </div>

        <div className="space-y-12 text-[#e0e0e0] leading-relaxed">

          {/* 1. Service and Subscription */}
          <section>
            <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-4 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
              1. Verified TCG Pro Subscription
            </h2>
            <p className="mb-4">
              Verified TCG Pro is a recurring subscription that gives you unlimited card scanning, full price history, advanced trade matching, and all other Pro features within the Verified TCG app.
            </p>
            <p>
              When you subscribe you agree to these Subscription Terms and our{' '}
              <Link href="/privacy" className="text-[#FF1E2D] hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          {/* 2. Pricing */}
          <section>
            <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-4 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
              2. Planned Pricing
            </h2>
            <p className="mb-5 text-sm text-[#888888]">
              The following prices are planned and will apply when billing is activated. Prices are subject to change before launch.
            </p>
            <div className="space-y-4">
              <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-5">
                <p className="font-semibold text-white mb-1">Monthly Plan</p>
                <p className="text-[#888888] text-sm">$8.99 AUD per month, billed monthly.</p>
              </div>
              <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-5">
                <p className="font-semibold text-white mb-1">Annual Plan</p>
                <p className="text-[#888888] text-sm">$89.99 AUD per year (approximately $7.50/month), billed once annually. Save approximately 17% compared to monthly billing.</p>
              </div>
              <p className="text-sm text-[#888888]">
                All prices are in Australian Dollars (AUD). Prices may vary by country and are subject to change with notice prior to billing activation.
              </p>
            </div>
          </section>

          {/* 3. Auto-Renewal */}
          <section>
            <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-4 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
              3. Auto-Renewal (when billing is active)
            </h2>
            <p className="mb-4">
              Once billing is activated, subscriptions will{' '}
              <strong className="text-white">automatically renew</strong>{' '}
              at the end of each billing period (monthly or annual) unless cancelled at least 24 hours before the renewal date.
            </p>
            <p>
              Cancellation instructions and renewal management will be available through your billing provider when in-app purchases are enabled. You can also contact us at{' '}
              <a href="mailto:support@verifiedtcg.com" className="text-[#FF1E2D] hover:underline">support@verifiedtcg.com</a>{' '}
              for assistance.
            </p>
          </section>

          {/* 4. Free Trial */}
          <section>
            <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-4 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
              4. Free Trial
            </h2>
            <p className="mb-4">
              Where offered, a 7-day free trial will be available to new Pro subscribers only. No charge applies during the trial period. The subscription automatically converts to the paid plan at the end of the trial unless cancelled before the trial concludes.
            </p>
            <p>
              Only one free trial per account. Previous subscribers and accounts that have already used a trial are not eligible for another trial period.
            </p>
          </section>

          {/* 5. Cancellation */}
          <section>
            <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-4 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
              5. Cancellation
            </h2>
            <p className="mb-4">
              You may cancel your Verified TCG Pro subscription at any time. Cancellation instructions will be provided through your billing provider once in-app purchases are enabled. You can also contact us at{' '}
              <a href="mailto:support@verifiedtcg.com" className="text-[#FF1E2D] hover:underline">support@verifiedtcg.com</a>{' '}
              to request cancellation.
            </p>
            <p>
              Cancellation takes effect at the end of the current billing period. You retain access to Pro features until that date.
            </p>
          </section>

          {/* 6. Refunds */}
          <section>
            <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-4 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
              6. Refunds
            </h2>
            <p className="mb-4">
              Refund eligibility will depend on the billing platform used at the time of purchase. Details will be provided when in-app billing is activated. For questions or disputes about charges, contact us at{' '}
              <a href="mailto:support@verifiedtcg.com" className="text-[#FF1E2D] hover:underline">support@verifiedtcg.com</a>.
            </p>
          </section>

          {/* 7. Changes */}
          <section>
            <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-4 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
              7. Changes to Subscription Terms or Pricing
            </h2>
            <p className="mb-4">
              We may update these Subscription Terms or change subscription prices. We will notify you of any material changes at least 30 days in advance via email or in-app notice. Continued use of Verified TCG Pro after the effective date of a price change constitutes your agreement to the new price.
            </p>
          </section>

          {/* 8. Contact */}
          <section>
            <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-4 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
              8. Contact
            </h2>
            <p>
              Questions about your subscription? Contact us at{' '}
              <a href="mailto:support@verifiedtcg.com" className="text-[#FF1E2D] hover:underline">
                support@verifiedtcg.com
              </a>{' '}
              or through the Help section in the Verified TCG app.
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-[#2A2A2A] text-center">
          <p className="text-[#666] text-sm">
            © {new Date().getFullYear()} Verified TCG. All rights reserved.
          </p>
          <div className="flex items-center justify-center gap-6 mt-3">
            <Link href="/privacy" className="text-[#888] text-sm hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link href="/" className="text-[#888] text-sm hover:text-white transition-colors">
              Home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
