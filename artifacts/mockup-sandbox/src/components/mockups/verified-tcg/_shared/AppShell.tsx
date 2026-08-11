import React from "react";
import { BottomNav } from "./BottomNav";
export function FontLoader(){ return <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@400;500;600;700;800&display=swap"/> }
export function AppShell({ children, active }: { children: React.ReactNode; active?: string }) { return <><FontLoader/><main className="min-h-[844px] bg-[#0d0d0f] pb-24 font-['Inter'] text-white">{children}</main><BottomNav active={active}/></>; }
export const styles = <style>{`button{transition:transform .2s,opacity .2s}button:active{transform:scale(.96);opacity:.8}.tcg-title{font-family:'Rajdhani';letter-spacing:-.02em}.scrollbar-hide::-webkit-scrollbar{display:none}`}</style>;