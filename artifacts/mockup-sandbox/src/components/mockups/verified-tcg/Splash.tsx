import React from "react";
import { FontLoader, styles } from "./_shared/AppShell";

export function Splash() {
  return (
    <div className="relative flex min-h-[844px] flex-col items-center justify-between overflow-hidden bg-[#100e0f] px-7 py-12 text-white">
      <FontLoader />
      {styles}

      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute left-1/2 top-[17%] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full border border-[#ef3340]/10" />
        <div className="absolute left-1/2 top-[21%] h-[22rem] w-[22rem] -translate-x-1/2 rounded-full border border-[#ef3340]/10" />
        <div className="absolute left-1/2 top-[27%] h-[15rem] w-[15rem] -translate-x-1/2 rounded-full bg-[#ef3340]/10 blur-[85px]" />
        <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-[#7f1d2d]/20 blur-[100px]" />
        <div className="absolute -right-32 bottom-24 h-80 w-80 rounded-full bg-[#ef3340]/10 blur-[110px]" />
      </div>

      <div className="relative z-10 flex w-full items-center justify-between text-[10px] font-semibold uppercase tracking-[.22em] text-[#a7a0a1]">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ef3340] shadow-[0_0_12px_#ef3340]" />
          Verified TCG
        </span>
        <span>Est. 2024</span>
      </div>

      <div className="relative z-10 flex -translate-y-4 flex-col items-center text-center">
        <div className="relative flex h-56 w-56 items-center justify-center rounded-full border border-[#ef3340]/20 bg-[#171315]/80 shadow-[0_0_80px_rgba(239,51,64,.13)] backdrop-blur-sm">
          <div className="absolute inset-4 rounded-full border border-dashed border-[#ef3340]/25" />
          <img
            className="relative w-[185px]"
            src="/__mockup/images/verified-logo-white.png"
            alt="Verified TCG"
          />
        </div>
        <p className="mt-9 text-[11px] font-semibold uppercase tracking-[.38em] text-[#d8d0d1]">
          The Collector&apos;s Standard
        </p>
        <p className="mt-3 max-w-[255px] text-center text-sm leading-6 text-[#8e8587]">
          Know what you own. Know what it&apos;s worth.
        </p>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="flex items-center gap-2" aria-label="Loading">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className={`h-1.5 w-1.5 rounded-full ${dot === 1 ? "bg-[#ef3340]" : "bg-[#ef3340]/35"}`}
            />
          ))}
        </div>
        <span className="text-[9px] font-semibold uppercase tracking-[.28em] text-[#726a6c]">
          Preparing your collection
        </span>
      </div>
    </div>
  );
}