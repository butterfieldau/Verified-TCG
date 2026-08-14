import { useState } from 'react';
import {
  LayoutDashboard, Layers, TrendingUp, User, Search, Bell,
  Plus, CheckCircle, Filter, ChevronDown, ArrowUpRight, ArrowDownRight,
  Trophy, ScanLine, CreditCard, Check, Settings,
} from 'lucide-react';

const MOCK_CARDS = [
  { id: 1, name: "Umbreon ex", set: "Prismatic Evolutions", tcg: "Pokémon", price: 1240, change: 8.4, grade: "PSA 10", color: "from-purple-900 to-indigo-900" },
  { id: 2, name: "Charizard ex SIR", set: "Obsidian Flames", tcg: "Pokémon", price: 890, change: -2.1, grade: "Raw", color: "from-orange-900 to-red-900" },
  { id: 3, name: "Luffy OP-01", set: "Romance Dawn", tcg: "One Piece", price: 340, change: 12.5, grade: "BGS 9.5", color: "from-red-900 to-amber-900" },
  { id: 4, name: "Black Lotus", set: "Alpha", tcg: "MTG", price: 42000, change: 0.5, grade: "PSA 8", color: "from-zinc-900 to-black" },
  { id: 5, name: "Floral Dragonmaiden", set: "The First Chapter", tcg: "Lorcana", price: 180, change: 4.2, grade: "Raw", color: "from-pink-900 to-rose-900" },
  { id: 6, name: "Gengar VMAX", set: "Fusion Strike", tcg: "Pokémon", price: 410, change: -1.5, grade: "Raw", color: "from-fuchsia-900 to-purple-900" },
  { id: 7, name: "Shanks Manga", set: "Romance Dawn", tcg: "One Piece", price: 1850, change: 2.8, grade: "PSA 10", color: "from-red-950 to-red-900" },
  { id: 8, name: "Mox Sapphire", set: "Unlimited", tcg: "MTG", price: 3200, change: 1.1, grade: "BGS 8", color: "from-blue-900 to-cyan-900" },
];

const MOCK_MOVERS = [
  { id: 1, name: "Lillie (Full Art)", set: "Ultra Prism", price: 540, change: 24.5 },
  { id: 2, name: "Rayquaza VMAX", set: "Evolving Skies", price: 380, change: 18.2 },
  { id: 3, name: "Nami (Parallel)", set: "Romance Dawn", price: 290, change: 15.4 },
  { id: 4, name: "Mewtwo Star", set: "Holon Phantoms", price: 1200, change: -12.5 },
  { id: 5, name: "Blue-Eyes White Dragon", set: "LOB", price: 850, change: -8.4 },
];

const MOCK_TRENDING = [
  { id: 1, name: "Pikachu Illustrator", set: "CoroCoro", price: 4500000, change: 0.1 },
  { id: 2, name: "The One Ring", set: "LOTR Tales of Middle-earth", price: 2100, change: 45.2 },
  { id: 3, name: "Charizard", set: "Base Set", price: 15000, change: 5.5 },
  { id: 4, name: "Goku (Secret Rare)", set: "Tournament Pack", price: 850, change: 12.0 },
];

const Sparkline = ({ data, color, height = 40 }: { data: number[], color: string, height?: number }) => {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 100;
  const step = width / (data.length - 1);
  const points = data.map((d, i) => `${i * step},${height - ((d - min) / range) * height}`).join(' ');
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const PortfolioChart = () => {
  const data = [21000, 21500, 21200, 22000, 22800, 23500, 23100, 24000, 24850];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const width = 800;
  const height = 160;
  const step = width / (data.length - 1);

  const d = data.map((val, i) => {
    const x = i * step;
    const y = height - ((val - min) / range) * height;
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  const fillD = `${d} L ${width} ${height} L 0 ${height} Z`;

  return (
    <div className="w-full h-40 mt-10 mb-2 relative">
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
        <defs>
          <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--positive))" stopOpacity="0.2" />
            <stop offset="100%" stopColor="hsl(var(--positive))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillD} fill="url(#chart-gradient)" />
        <path d={d} fill="none" stroke="hsl(var(--positive))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

const DashboardView = () => {
  const [range, setRange] = useState('1M');
  return (
    <div className="animate-in fade-in duration-300">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-muted-foreground text-sm font-medium tracking-wider mb-2">PORTFOLIO VALUE</h2>
          <div className="flex items-baseline gap-4">
            <h1 className="font-display text-6xl font-bold text-foreground tracking-tight">$24,850<span className="text-3xl text-muted-foreground">.00</span></h1>
            <div className="flex items-center text-positive bg-positive/10 px-3 py-1 rounded-full text-sm font-bold">
              <TrendingUp size={16} className="mr-1.5" />
              +$1,240 (+5.2%) today
            </div>
          </div>
        </div>
        <div className="flex bg-card border border-border rounded-lg p-1">
          {['1D', '7D', '1M', '3M', '1Y', 'ALL'].map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${range === r ? 'bg-border text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <PortfolioChart />

      <div className="grid grid-cols-4 gap-4 mt-8">
        {[
          { icon: ScanLine, label: "Scan Card", desc: "AI grade & ID" },
          { icon: Plus, label: "Add Card", desc: "Manual entry" },
          { icon: Search, label: "Check Price", desc: "Live market data" },
          { icon: CheckCircle, label: "Verify", desc: "Auth services" },
        ].map((action, i) => (
          <button key={i} className="flex items-center p-4 bg-card hover:bg-card-alt border border-border rounded-xl transition-colors group text-left cursor-pointer">
            <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mr-4 group-hover:scale-110 transition-transform shadow-[0_0_15px_rgba(255,30,45,0.1)] group-hover:shadow-[0_0_20px_rgba(255,30,45,0.3)]">
              <action.icon size={22} />
            </div>
            <div>
              <div className="font-bold text-foreground">{action.label}</div>
              <div className="text-xs text-muted-foreground">{action.desc}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6 mt-6">
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-5 border-b border-border flex justify-between items-center">
            <h3 className="font-display text-xl font-bold">MARKET MOVERS</h3>
            <button className="text-xs text-primary font-bold hover:underline">VIEW ALL</button>
          </div>
          <div className="divide-y divide-border">
            {MOCK_MOVERS.map(mover => (
              <div key={mover.id} className="flex items-center justify-between p-4 hover:bg-card-alt transition-colors">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded bg-gradient-to-br from-zinc-800 to-black border border-border flex items-center justify-center">
                    <Layers size={16} className="text-white/40" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{mover.name}</div>
                    <div className="text-xs text-muted-foreground">{mover.set}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-lg font-bold">${mover.price}</div>
                  <div className={`text-xs font-bold flex items-center justify-end ${mover.change > 0 ? 'text-positive' : 'text-negative'}`}>
                    {mover.change > 0 ? <ArrowUpRight size={14} className="mr-0.5" /> : <ArrowDownRight size={14} className="mr-0.5" />}
                    {Math.abs(mover.change)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-5 border-b border-border flex justify-between items-center">
            <h3 className="font-display text-xl font-bold">TRENDING NOW</h3>
            <button className="text-xs text-primary font-bold hover:underline">VIEW ALL</button>
          </div>
          <div className="divide-y divide-border">
            {MOCK_TRENDING.map(trend => (
              <div key={trend.id} className="flex items-center justify-between p-4 hover:bg-card-alt transition-colors">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded bg-gradient-to-br from-zinc-800 to-black border border-border flex items-center justify-center">
                    <Layers size={16} className="text-white/40" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{trend.name}</div>
                    <div className="text-xs text-muted-foreground">{trend.set}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-lg font-bold">${trend.price.toLocaleString()}</div>
                  <div className={`text-xs font-bold flex items-center justify-end ${trend.change > 0 ? 'text-positive' : 'text-negative'}`}>
                    {trend.change > 0 ? <ArrowUpRight size={14} className="mr-0.5" /> : <ArrowDownRight size={14} className="mr-0.5" />}
                    {Math.abs(trend.change)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const CollectionView = () => (
  <div className="animate-in fade-in duration-300">
    <div className="flex justify-between items-end mb-8">
      <h1 className="font-display text-4xl font-bold">MY COLLECTION</h1>
      <div className="flex gap-4">
        {[
          { label: 'TOTAL CARDS', value: '847', color: '' },
          { label: 'TOTAL VALUE', value: '$24,850', color: 'text-positive' },
          { label: 'HIGHEST VALUE', value: '$42,000', color: '' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl px-6 py-3 text-center min-w-[140px]">
            <div className="text-xs font-bold text-muted-foreground mb-1 tracking-wider">{s.label}</div>
            <div className={`font-display text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>

    <div className="flex gap-4 mb-6">
      <div className="relative flex-1">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
        <input
          type="text"
          placeholder="Search cards, sets, or characters..."
          className="w-full bg-card border border-border rounded-lg pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
        />
      </div>
      <button className="flex items-center gap-2 bg-card border border-border rounded-lg px-5 py-3 text-sm font-bold hover:bg-card-alt transition-colors">
        <Filter size={16} /> ALL TCGs <ChevronDown size={14} />
      </button>
      <button className="flex items-center gap-2 bg-card border border-border rounded-lg px-5 py-3 text-sm font-bold hover:bg-card-alt transition-colors">
        CONDITION <ChevronDown size={14} />
      </button>
      <button className="flex items-center gap-2 bg-card border border-border rounded-lg px-5 py-3 text-sm font-bold hover:bg-card-alt transition-colors">
        GRADER <ChevronDown size={14} />
      </button>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
      {MOCK_CARDS.map(card => (
        <div key={card.id} className="group cursor-pointer">
          <div className={`aspect-[2.5/3.5] rounded-xl bg-gradient-to-br ${card.color} w-full relative overflow-hidden border border-border shadow-lg group-hover:border-primary/50 group-hover:shadow-[0_0_20px_rgba(255,30,45,0.2)] transition-all duration-300`}>
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
            <div className="absolute inset-0 flex items-center justify-center mix-blend-overlay">
              <Layers size={48} className="text-white/20" />
            </div>
            <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm border border-white/10 text-xs font-bold px-2 py-1 rounded shadow-lg">
              {card.grade}
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <div className="text-[10px] uppercase font-bold text-white/70 tracking-wider mb-1">{card.tcg}</div>
            </div>
          </div>
          <div className="mt-4 px-1">
            <div className="font-bold text-sm truncate">{card.name}</div>
            <div className="text-xs text-muted-foreground truncate">{card.set}</div>
            <div className="flex items-center justify-between mt-2">
              <div className="font-display font-bold text-xl">${card.price.toLocaleString()}</div>
              <div className={`text-xs font-bold flex items-center ${card.change > 0 ? 'text-positive' : 'text-negative'}`}>
                {card.change > 0 ? <ArrowUpRight size={12} className="mr-0.5" /> : <ArrowDownRight size={12} className="mr-0.5" />}
                {Math.abs(card.change)}%
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const MarketView = () => {
  const [activeTcg, setActiveTcg] = useState('All');
  const tcgs = ['All', 'Pokémon', 'MTG', 'One Piece', 'Yu-Gi-Oh!', 'Lorcana'];

  return (
    <div className="animate-in fade-in duration-300">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="font-display text-4xl font-bold">LIVE MARKET</h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time data across all verified marketplaces.</p>
        </div>
        <div className="flex bg-card border border-border rounded-lg p-1">
          {tcgs.map(tcg => (
            <button
              key={tcg}
              onClick={() => setActiveTcg(tcg)}
              className={`px-4 py-2 text-sm font-bold rounded-md transition-colors ${activeTcg === tcg ? 'bg-primary text-white shadow-[0_0_10px_rgba(255,30,45,0.3)]' : 'text-muted-foreground hover:text-foreground hover:bg-border/50'}`}
            >
              {tcg}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div>
          <div className="flex items-center gap-3 mb-4 text-positive">
            <div className="p-2 bg-positive/10 rounded-lg">
              <TrendingUp size={24} />
            </div>
            <h3 className="font-display text-2xl font-bold">TOP GAINERS</h3>
          </div>
          <div className="space-y-3">
            {MOCK_CARDS.filter(c => c.change > 0).map((card, i) => (
              <div key={card.id} className="flex items-center bg-card border border-border rounded-xl p-4 hover:border-positive/30 hover:bg-card-alt transition-colors cursor-pointer group">
                <div className="text-xl font-display font-bold text-border group-hover:text-positive/50 transition-colors w-8 text-center">{i + 1}</div>
                <div className="h-14 w-14 rounded bg-gradient-to-br from-zinc-800 to-black border border-border flex items-center justify-center shrink-0 ml-2 shadow-inner">
                  <Layers size={20} className="text-white/40" />
                </div>
                <div className="ml-4 flex-1">
                  <div className="font-bold text-sm">{card.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{card.tcg} • {card.set}</div>
                </div>
                <div className="w-24 px-4">
                  <Sparkline data={[10, 12, 11, 15, 14, 18, 20]} color="hsl(var(--positive))" height={24} />
                </div>
                <div className="text-right ml-2 min-w-[80px]">
                  <div className="font-display text-lg font-bold">${card.price.toLocaleString()}</div>
                  <div className="text-xs font-bold text-positive mt-0.5">+{card.change}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-3 mb-4 text-negative">
            <div className="p-2 bg-negative/10 rounded-lg">
              <TrendingUp size={24} className="rotate-180" />
            </div>
            <h3 className="font-display text-2xl font-bold">TOP LOSERS</h3>
          </div>
          <div className="space-y-3">
            {[...MOCK_MOVERS].reverse().map((mover, i) => (
              <div key={mover.id} className="flex items-center bg-card border border-border rounded-xl p-4 hover:border-negative/30 hover:bg-card-alt transition-colors cursor-pointer group">
                <div className="text-xl font-display font-bold text-border group-hover:text-negative/50 transition-colors w-8 text-center">{i + 1}</div>
                <div className="h-14 w-14 rounded bg-gradient-to-br from-zinc-800 to-black border border-border flex items-center justify-center shrink-0 ml-2 shadow-inner">
                  <Layers size={20} className="text-white/40" />
                </div>
                <div className="ml-4 flex-1">
                  <div className="font-bold text-sm">{mover.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{mover.set}</div>
                </div>
                <div className="w-24 px-4">
                  <Sparkline data={[20, 18, 19, 15, 16, 12, 10]} color="hsl(var(--negative))" height={24} />
                </div>
                <div className="text-right ml-2 min-w-[80px]">
                  <div className="font-display text-lg font-bold">${mover.price.toLocaleString()}</div>
                  <div className="text-xs font-bold text-negative mt-0.5">{mover.change}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const ProfileView = () => (
  <div className="animate-in fade-in duration-300 max-w-5xl mx-auto">
    <h1 className="font-display text-4xl font-bold mb-8">PROFILE</h1>

    <div className="bg-card border border-border rounded-2xl p-8 mb-8 flex items-center gap-8 relative overflow-hidden shadow-lg">
      <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
      <div className="relative z-10 shrink-0">
        <div className="h-32 w-32 rounded-full border-4 border-card outline outline-2 outline-primary bg-primary/20 flex items-center justify-center text-5xl font-display font-bold text-primary shadow-[0_0_30px_rgba(255,30,45,0.3)]">
          JS
        </div>
      </div>
      <div className="flex-1 relative z-10">
        <div className="flex items-center gap-4 mb-2">
          <h2 className="text-3xl font-bold tracking-tight">Jason Santos</h2>
          <div className="bg-gradient-to-r from-amber-500 to-yellow-300 text-black text-xs font-bold px-2.5 py-1 rounded flex items-center gap-1.5 shadow-[0_0_15px_rgba(245,158,11,0.4)]">
            <Check size={14} strokeWidth={4} /> VERIFIED PRO
          </div>
        </div>
        <div className="text-muted-foreground font-medium mb-4 text-sm">@jsantos_collects</div>
        <p className="text-sm max-w-lg leading-relaxed text-foreground/90">Vintage Pokémon and sealed MTG collector. Building the ultimate master set. Open to high-end trades. Always looking for pristine condition early eras.</p>
      </div>
      <div className="relative z-10 self-start">
        <button className="bg-border hover:bg-white hover:text-black text-xs font-bold px-4 py-2 rounded transition-colors flex items-center gap-2">
          <Settings size={14} /> EDIT PROFILE
        </button>
      </div>
    </div>

    <div className="grid grid-cols-3 gap-6 mb-8">
      {[
        { icon: Layers, label: 'COLLECTION VALUE', value: '$24,850' },
        { icon: Trophy, label: 'GRADED CARDS', value: '142' },
        { icon: ScanLine, label: 'SUCCESSFUL TRADES', value: '18' },
      ].map(s => (
        <div key={s.label} className="bg-card border border-border rounded-xl p-6 hover:border-primary/30 transition-colors">
          <div className="flex items-center gap-3 text-muted-foreground mb-3 text-xs font-bold tracking-wider">
            <s.icon size={16} /> {s.label}
          </div>
          <div className="font-display text-4xl font-bold">{s.value}</div>
        </div>
      ))}
    </div>

    <div className="grid grid-cols-2 gap-8">
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-display text-xl font-bold mb-6">SUBSCRIPTION & USAGE</h3>
        <div className="mb-8">
          <div className="flex justify-between text-sm mb-3">
            <span className="font-bold text-foreground">AI Scan Quota</span>
            <span className="text-muted-foreground font-medium">45 / 100 used</span>
          </div>
          <div className="h-2.5 w-full bg-border rounded-full overflow-hidden">
            <div className="h-full bg-primary w-[45%] rounded-full relative">
              <div className="absolute inset-0 bg-white/20"></div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 font-medium">Resets in 12 days</p>
        </div>
        <div className="flex items-center justify-between p-5 bg-background border border-border rounded-xl">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/10 rounded-lg text-primary">
              <CreditCard size={20} />
            </div>
            <div>
              <div className="font-bold text-sm">Pro Plan</div>
              <div className="text-xs text-muted-foreground mt-0.5">$9.99/month</div>
            </div>
          </div>
          <button className="text-xs font-bold bg-border hover:bg-white hover:text-black transition-colors px-4 py-2 rounded">
            MANAGE
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-display text-xl font-bold mb-6">SETTINGS</h3>
        <div className="space-y-6">
          {[
            { id: 'push', label: 'Push Notifications', desc: 'Price alerts and trade offers', defaultChecked: true },
            { id: 'email', label: 'Email Digest', desc: 'Weekly market summaries', defaultChecked: false },
            { id: 'public', label: 'Public Profile', desc: 'Allow others to see your showcase', defaultChecked: true },
          ].map(setting => (
            <div key={setting.id} className="flex items-center justify-between">
              <div>
                <div className="font-bold text-sm">{setting.label}</div>
                <div className="text-xs text-muted-foreground mt-1">{setting.desc}</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" defaultChecked={setting.defaultChecked} />
                <div className="w-10 h-6 bg-border rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary shadow-inner"></div>
              </label>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2">
            <div>
              <div className="font-bold text-sm text-muted-foreground">Dark Mode</div>
              <div className="text-xs text-muted-foreground mt-1">Locked to theme</div>
            </div>
            <label className="relative inline-flex items-center opacity-50 cursor-not-allowed">
              <input type="checkbox" className="sr-only peer" checked readOnly />
              <div className="w-10 h-6 bg-primary rounded-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:translate-x-full"></div>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const Sidebar = ({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (t: string) => void }) => {
  const nav = [
    { name: 'Dashboard', icon: LayoutDashboard },
    { name: 'Collection', icon: Layers },
    { name: 'Market', icon: TrendingUp },
    { name: 'Profile', icon: User },
  ];

  return (
    <div className="w-[240px] bg-sidebar border-r border-border h-full flex flex-col shrink-0">
      <div className="p-6 flex items-center gap-3">
        <div className="h-8 w-8 bg-primary rounded flex items-center justify-center text-white font-bold shadow-[0_0_15px_rgba(255,30,45,0.4)]">
          <CheckCircle size={18} strokeWidth={3} />
        </div>
        <span className="font-display font-bold text-xl tracking-wide">VERIFIED TCG</span>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-2 mt-4">
        {nav.map(item => (
          <button
            key={item.name}
            onClick={() => setActiveTab(item.name)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-all duration-200 ${
              activeTab === item.name
                ? 'bg-primary/10 text-primary shadow-inner'
                : 'text-muted-foreground hover:bg-card hover:text-foreground'
            }`}
          >
            <item.icon size={18} className={activeTab === item.name ? 'text-primary' : ''} />
            {item.name.toUpperCase()}
          </button>
        ))}
      </nav>

      <div className="p-4 mt-auto">
        <div className="bg-card border border-border p-5 rounded-xl relative overflow-hidden group cursor-pointer hover:border-primary/50 transition-colors">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="text-xs font-bold text-primary mb-2 flex items-center gap-1.5"><Check size={14} /> PRO STATUS</div>
          <div className="text-sm font-medium mb-4 text-foreground/80 leading-tight">Upgrade for unlimited AI scanning & market alerts.</div>
          <button className="w-full bg-primary text-white text-xs font-bold py-2.5 rounded shadow-[0_0_15px_rgba(255,30,45,0.3)] hover:bg-primary/90 transition-colors relative z-10">
            UPGRADE NOW
          </button>
        </div>
      </div>
    </div>
  );
};

const Topbar = () => (
  <header className="h-20 border-b border-border bg-background flex items-center justify-between px-8 shrink-0">
    <div className="relative w-96">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
      <input
        type="text"
        placeholder="Search cards, sets, users..."
        className="w-full bg-card border border-border rounded-lg pl-12 pr-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground"
      />
    </div>
    <div className="flex items-center gap-6">
      <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-card">
        <Bell size={22} />
        <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background"></span>
      </button>
      <div className="flex items-center gap-3 pl-6 border-l border-border">
        <div className="text-right">
          <div className="text-sm font-bold">Jason Santos</div>
          <div className="text-xs text-primary font-bold">PRO MEMBER</div>
        </div>
        <div className="h-10 w-10 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center text-sm font-bold text-primary cursor-pointer shadow-[0_0_10px_rgba(255,30,45,0.2)]">
          JS
        </div>
      </div>
    </div>
  </header>
);

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('Dashboard');

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans selection:bg-primary/30">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-8 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
          {activeTab === 'Dashboard' && <DashboardView />}
          {activeTab === 'Collection' && <CollectionView />}
          {activeTab === 'Market' && <MarketView />}
          {activeTab === 'Profile' && <ProfileView />}
        </main>
      </div>
    </div>
  );
}
