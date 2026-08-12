import React, { useState } from "react";
import { FontLoader, styles } from "./_shared/AppShell";
import "./SplashAdvanced.css";

export function SplashAdvanced() {
  const [isEntering, setIsEntering] = useState(false);

  return (
    <div className="relative flex min-h-[844px] flex-col items-center justify-center overflow-hidden bg-[#0a0a0c] text-white">
      <FontLoader />
      {styles}
      
      {/* Deep Space Background Glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="h-[500px] w-[500px] rounded-full bg-red-600/15 blur-[120px] mix-blend-screen" />
        <div className="absolute h-[300px] w-[300px] rounded-full bg-orange-500/10 blur-[80px] mix-blend-screen" />
      </div>

      {/* Hero Content Area */}
      <div className={`relative z-10 flex w-full flex-col items-center transition-all duration-1000 ${isEntering ? 'scale-110 opacity-0 blur-md' : 'scale-100 opacity-100'}`}>
        
        {/* Floating Graded Cards Array */}
        <div className="relative flex h-[360px] w-full items-center justify-center mb-16 pointer-events-none">
          {/* Card 1 - Left Back */}
          <div className="card-wrapper absolute -ml-[180px] mt-10" style={{ '--rot': '-15deg', '--scale': '0.85', '--delay': '0s' } as React.CSSProperties}>
            <GradedSlab 
              grade="9.5" 
              name="Charizard" 
              set="1999 Base Set" 
              color="from-orange-500 via-red-500 to-amber-600" 
            />
          </div>
          
          {/* Card 2 - Right Back */}
          <div className="card-wrapper absolute ml-[190px] -mt-5" style={{ '--rot': '18deg', '--scale': '0.85', '--delay': '0.1s' } as React.CSSProperties}>
            <GradedSlab 
              grade="10" 
              name="Blue-Eyes" 
              set="LOB 1st Edition" 
              color="from-blue-400 via-indigo-500 to-purple-600" 
            />
          </div>
          
          {/* Card 3 - Center Front (Hero Card) */}
          <div className="card-wrapper absolute z-20" style={{ '--rot': '3deg', '--scale': '1.05', '--delay': '0.2s' } as React.CSSProperties}>
            <GradedSlab 
              grade="10" 
              special="PRISTINE" 
              name="Black Lotus" 
              set="Alpha Edition" 
              color="from-fuchsia-500 via-purple-600 to-violet-800" 
            />
          </div>
        </div>

        {/* Branding & Typography */}
        <div className="flex flex-col items-center z-30">
          <img 
            className="w-[280px] drop-shadow-[0_0_30px_rgba(255,255,255,0.15)] logo-reveal" 
            src="/__mockup/images/verified-logo-white.png" 
            alt="Verified"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              const nextSibling = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
              if (nextSibling) {
                nextSibling.style.display = 'block';
              }
            }}
          />
          <h1 className="logo-reveal tcg-title mt-2 text-4xl font-bold tracking-tight text-white hidden">VERIFIED</h1>
          <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.4em] text-zinc-400 subtitle-reveal">
            The Collector's Standard
          </p>
        </div>
        
        {/* Interactive CTA */}
        <button 
          onClick={() => setIsEntering(true)}
          className="btn-enter group relative mt-16 flex items-center justify-center overflow-hidden rounded-full bg-red-600 px-10 py-4 shadow-[0_0_40px_rgba(220,38,38,0.3)] transition-all hover:scale-105 hover:shadow-[0_0_60px_rgba(220,38,38,0.5)] active:scale-95"
        >
          <span className="relative z-10 flex items-center gap-3 font-['Inter'] text-sm font-bold tracking-widest text-white">
            ENTER VAULT
            <svg className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1 group-active:translate-x-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </span>
          <div className="absolute inset-0 z-0 bg-gradient-to-r from-red-500 to-red-700 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="absolute inset-0 z-0 w-[200%] bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
        </button>

      </div>
    </div>
  );
}

function GradedSlab({ grade, name, set, color, special }: { grade: string, name: string, set: string, color: string, special?: string }) {
  return (
    <div className="slab-container relative flex h-[300px] w-[200px] flex-col rounded-[14px] border border-white/20 bg-gradient-to-b from-white/10 to-white/5 p-2.5 backdrop-blur-xl">
      
      {/* Slab Label */}
      <div className="relative mb-2.5 flex h-[68px] w-full items-center justify-between rounded-[6px] bg-gradient-to-b from-white to-gray-200 p-2 text-black shadow-inner">
        <div className="flex h-full flex-col justify-between overflow-hidden">
          <span className="truncate text-[9px] font-black uppercase tracking-wider text-gray-500">{set}</span>
          <span className="truncate text-[13px] font-black leading-tight text-gray-900">{name}</span>
          <span className="text-[8px] font-bold text-gray-400">AUTH / AUTO 10</span>
        </div>
        
        {/* Grade Badge with Shimmer */}
        <div className="grade-badge relative flex h-12 w-[52px] shrink-0 flex-col items-center justify-center rounded-[4px] border-[1.5px] border-gray-300/80 bg-gradient-to-br from-gray-50 to-gray-200 shadow-sm overflow-hidden">
          {special && (
            <span className="absolute top-0.5 text-[6px] font-black uppercase tracking-widest text-amber-600">
              {special}
            </span>
          )}
          <span className="font-['Rajdhani'] text-[26px] font-bold leading-none tracking-tighter text-black mt-1">
            {grade}
          </span>
          {/* The shimmering metallic wipe over the grade */}
          <div className="absolute inset-0 w-[200%] bg-gradient-to-r from-transparent via-white/90 to-transparent grade-shimmer" />
        </div>
        
        {/* Holographic sticker dot on label */}
        <div className="absolute bottom-1.5 left-1/2 ml-1 h-2 w-2 rounded-full bg-gradient-to-tr from-cyan-400 via-fuchsia-500 to-yellow-400 shadow-[0_0_4px_rgba(255,255,255,0.8)]" />
      </div>
      
      {/* Card Art Area */}
      <div className={`relative flex-1 rounded-[6px] bg-gradient-to-br ${color} overflow-hidden border border-black/40 shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]`}>
        {/* Abstract card art shapes */}
        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/20 blur-xl" />
        <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-black/40 blur-xl" />
        
        {/* Character/Art Silhouette */}
        <div className="absolute inset-0 flex items-center justify-center opacity-40 mix-blend-overlay">
          <div className="h-3/4 w-3/4 rounded-t-full bg-white blur-[2px]" />
        </div>

        {/* Card Frame Inner Border */}
        <div className="absolute inset-1 rounded border border-white/20" />

        {/* Holographic foil sweep */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/40 to-transparent holo-sweep mix-blend-overlay" />
      </div>
      
      {/* Frosted Glass Reflections (Top Layer) */}
      <div className="pointer-events-none absolute inset-0 rounded-[14px] border-t border-white/40 slab-glass-reflection mix-blend-overlay" />
      
      {/* Edge Highlights */}
      <div className="pointer-events-none absolute left-0 top-0 h-full w-[2px] bg-gradient-to-b from-white/50 via-white/10 to-transparent rounded-l-[14px]" />
      <div className="pointer-events-none absolute top-0 right-0 h-[2px] w-full bg-gradient-to-l from-white/50 via-white/10 to-transparent rounded-t-[14px]" />
    </div>
  );
}