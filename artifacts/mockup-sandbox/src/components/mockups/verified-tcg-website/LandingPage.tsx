import React, { useEffect, useState, useRef } from "react";
import { 
  ScanLine, 
  TrendingUp, 
  ShieldCheck, 
  LineChart, 
  Users, 
  ArrowRight, 
  Crown,
  Activity,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  Search,
  CheckCircle2,
  Zap,
  Star
} from "lucide-react";

// Hook for scroll reveals
const useReveal = () => {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        if (ref.current) observer.unobserve(ref.current);
      }
    }, { threshold: 0.15 });

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
};

const Reveal = ({ children, delay = 0, className = "", direction = "up" }: { children: React.ReactNode, delay?: number, className?: string, direction?: "up" | "left" | "right" }) => {
  const { ref, isVisible } = useReveal();
  
  const baseClasses = "transition-all duration-1000 ease-out";
  let transformClass = "";
  if (!isVisible) {
    if (direction === "up") transformClass = "translate-y-12 opacity-0";
    if (direction === "left") transformClass = "-translate-x-12 opacity-0";
    if (direction === "right") transformClass = "translate-x-12 opacity-0";
  } else {
    transformClass = "translate-y-0 translate-x-0 opacity-100";
  }

  return (
    <div ref={ref} className={`${baseClasses} ${transformClass} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
};

export const LandingPage = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 selection:text-white font-sans overflow-x-hidden">
      <style dangerouslySetInnerHTML={{__html: `
        .font-display { font-family: var(--font-display, 'Rajdhani'), sans-serif; }
        .glass-panel {
          background: rgba(20, 20, 20, 0.6);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(42, 42, 42, 0.8);
        }
        .laser-scan {
          animation: scan 2.5s ease-in-out infinite alternate;
        }
        @keyframes scan {
          0% { transform: translateY(0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(280px); opacity: 0; }
        }
        .float {
          animation: float 6s ease-in-out infinite;
        }
        @keyframes float {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-15px); }
          100% { transform: translateY(0px); }
        }
        .ticker {
          display: flex;
          animation: ticker 30s linear infinite;
        }
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .glow-text {
          text-shadow: 0 0 20px rgba(255, 30, 45, 0.5);
        }
      `}} />

      {/* Navigation */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${isScrolled ? 'glass-panel py-3' : 'bg-transparent py-5'}`}>
        <div className="container mx-auto px-6 md:px-12 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center font-display font-bold text-xl">V</div>
            <span className="font-display font-bold text-2xl tracking-wide uppercase">Verified TCG</span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium">
            <a href="#features" className="text-muted-foreground hover:text-white transition-colors">Features</a>
            <a href="#portfolio" className="text-muted-foreground hover:text-white transition-colors">Portfolio</a>
            <a href="#pro" className="text-muted-foreground hover:text-white transition-colors">Pro</a>
            <button className="bg-white text-black px-6 py-2.5 rounded-full font-bold hover:bg-gray-200 transition-colors">
              Get the App
            </button>
          </div>

          <button className="md:hidden text-white" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-md pt-24 px-6 md:hidden flex flex-col gap-6">
          <a href="#features" onClick={() => setMobileMenuOpen(false)} className="font-display text-3xl font-bold border-b border-border pb-4">Features</a>
          <a href="#portfolio" onClick={() => setMobileMenuOpen(false)} className="font-display text-3xl font-bold border-b border-border pb-4">Portfolio</a>
          <a href="#pro" onClick={() => setMobileMenuOpen(false)} className="font-display text-3xl font-bold border-b border-border pb-4">Pro Plan</a>
          <button className="bg-primary text-white py-4 rounded-lg font-bold text-lg mt-4">Download Now</button>
        </div>
      )}

      {/* Hero Section */}
      <section className="relative min-h-[100dvh] flex items-center pt-20 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img src="/attached_assets/generated_images/hero-bg.png" alt="High-end card shop" className="w-full h-full object-cover opacity-20 mix-blend-luminosity" />
          <div className="absolute inset-0 bg-gradient-to-b from-background via-background/80 to-background" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background/0 to-transparent" />
        </div>

        <div className="container mx-auto px-6 md:px-12 relative z-10 grid lg:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col items-start gap-6 pt-10 lg:pt-0">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider mb-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Live Market Data Active
            </div>
            
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold leading-[0.9] uppercase">
              The Standard <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-muted-foreground">For Serious</span><br/>
              <span className="text-primary glow-text">Collectors.</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground max-w-lg mt-2 leading-relaxed">
              Scan cards instantly. Track your real-time portfolio value in AUD. Match trades with verified collectors. Stop guessing, start knowing.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 mt-6 w-full sm:w-auto">
              <button className="bg-primary hover:bg-primary/90 text-white px-8 py-4 rounded-full font-bold text-lg flex items-center justify-center gap-2 transition-transform hover:scale-105 active:scale-95">
                Download Free <ArrowRight className="w-5 h-5" />
              </button>
              <button className="glass-panel hover:bg-white/5 text-white px-8 py-4 rounded-full font-bold text-lg flex items-center justify-center transition-colors">
                View Live Demo
              </button>
            </div>
            
            <div className="flex items-center gap-6 mt-8 opacity-60">
              <div className="flex flex-col">
                <span className="font-display font-bold text-2xl">6</span>
                <span className="text-xs uppercase tracking-widest text-muted-foreground">TCGs</span>
              </div>
              <div className="w-px h-8 bg-border"></div>
              <div className="flex flex-col">
                <span className="font-display font-bold text-2xl">2M+</span>
                <span className="text-xs uppercase tracking-widest text-muted-foreground">Cards Tracked</span>
              </div>
              <div className="w-px h-8 bg-border"></div>
              <div className="flex flex-col">
                <span className="font-display font-bold text-2xl">Live</span>
                <span className="text-xs uppercase tracking-widest text-muted-foreground">eBay Sales</span>
              </div>
            </div>
          </div>
          
          <div className="relative h-[600px] w-full hidden lg:flex justify-center items-center">
            {/* Abstract UI Mockup in 3D-ish space */}
            <div className="absolute w-[300px] h-[600px] rounded-[3rem] border-[8px] border-secondary bg-black shadow-2xl overflow-hidden float z-20 shadow-primary/20 rotate-[-5deg]">
              {/* Phone Notch */}
              <div className="absolute top-0 inset-x-0 h-7 flex justify-center">
                <div className="w-1/3 h-full bg-secondary rounded-b-2xl"></div>
              </div>
              {/* Phone Content */}
              <div className="w-full h-full bg-[#0A0A0A] text-white p-6 pt-12 flex flex-col gap-6">
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-muted-foreground text-xs font-bold uppercase tracking-wider">Portfolio Value</div>
                    <div className="font-display text-4xl font-bold">$42,850<span className="text-xl text-muted-foreground">.00</span></div>
                  </div>
                  <div className="text-green-500 font-bold text-sm bg-green-500/10 px-2 py-1 rounded flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" /> +12.4%
                  </div>
                </div>
                
                <div className="h-32 w-full mt-2 relative">
                  <svg viewBox="0 0 100 40" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                    <path d="M0,40 L10,35 L20,38 L30,20 L40,25 L50,10 L60,15 L70,5 L80,12 L90,2 L100,8" fill="none" stroke="#FF1E2D" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    <path d="M0,40 L10,35 L20,38 L30,20 L40,25 L50,10 L60,15 L70,5 L80,12 L90,2 L100,8 L100,40 L0,40 Z" fill="url(#gradient)" opacity="0.2" />
                    <defs>
                      <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#FF1E2D" />
                        <stop offset="100%" stopColor="#FF1E2D" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                
                <div className="space-y-4 mt-auto">
                  <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Recent Scans</div>
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-secondary/50 p-3 rounded-xl flex items-center gap-3">
                      <div className="w-10 h-14 bg-zinc-800 rounded flex-shrink-0 relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent"></div>
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-bold leading-tight">Charizard VMAX</div>
                        <div className="text-xs text-muted-foreground">Secret Rare</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold font-display text-lg">$245</div>
                        <div className="text-xs text-green-500">+2.1%</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Decorative Card */}
            <img 
              src="/attached_assets/generated_images/holo-card.png" 
              onError={(e) => e.currentTarget.style.display = 'none'}
              className="absolute right-0 top-1/4 w-[220px] rounded-xl shadow-2xl z-10 rotate-[15deg] opacity-80 blur-[2px] transition-all duration-500 hover:blur-none hover:opacity-100 hover:z-30 hover:rotate-12 hover:scale-110"
              alt=""
            />
          </div>
        </div>
        
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce opacity-50 hidden md:block">
          <ChevronDown className="w-8 h-8" />
        </div>
      </section>

      {/* Market Ticker */}
      <div className="w-full bg-primary text-primary-foreground py-3 overflow-hidden flex whitespace-nowrap border-y border-red-900/50">
        <div className="ticker font-display font-bold text-lg tracking-wider uppercase items-center gap-8">
          {Array(10).fill(0).map((_, i) => (
            <React.Fragment key={i}>
              <span className="flex items-center gap-2"><span className="text-black/50">One Piece</span> OP05 Manga Luffy <span className="text-green-300">▲ $4,200</span></span>
              <span>•</span>
              <span className="flex items-center gap-2"><span className="text-black/50">Pokémon</span> Base Set Charizard PSA 10 <span className="text-red-900">▼ $12,500</span></span>
              <span>•</span>
              <span className="flex items-center gap-2"><span className="text-black/50">Lorcana</span> Elsa Enchanted <span className="text-green-300">▲ $950</span></span>
              <span>•</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Instant Scanner Section */}
      <section id="features" className="py-32 relative">
        <div className="container mx-auto px-6 md:px-12">
          <Reveal>
            <div className="text-center max-w-3xl mx-auto mb-20">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-6">
                <ScanLine className="w-8 h-8" />
              </div>
              <h2 className="font-display text-4xl md:text-6xl font-bold uppercase mb-6">Identify in <span className="text-primary">Milliseconds.</span></h2>
              <p className="text-xl text-muted-foreground">
                Our machine learning vision engine recognizes set, variant, and condition instantly. Point your camera. Get live market value. It's that simple.
              </p>
            </div>
          </Reveal>

          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <Reveal direction="left">
              <div className="relative rounded-3xl overflow-hidden glass-panel aspect-square md:aspect-video lg:aspect-square flex justify-center items-center bg-black/40 border-border">
                {/* Background grid */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
                
                {/* Simulated Scanner UI */}
                <div className="relative w-64 h-80 rounded-xl overflow-hidden shadow-2xl bg-zinc-900 border border-zinc-800">
                  <img 
                    src="/attached_assets/generated_images/scanner-ui.png" 
                    onError={(e) => e.currentTarget.style.display = 'none'}
                    alt="" 
                    className="w-full h-full object-cover opacity-80" 
                  />
                  
                  {/* Scanner overlay */}
                  <div className="absolute inset-0 border-2 border-primary/50">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary"></div>
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary"></div>
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary"></div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary"></div>
                    
                    {/* Laser */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-primary shadow-[0_0_15px_#FF1E2D] laser-scan z-10"></div>
                  </div>
                  
                  {/* Result popup */}
                  <div className="absolute bottom-4 left-4 right-4 glass-panel p-3 rounded-lg flex items-center justify-between border-primary/30 backdrop-blur-md animate-in slide-in-from-bottom-4 fade-in duration-700 delay-1000 fill-mode-both">
                    <div>
                      <div className="text-xs font-bold text-primary uppercase">Identified</div>
                      <div className="text-sm font-bold truncate">Umbreon VMAX Alt Art</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Market</div>
                      <div className="font-display font-bold text-lg">$1,150</div>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>

            <div className="space-y-12">
              <Reveal delay={100}>
                <div className="flex gap-6">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-secondary flex items-center justify-center border border-border">
                    <Zap className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-display text-2xl font-bold uppercase mb-2">Lightning Fast</h3>
                    <p className="text-muted-foreground leading-relaxed">No typing names, no scrolling through sets. Just point your camera and the neural network does the rest, checking against our 2M+ card database.</p>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={200}>
                <div className="flex gap-6">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-secondary flex items-center justify-center border border-border">
                    <ShieldCheck className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-display text-2xl font-bold uppercase mb-2">Variant Detection</h3>
                    <p className="text-muted-foreground leading-relaxed">Reverse Holo? 1st Edition? Shadowless? The scanner picks up the subtle details that drastically change a card's value.</p>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={300}>
                <div className="flex gap-6">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-secondary flex items-center justify-center border border-border">
                    <Activity className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-display text-2xl font-bold uppercase mb-2">Condition Pre-check</h3>
                    <p className="text-muted-foreground leading-relaxed">Centering estimation and edge wear detection helps you estimate potential grades before you send them off.</p>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* Portfolio & Data Section */}
      <section id="portfolio" className="py-32 bg-secondary/30 border-y border-border relative overflow-hidden">
        {/* Glow effect */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="container mx-auto px-6 md:px-12 relative z-10">
          <div className="grid lg:grid-cols-12 gap-16">
            <div className="lg:col-span-5 flex flex-col justify-center">
              <Reveal>
                <h2 className="font-display text-4xl md:text-5xl font-bold uppercase mb-6 leading-tight">Your Collection.<br/>Real-Time <span className="text-primary">Wealth.</span></h2>
                <p className="text-xl text-muted-foreground mb-8">
                  Treat your collection like the alternative asset class it is. Track portfolio value in AUD, monitor daily movers, and view historical charts based on actual eBay sold listings.
                </p>
                <ul className="space-y-4">
                  {[
                    "Live AUD pricing with daily/weekly/monthly charts",
                    "PSA 10, BGS 9.5, and CGC 10 graded price distinctions",
                    "Trending cards and top market movers in real-time"
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <CheckCircle2 className="w-5 h-5 text-primary" />
                      <span className="font-medium">{item}</span>
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Stat Card 1 */}
              <Reveal delay={100} className="sm:col-span-2">
                <div className="glass-panel p-6 rounded-2xl border-t border-t-white/10 relative overflow-hidden">
                  <div className="absolute right-0 top-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl"></div>
                  <div className="flex justify-between items-start mb-8">
                    <div>
                      <h4 className="text-muted-foreground font-medium uppercase tracking-wider text-xs mb-1">Total Portfolio Value (AUD)</h4>
                      <div className="font-display text-5xl font-bold">$124,580<span className="text-2xl text-muted-foreground">.50</span></div>
                    </div>
                    <div className="bg-green-500/10 text-green-500 px-3 py-1.5 rounded-lg flex items-center gap-2 font-bold">
                      <TrendingUp className="w-4 h-4" /> +$2,450 (30d)
                    </div>
                  </div>
                  
                  {/* Abstract Graph */}
                  <div className="h-24 w-full flex items-end gap-1">
                    {[30, 45, 40, 60, 55, 70, 65, 80, 75, 90, 85, 100].map((h, i) => (
                      <div key={i} className="flex-1 bg-primary/20 rounded-t-sm hover:bg-primary transition-colors cursor-crosshair group relative" style={{ height: `${h}%` }}>
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black text-xs p-1.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10 pointer-events-none transition-opacity">
                          ${100000 + (h * 245)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>

              {/* Graded Data Card */}
              <Reveal delay={200}>
                <div className="glass-panel p-6 rounded-2xl border-t border-t-white/10 h-full">
                  <div className="flex items-center gap-3 mb-6">
                    <LineChart className="w-5 h-5 text-primary" />
                    <h4 className="font-display font-bold text-xl uppercase">Graded Premiums</h4>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="bg-zinc-800 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">PSA 10</span>
                      </div>
                      <span className="font-bold font-display text-lg">$2,400</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="bg-zinc-800 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">BGS 9.5</span>
                      </div>
                      <span className="font-bold font-display text-lg">$1,950</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="bg-zinc-800 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">Raw (NM)</span>
                      </div>
                      <span className="font-bold font-display text-lg text-muted-foreground">$450</span>
                    </div>
                  </div>
                </div>
              </Reveal>

              {/* Top Movers Card */}
              <Reveal delay={300}>
                <div className="glass-panel p-6 rounded-2xl border-t border-t-white/10 h-full">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <TrendingUp className="w-5 h-5 text-primary" />
                      <h4 className="font-display font-bold text-xl uppercase">Top Movers</h4>
                    </div>
                    <span className="text-xs text-muted-foreground">24h</span>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between items-center group cursor-pointer">
                      <div className="flex flex-col">
                        <span className="font-bold text-sm group-hover:text-primary transition-colors">Gengar VMAX Alt Art</span>
                        <span className="text-xs text-muted-foreground">Fusion Strike</span>
                      </div>
                      <span className="text-green-500 font-bold text-sm">+14.2%</span>
                    </div>
                    <div className="flex justify-between items-center group cursor-pointer">
                      <div className="flex flex-col">
                        <span className="font-bold text-sm group-hover:text-primary transition-colors">Shanks Manga</span>
                        <span className="text-xs text-muted-foreground">Romance Dawn</span>
                      </div>
                      <span className="text-green-500 font-bold text-sm">+8.7%</span>
                    </div>
                    <div className="flex justify-between items-center group cursor-pointer">
                      <div className="flex flex-col">
                        <span className="font-bold text-sm group-hover:text-primary transition-colors">The One Ring</span>
                        <span className="text-xs text-muted-foreground">MTG: LOTR</span>
                      </div>
                      <span className="text-green-500 font-bold text-sm">+5.1%</span>
                    </div>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* Trade Matching Section */}
      <section className="py-32 relative">
        <div className="container mx-auto px-6 md:px-12 text-center">
          <Reveal>
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-secondary border border-border mb-6 relative">
              <Users className="w-8 h-8 text-white" />
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full animate-pulse border-2 border-background"></div>
            </div>
            <h2 className="font-display text-4xl md:text-6xl font-bold uppercase mb-6">Match. <span className="text-primary">Negotiate.</span> Trade.</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-16">
              Our algorithm matches your wishlist against other collectors' havelists. Stop scrolling endless marketplace feeds and connect directly with verified collectors who have what you want.
            </p>
          </Reveal>

          <div className="max-w-4xl mx-auto relative">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-full bg-gradient-to-b from-transparent via-primary/50 to-transparent hidden md:block"></div>
            
            <div className="flex flex-col md:flex-row justify-between items-center gap-8 relative z-10">
              {/* User 1 */}
              <Reveal direction="right" className="w-full md:w-5/12">
                <div className="glass-panel p-6 rounded-2xl border-l-4 border-l-primary text-left bg-[#0f0f0f]">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center font-display font-bold text-xl border border-border">AL</div>
                    <div>
                      <div className="font-bold">AlexCardz</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <ShieldCheck className="w-3 h-3 text-green-500" /> Verified Collector
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs uppercase text-muted-foreground font-bold">Wants</div>
                    <div className="bg-secondary/50 p-3 rounded-lg border border-border flex items-center gap-3">
                      <div className="w-8 h-10 bg-zinc-800 rounded"></div>
                      <div className="flex-1">
                        <div className="text-sm font-bold">Moonbreon</div>
                        <div className="text-xs text-muted-foreground">PSA 10</div>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>

              {/* Match Icon */}
              <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shadow-[0_0_20px_#FF1E2D] shrink-0 z-20 md:mx-auto relative">
                <ScanLine className="w-6 h-6 text-white" />
                <div className="absolute inset-0 rounded-full border-2 border-primary animate-ping"></div>
              </div>

              {/* User 2 */}
              <Reveal direction="left" className="w-full md:w-5/12">
                <div className="glass-panel p-6 rounded-2xl border-r-4 border-r-primary text-left bg-[#0f0f0f]">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center font-display font-bold text-xl border border-border">TC</div>
                    <div>
                      <div className="font-bold">TokyoCollect</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <ShieldCheck className="w-3 h-3 text-green-500" /> Verified Collector
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs uppercase text-muted-foreground font-bold">Has</div>
                    <div className="bg-secondary/50 p-3 rounded-lg border border-border flex items-center gap-3">
                      <div className="w-8 h-10 bg-zinc-800 rounded"></div>
                      <div className="flex-1">
                        <div className="text-sm font-bold">Moonbreon</div>
                        <div className="text-xs text-muted-foreground">PSA 10</div>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            </div>
            
            <Reveal delay={200} className="mt-12">
              <button className="bg-white text-black px-8 py-3 rounded-full font-bold inline-flex items-center gap-2 hover:bg-gray-200 transition-colors">
                Find Your Match <Search className="w-4 h-4" />
              </button>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Pro Plan */}
      <section id="pro" className="py-32 bg-secondary/20 border-t border-border">
        <div className="container mx-auto px-6 md:px-12">
          <Reveal>
            <div className="text-center max-w-3xl mx-auto mb-16">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 text-yellow-500 text-xs font-bold uppercase tracking-wider mb-6">
                <Crown className="w-4 h-4" /> Go Pro
              </div>
              <h2 className="font-display text-4xl md:text-5xl font-bold uppercase mb-4">Unlimited Power.</h2>
              <p className="text-xl text-muted-foreground">For the serious collector who needs institutional-grade data.</p>
            </div>
          </Reveal>

          <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-8">
            <Reveal direction="right">
              <div className="glass-panel p-8 rounded-3xl h-full flex flex-col border-t border-t-white/5">
                <div className="mb-8">
                  <h3 className="font-display text-3xl font-bold uppercase mb-2">Basic</h3>
                  <div className="text-muted-foreground">Essential tools for casual collectors.</div>
                </div>
                <div className="text-4xl font-display font-bold mb-8">Free</div>
                
                <ul className="space-y-4 mb-8 flex-1">
                  <li className="flex items-center gap-3 text-muted-foreground"><CheckCircle2 className="w-5 h-5 text-white/20" /> 100 Scans per month</li>
                  <li className="flex items-center gap-3 text-muted-foreground"><CheckCircle2 className="w-5 h-5 text-white/20" /> Basic portfolio tracking</li>
                  <li className="flex items-center gap-3 text-muted-foreground"><CheckCircle2 className="w-5 h-5 text-white/20" /> Raw card pricing</li>
                  <li className="flex items-center gap-3 text-muted-foreground"><CheckCircle2 className="w-5 h-5 text-white/20" /> 5 Trade matches/month</li>
                </ul>
                
                <button className="w-full py-4 rounded-xl font-bold glass-panel hover:bg-white/5 transition-colors border border-border">
                  Get Started
                </button>
              </div>
            </Reveal>

            <Reveal direction="left" delay={100}>
              <div className="bg-gradient-to-b from-primary/20 to-primary/5 p-1 rounded-3xl h-full relative">
                <div className="absolute top-0 right-8 -translate-y-1/2 bg-primary text-white px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-[0_0_15px_#FF1E2D]">
                  Most Popular
                </div>
                <div className="bg-background/90 backdrop-blur-xl p-8 rounded-[1.4rem] h-full flex flex-col border border-primary/20">
                  <div className="mb-8">
                    <h3 className="font-display text-3xl font-bold uppercase mb-2 flex items-center gap-2">
                      Verified Pro <Star className="w-5 h-5 text-primary fill-primary" />
                    </h3>
                    <div className="text-muted-foreground">Everything you need to dominate the market.</div>
                  </div>
                  <div className="flex items-end gap-2 mb-8">
                    <div className="text-5xl font-display font-bold">$12.99</div>
                    <div className="text-muted-foreground mb-1">/mo</div>
                  </div>
                  
                  <ul className="space-y-4 mb-8 flex-1">
                    <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> <span className="font-bold">Unlimited</span> instant scans</li>
                    <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Graded slab pricing (PSA/BGS/CGC)</li>
                    <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Real-time eBay sold data feeds</li>
                    <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Advanced portfolio analytics</li>
                    <li className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-primary" /> Unlimited priority trade matching</li>
                  </ul>
                  
                  <button className="w-full py-4 rounded-xl font-bold bg-primary hover:bg-primary/90 text-white transition-colors shadow-[0_0_20px_rgba(255,30,45,0.3)]">
                    Start 7-Day Free Trial
                  </button>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* CTA & Footer */}
      <footer className="relative pt-32 pb-12 border-t border-border overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-primary/10 rounded-full blur-[100px] pointer-events-none -translate-y-1/2"></div>
        
        <div className="container mx-auto px-6 md:px-12 relative z-10 text-center mb-24">
          <h2 className="font-display text-5xl md:text-7xl font-bold uppercase mb-8">Stop Guessing.<br/>Start <span className="text-primary">Tracking.</span></h2>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <button className="bg-white text-black px-8 py-4 rounded-full font-bold text-lg hover:bg-gray-200 transition-colors">
              Download on iOS
            </button>
            <button className="bg-secondary text-white px-8 py-4 rounded-full font-bold text-lg border border-border hover:bg-secondary/80 transition-colors">
              Download on Android
            </button>
          </div>
        </div>

        <div className="container mx-auto px-6 md:px-12 border-t border-border/50 pt-12">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2 opacity-50">
              <div className="w-6 h-6 rounded bg-foreground flex items-center justify-center font-display font-bold text-xs text-background">V</div>
              <span className="font-display font-bold text-lg tracking-wide uppercase">Verified TCG</span>
            </div>
            
            <div className="flex gap-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
              <a href="#" className="hover:text-white transition-colors">Support</a>
            </div>
            
            <div className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Verified TCG. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;