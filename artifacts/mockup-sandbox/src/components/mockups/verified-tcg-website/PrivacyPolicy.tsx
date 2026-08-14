import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Shield, Database, Lock, Eye, CheckCircle2 } from 'lucide-react';

export default function PrivacyPolicy() {
  const [activeSection, setActiveSection] = useState('introduction');

  const sections = [
    { id: 'introduction', title: 'Introduction', icon: Shield },
    { id: 'information-we-collect', title: 'Information We Collect', icon: Database },
    { id: 'how-we-use', title: 'How We Use Your Information', icon: Eye },
    { id: 'data-sharing', title: 'Data Sharing', icon: Shield },
    { id: 'data-storage', title: 'Data Storage and Security', icon: Lock },
    { id: 'data-retention', title: 'Data Retention', icon: Database },
    { id: 'your-rights', title: 'Your Rights', icon: CheckCircle2 },
    { id: 'childrens-privacy', title: "Children's Privacy" },
    { id: 'third-party', title: 'Third-Party Links' },
    { id: 'changes', title: 'Changes to This Policy' },
    { id: 'contact', title: 'Contact Us' },
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );

    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [sections]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const headerOffset = 100;
      const elementPosition = el.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - headerOffset;
      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth',
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-[#FF1E2D]/30 selection:text-white">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-[#0A0A0A]/90 backdrop-blur-md border-b border-[#2A2A2A] h-20 flex items-center transition-all duration-300">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#141414] border border-[#2A2A2A] flex items-center justify-center">
              <div className="w-4 h-4 bg-[#FF1E2D] rounded-sm transform rotate-45"></div>
            </div>
            <span className="font-['Rajdhani'] font-bold text-2xl tracking-widest uppercase text-white">
              Verified<span className="text-[#FF1E2D]">TCG</span>
            </span>
          </div>
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="flex items-center gap-2 text-sm font-medium text-[#888888] hover:text-white transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back to Home
          </a>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-16 flex flex-col lg:flex-row gap-16 items-start">
        {/* Sidebar TOC - Desktop only */}
        <aside className="hidden lg:block w-72 shrink-0 sticky top-32">
          <h4 className="font-['Rajdhani'] text-xs font-bold tracking-[0.2em] text-[#888888] uppercase mb-6 pl-3">
            Contents
          </h4>
          <nav className="flex flex-col gap-1 relative border-l border-[#2A2A2A]">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => scrollTo(section.id)}
                className={`
                  text-left px-4 py-2.5 text-sm transition-all relative flex items-center justify-between group rounded-r-lg
                  ${
                    activeSection === section.id
                      ? 'text-white font-medium bg-[#141414]'
                      : 'text-[#888888] hover:text-[#e0e0e0] hover:bg-[#141414]/50'
                  }
                `}
              >
                {activeSection === section.id && (
                  <span className="absolute left-[-1px] top-0 bottom-0 w-[2px] bg-[#FF1E2D]" />
                )}
                <span className="truncate">{section.title}</span>
                <ChevronRight 
                  className={`w-4 h-4 transition-transform ${
                    activeSection === section.id 
                      ? 'opacity-100 translate-x-0 text-[#FF1E2D]' 
                      : 'opacity-0 -translate-x-2 group-hover:opacity-50'
                  }`} 
                />
              </button>
            ))}
          </nav>
        </aside>

        {/* Content Area */}
        <article className="max-w-[760px] w-full mx-auto lg:mx-0">
          <div className="mb-16">
            <h1 className="font-['Rajdhani'] text-5xl sm:text-6xl font-bold mb-4 leading-tight tracking-tight uppercase">
              Privacy Policy
            </h1>
            <p className="text-[#888888] flex items-center gap-2 text-sm uppercase tracking-widest font-['Rajdhani'] font-semibold">
              <span className="w-2 h-2 rounded-full bg-[#FF1E2D]"></span>
              Last updated: 1 August 2026
            </p>
          </div>

          <div className="space-y-20 text-[#e0e0e0] leading-relaxed">
            {/* 1. Introduction */}
            <section id="introduction" className="scroll-mt-32">
              <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-6 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
                1. Introduction
              </h2>
              <p className="text-lg">
                Welcome to <strong className="text-white">Verified TCG</strong>. We are a premium mobile trading card game (TCG) tracking application based in Australia. 
                We value your privacy and are committed to protecting your personal data. This Privacy Policy explains how we collect, 
                use, and share your information when you use our mobile application and related services.
              </p>
            </section>

            {/* 2. Information We Collect */}
            <section id="information-we-collect" className="scroll-mt-32">
              <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-6 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
                2. Information We Collect
              </h2>
              <div className="space-y-6">
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-6 transition-colors hover:border-[#3A3A3A]">
                  <h3 className="text-white font-semibold mb-2 flex items-center gap-2 text-lg">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#FF1E2D]" /> Account Information
                  </h3>
                  <p className="text-[#888888] ml-3.5">We collect your name, email address, username, and profile avatar during account registration.</p>
                </div>
                
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-6 transition-colors hover:border-[#3A3A3A]">
                  <h3 className="text-white font-semibold mb-2 flex items-center gap-2 text-lg">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#FF1E2D]" /> Collection Data
                  </h3>
                  <p className="text-[#888888] ml-3.5">Information regarding the cards added to your portfolio, your scan history, and portfolio valuations over time.</p>
                </div>
                
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-6 transition-colors hover:border-[#3A3A3A]">
                  <h3 className="text-white font-semibold mb-2 flex items-center gap-2 text-lg">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#FF1E2D]" /> Device Information
                  </h3>
                  <p className="text-[#888888] ml-3.5">We automatically collect device specifics such as device type, operating system version, and push notification tokens.</p>
                </div>
                
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-6 transition-colors hover:border-[#3A3A3A]">
                  <h3 className="text-white font-semibold mb-2 flex items-center gap-2 text-lg">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#FF1E2D]" /> Usage Analytics
                  </h3>
                  <p className="text-[#888888] ml-3.5">Data regarding the screens you visit, features utilised, and general app performance metrics to help us improve.</p>
                </div>

                <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl p-6 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#FF1E2D]/5 rounded-full blur-3xl group-hover:bg-[#FF1E2D]/10 transition-colors" />
                  <h3 className="text-white font-semibold mb-4 text-lg relative">Third-Party Data</h3>
                  <ul className="space-y-4 text-[#888888] relative">
                    <li className="flex items-start gap-3">
                      <div className="mt-1.5 w-1 h-1 rounded-full bg-[#555] shrink-0" />
                      <span><strong className="text-[#e0e0e0]">eBay:</strong> Sold listing prices via the eBay Developer API. We do not store or link your personal eBay account data.</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="mt-1.5 w-1 h-1 rounded-full bg-[#555] shrink-0" />
                      <span><strong className="text-[#e0e0e0]">PSA:</strong> Certification data via the PSA API. Only certification numbers and grading results are retrieved.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            {/* 3. How We Use Your Information */}
            <section id="how-we-use" className="scroll-mt-32">
              <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-6 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
                3. How We Use Your Information
              </h2>
              <ul className="grid gap-4">
                {[
                  'Providing and maintaining the core app functionality.',
                  'Delivering personalised market insights and portfolio valuations.',
                  'Facilitating our Smart Trade matching system.',
                  'Sending push notifications for custom price alerts and new trade offers.',
                  'Analysing aggregate usage to improve application performance and user experience.'
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-4 bg-[#141414] p-5 rounded-xl border border-[#2A2A2A] transition-colors hover:border-[#3A3A3A]">
                    <div className="bg-[#FF1E2D]/10 p-1.5 rounded-lg shrink-0">
                      <CheckCircle2 className="w-5 h-5 text-[#FF1E2D]" />
                    </div>
                    <span className="mt-1 text-[#e0e0e0]">{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* 4. Data Sharing */}
            <section id="data-sharing" className="scroll-mt-32">
              <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-6 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
                4. Data Sharing
              </h2>
              <p className="mb-6 text-lg text-[#e0e0e0]">
                We do not sell your personal data to any third parties. We share information only in limited circumstances with trusted service providers:
              </p>
              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-5 hover:bg-[#1A1A1A] transition-colors">
                  <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#888888]" /> Supabase
                  </h4>
                  <p className="text-sm text-[#888888] leading-relaxed">For secure database and authentication hosting.</p>
                </div>
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-5 hover:bg-[#1A1A1A] transition-colors">
                  <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#888888]" /> Expo
                  </h4>
                  <p className="text-sm text-[#888888] leading-relaxed">For delivering timely push notifications to your device.</p>
                </div>
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-5 hover:bg-[#1A1A1A] transition-colors">
                  <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                    <Eye className="w-4 h-4 text-[#888888]" /> eBay
                  </h4>
                  <p className="text-sm text-[#888888] leading-relaxed">Through their read-only Finding API for market data (we never write to eBay on your behalf).</p>
                </div>
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-5 hover:bg-[#1A1A1A] transition-colors">
                  <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#888888]" /> PSA
                  </h4>
                  <p className="text-sm text-[#888888] leading-relaxed">For verifying card certifications and grading lookups.</p>
                </div>
              </div>
              <div className="p-4 bg-[#141414] rounded-lg border-l-2 border-[#FF1E2D] flex items-start gap-3">
                <Shield className="w-5 h-5 text-[#FF1E2D] shrink-0 mt-0.5" />
                <p className="text-sm text-[#888888] leading-relaxed">
                  All third-party processors we use are GDPR-compliant or maintain equivalent strict data protection standards.
                </p>
              </div>
            </section>

            {/* 5. Data Storage and Security */}
            <section id="data-storage" className="scroll-mt-32">
              <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-6 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
                5. Data Storage and Security
              </h2>
              <ul className="space-y-4">
                <li className="flex gap-4 p-4 rounded-xl hover:bg-[#141414] transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#FF1E2D] mt-2.5 shrink-0" />
                  <p className="leading-relaxed">Your data is hosted securely on <strong className="text-white">Supabase</strong>, utilizing the AWS ap-southeast-2 (Sydney) region.</p>
                </li>
                <li className="flex gap-4 p-4 rounded-xl hover:bg-[#141414] transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#FF1E2D] mt-2.5 shrink-0" />
                  <p className="leading-relaxed">All personal data is encrypted both at rest and in transit.</p>
                </li>
                <li className="flex gap-4 p-4 rounded-xl hover:bg-[#141414] transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#FF1E2D] mt-2.5 shrink-0" />
                  <p className="leading-relaxed">Active session tokens are stored securely on your device utilizing native keystore solutions.</p>
                </li>
              </ul>
            </section>

            {/* 6. Data Retention */}
            <section id="data-retention" className="scroll-mt-32">
              <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-6 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
                6. Data Retention
              </h2>
              <div className="bg-[#141414] border border-[#2A2A2A] rounded-xl overflow-hidden divide-y divide-[#2A2A2A]">
                <div className="p-6">
                  <h3 className="text-white font-semibold mb-2 text-lg">Active Accounts</h3>
                  <p className="text-[#888888] leading-relaxed">Active account data is retained for as long as your account exists to provide you with seamless service.</p>
                </div>
                <div className="p-6">
                  <h3 className="text-white font-semibold mb-2 text-lg">Deleted Accounts</h3>
                  <p className="text-[#888888] leading-relaxed">If you choose to delete your account, your personal data will be completely purged from our active databases within 30 days.</p>
                </div>
                <div className="p-6">
                  <h3 className="text-white font-semibold mb-2 text-lg">Analytics</h3>
                  <p className="text-[#888888] leading-relaxed">Anonymised usage analytics may be retained indefinitely to help us improve the platform.</p>
                </div>
              </div>
            </section>

            {/* 7. Your Rights */}
            <section id="your-rights" className="scroll-mt-32">
              <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-6 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
                7. Your Rights
              </h2>
              <p className="mb-6 text-lg">You have several rights regarding your personal data:</p>
              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-4 bg-[#141414] p-4 rounded-xl border border-[#2A2A2A]">
                  <div className="bg-[#2A2A2A] p-1.5 rounded-lg shrink-0 mt-0.5">
                    <Lock className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-[#e0e0e0]">Access, correct, or request the deletion of your personal data.</span>
                </li>
                <li className="flex items-start gap-4 bg-[#141414] p-4 rounded-xl border border-[#2A2A2A]">
                  <div className="bg-[#2A2A2A] p-1.5 rounded-lg shrink-0 mt-0.5">
                    <Database className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-[#e0e0e0]">Request a copy of your data for portability purposes.</span>
                </li>
                <li className="flex items-start gap-4 bg-[#141414] p-4 rounded-xl border border-[#2A2A2A]">
                  <div className="bg-[#2A2A2A] p-1.5 rounded-lg shrink-0 mt-0.5">
                    <Shield className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-[#e0e0e0]">Opt out of any non-essential marketing communications at any time.</span>
                </li>
              </ul>
              <p className="text-[#888888] bg-[#1A1A1A] p-5 rounded-xl border border-[#2A2A2A] flex gap-3">
                <span className="text-[#FF1E2D] font-bold">Note:</span> 
                <span>To exercise any of these rights, please contact us. We aim to respond to all requests within 30 days.</span>
              </p>
            </section>

            {/* 8. Children's Privacy */}
            <section id="childrens-privacy" className="scroll-mt-32">
              <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-6 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
                8. Children's Privacy
              </h2>
              <div className="space-y-4">
                <p className="leading-relaxed">
                  Verified TCG is not directed at children under the age of 13.
                </p>
                <p className="text-[#888888] leading-relaxed">
                  We do not knowingly collect personal data from individuals under 13 years of age. If we become aware that we have inadvertently collected such data, we will take immediate steps to delete it.
                </p>
              </div>
            </section>

            {/* 9. Third-Party Links */}
            <section id="third-party" className="scroll-mt-32">
              <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-6 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
                9. Third-Party Links
              </h2>
              <p className="leading-relaxed">
                Our app may contain links to external platforms such as eBay, PSA, TCGPlayer, and others. We are not responsible for the privacy practices, content, or security of these third-party websites.
              </p>
            </section>

            {/* 10. Changes to This Policy */}
            <section id="changes" className="scroll-mt-32">
              <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-6 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
                10. Changes to This Policy
              </h2>
              <p className="leading-relaxed">
                We may update this Privacy Policy from time to time. If we make material changes, we will notify you directly via an in-app notification before the changes take effect.
              </p>
            </section>

            {/* 11. Contact Us */}
            <section id="contact" className="scroll-mt-32">
              <h2 className="font-['Rajdhani'] text-3xl font-semibold mb-6 text-white pb-2 border-b border-[#2A2A2A] uppercase tracking-wide">
                11. Contact Us
              </h2>
              <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-8 sm:p-12 text-center relative overflow-hidden group">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200%] h-[200%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#FF1E2D]/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none" />
                <h3 className="font-['Rajdhani'] text-2xl font-semibold text-white mb-4 uppercase">Have Questions?</h3>
                <p className="mb-8 text-[#888888] max-w-md mx-auto">
                  If you have any questions or concerns regarding this Privacy Policy, please reach out to our privacy team.
                </p>
                <a 
                  href="mailto:privacy@verifiedtcg.co" 
                  className="inline-flex items-center gap-3 bg-white text-black font-semibold px-8 py-4 rounded-xl hover:bg-[#e0e0e0] transition-colors hover:scale-[1.02] active:scale-95 uppercase tracking-wide font-['Rajdhani']"
                >
                  <Shield className="w-5 h-5" />
                  privacy@verifiedtcg.co
                </a>
              </div>
            </section>
          </div>
          
          <footer className="mt-32 mb-16 pt-8 border-t border-[#2A2A2A] flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[#555]">
            <p>&copy; {new Date().getFullYear()} Verified TCG. All rights reserved.</p>
            <div className="flex gap-4">
              <a href="#" className="hover:text-[#888888] transition-colors">Terms of Service</a>
              <a href="#" className="hover:text-[#888888] transition-colors">Cookie Policy</a>
            </div>
          </footer>
        </article>
      </main>
    </div>
  );
}
