import { useState, useEffect } from "react";
import { Camera, ZapOff, Zap, Search, ChevronLeft, Plus, Clock } from "lucide-react";

const BRAND = "#CC1826";

const recent = [
  { name: "Charizard", set: "Base Set", num: "4", initial: "C", color: "#f97316" },
  { name: "Lotus Bloom", set: "Modern Masters", num: "200", initial: "L", color: "#8b5cf6" },
  { name: "Elsa – Spirit of Winter", set: "Fabled", num: "—", initial: "E", color: "#3b82f6" },
];

export function Redesign() {
  const [flash, setFlash] = useState(false);
  const [beam, setBeam] = useState(0);
  const [beamDir, setBeamDir] = useState(1);
  const [glow, setGlow] = useState(false);
  const [drawer, setDrawer] = useState(false);

  // Animate scan beam
  useEffect(() => {
    const id = setInterval(() => {
      setBeam((v) => {
        const n = v + beamDir * 2.2;
        if (n >= 100) { setBeamDir(-1); return 100; }
        if (n <= 0)   { setBeamDir(1);  return 0;   }
        return n;
      });
    }, 16);
    return () => clearInterval(id);
  }, [beamDir]);

  // Pulse shutter
  useEffect(() => {
    const id = setInterval(() => setGlow((g) => !g), 1500);
    return () => clearInterval(id);
  }, []);

  const GUIDE_TOP    = 128;
  const GUIDE_BOTTOM = 208;
  const GUIDE_SIDE   = 36;
  const FRAME_H      = 844 - GUIDE_TOP - GUIDE_BOTTOM;

  return (
    <div style={{ width: 390, height: 844, position: "relative", overflow: "hidden", background: "#040405", fontFamily: "'Inter', sans-serif" }}>

      {/* ── Camera simulation ─── */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse at 35% 38%, #1a1a22 0%, #040405 65%)",
      }} />
      {/* film-grain lines */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.06,
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,1) 3px, rgba(255,255,255,1) 4px)",
        pointerEvents: "none",
      }} />
      {/* subtle lens highlight */}
      <div style={{
        position: "absolute", top: "8%", left: "58%", width: 90, height: 90, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,255,255,0.07) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* ── Vignette ─── */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 46%, transparent 36%, rgba(0,0,0,0.72) 100%)",
      }} />

      {/* ── Dim mask outside guide frame ─── */}
      <div style={{
        position: "absolute",
        top: GUIDE_TOP, left: GUIDE_SIDE, right: GUIDE_SIDE, bottom: GUIDE_BOTTOM,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.52)",
        borderRadius: 16,
        pointerEvents: "none",
      }} />

      {/* ── Corner brackets ─── */}
      {([
        { t: GUIDE_TOP,    l: GUIDE_SIDE,  sides: "tl" },
        { t: GUIDE_TOP,    r: GUIDE_SIDE,  sides: "tr" },
        { b: GUIDE_BOTTOM, l: GUIDE_SIDE,  sides: "bl" },
        { b: GUIDE_BOTTOM, r: GUIDE_SIDE,  sides: "br" },
      ] as Array<{ t?: number; b?: number; l?: number; r?: number; sides: string }>).map((c, i) => (
        <div key={i} style={{
          position: "absolute",
          width: 30, height: 30,
          ...(c.t !== undefined ? { top: c.t } : { bottom: c.b }),
          ...(c.l !== undefined ? { left: c.l } : { right: c.r }),
          borderColor: "rgba(255,255,255,0.82)",
          borderStyle: "solid",
          borderTopWidth:    c.sides.includes("t") ? 2 : 0,
          borderBottomWidth: c.sides.includes("b") ? 2 : 0,
          borderLeftWidth:   c.sides.includes("l") ? 2 : 0,
          borderRightWidth:  c.sides.includes("r") ? 2 : 0,
          borderTopLeftRadius:     c.sides === "tl" ? 9 : 0,
          borderTopRightRadius:    c.sides === "tr" ? 9 : 0,
          borderBottomLeftRadius:  c.sides === "bl" ? 9 : 0,
          borderBottomRightRadius: c.sides === "br" ? 9 : 0,
        }} />
      ))}

      {/* Brand dot at each corner */}
      {([
        { t: GUIDE_TOP    - 3, l: GUIDE_SIDE  - 3 },
        { t: GUIDE_TOP    - 3, r: GUIDE_SIDE  - 3 },
        { b: GUIDE_BOTTOM - 3, l: GUIDE_SIDE  - 3 },
        { b: GUIDE_BOTTOM - 3, r: GUIDE_SIDE  - 3 },
      ] as Array<{ t?: number; b?: number; l?: number; r?: number }>).map((p, i) => (
        <div key={i} style={{
          position: "absolute", width: 7, height: 7, borderRadius: "50%",
          background: BRAND, boxShadow: `0 0 10px 3px ${BRAND}88`,
          ...(p.t !== undefined ? { top: p.t } : { bottom: p.b }),
          ...(p.l !== undefined ? { left: p.l } : { right: p.r }),
        }} />
      ))}

      {/* Scan beam */}
      <div style={{
        position: "absolute", pointerEvents: "none",
        top: GUIDE_TOP + (beam / 100) * (FRAME_H - 2),
        left: GUIDE_SIDE, right: GUIDE_SIDE, height: 2,
        background: `linear-gradient(90deg, transparent, ${BRAND}CC 30%, ${BRAND} 50%, ${BRAND}CC 70%, transparent)`,
        boxShadow: `0 0 14px 4px ${BRAND}55`,
        borderRadius: 1,
      }} />

      {/* Hint text */}
      <div style={{
        position: "absolute", left: 0, right: 0, textAlign: "center", pointerEvents: "none",
        bottom: GUIDE_BOTTOM - 22,
        fontSize: 12, color: "rgba(255,255,255,0.48)", letterSpacing: "0.015em",
      }}>
        Position card in frame, then tap capture
      </div>

      {/* ── Floating header ─── */}
      <div style={{
        position: "absolute", top: 56, left: 0, right: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingInline: 20, zIndex: 20,
      }}>
        {/* Back */}
        <button style={{
          width: 40, height: 40, borderRadius: 12, cursor: "pointer",
          background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff",
        }}>
          <ChevronLeft size={20} />
        </button>

        <span style={{ fontSize: 17, fontWeight: 700, color: "#fff", letterSpacing: "-0.01em", textShadow: "0 1px 10px rgba(0,0,0,0.7)" }}>
          Scan Card
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 11px", borderRadius: 20, cursor: "pointer",
            background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(14px)", color: "rgba(255,255,255,0.65)",
            fontSize: 12, fontWeight: 500,
          }}>
            <Camera size={12} />
            <span>30 left</span>
          </button>
          <button style={{
            width: 36, height: 36, borderRadius: 10, cursor: "pointer",
            background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(14px)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* ── Bottom controls ─── */}
      <div style={{
        position: "absolute", bottom: 48, left: 0, right: 0,
        display: "flex", flexDirection: "column", alignItems: "center", zIndex: 20,
      }}>
        {/* Recent scans toggle */}
        <button onClick={() => setDrawer((d) => !d)} style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 20, cursor: "pointer",
          padding: "6px 14px", borderRadius: 20,
          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
          backdropFilter: "blur(10px)", color: "rgba(255,255,255,0.5)",
          fontSize: 12, fontWeight: 500,
          transition: "all 0.2s",
        }}>
          <Clock size={12} />
          <span>Recent scans</span>
          <span style={{ display: "inline-block", transition: "transform 0.25s", transform: drawer ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
        </button>

        {/* Flash · Shutter · Search */}
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <button onClick={() => setFlash((f) => !f)} style={{
            width: 54, height: 54, borderRadius: 16, cursor: "pointer",
            background: flash ? "rgba(245,158,11,0.16)" : "rgba(255,255,255,0.09)",
            border: flash ? "1px solid rgba(245,158,11,0.45)" : "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(16px)", color: flash ? "#F59E0B" : "rgba(255,255,255,0.78)",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s",
          }}>
            {flash ? <Zap size={22} /> : <ZapOff size={22} />}
          </button>

          {/* Shutter */}
          <div style={{
            position: "relative", width: 78, height: 78,
            borderRadius: "50%", cursor: "pointer",
            background: `radial-gradient(circle at 38% 32%, #e8202e, ${BRAND})`,
            boxShadow: glow
              ? `0 0 0 5px rgba(204,24,38,0.22), 0 0 32px 10px rgba(204,24,38,0.32), 0 6px 24px rgba(0,0,0,0.55)`
              : `0 0 0 3px rgba(204,24,38,0.12), 0 0 18px 5px rgba(204,24,38,0.18), 0 6px 24px rgba(0,0,0,0.55)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "box-shadow 0.8s ease-in-out",
          }}>
            <div style={{
              position: "absolute", inset: 5, borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.35)",
            }} />
            <Camera size={30} color="#fff" />
          </div>

          <button style={{
            width: 54, height: 54, borderRadius: 16, cursor: "pointer",
            background: "rgba(255,255,255,0.09)", border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(16px)", color: "rgba(255,255,255,0.78)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Search size={22} />
          </button>
        </div>
      </div>

      {/* ── Recent scans drawer ─── */}
      <div style={{
        position: "absolute", left: 0, right: 0,
        bottom: drawer ? 0 : -290, height: 320,
        background: "rgba(8,8,10,0.97)",
        backdropFilter: "blur(28px)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        transition: "bottom 0.38s cubic-bezier(0.32,0.72,0,1)",
        zIndex: 30, paddingTop: 10,
      }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)", margin: "0 auto 18px" }} />
        <div style={{ paddingInline: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
            <Clock size={13} color="rgba(255,255,255,0.35)" />
            <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.07em", textTransform: "uppercase" }}>Recent Scans</span>
          </div>
          {recent.map((s, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 13,
              paddingBlock: 11, cursor: "pointer",
              borderBottom: i < recent.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
            }}>
              <div style={{
                width: 40, height: 54, borderRadius: 9, flexShrink: 0,
                background: `linear-gradient(145deg, ${s.color}28, ${s.color}0a)`,
                border: `1px solid ${s.color}30`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, fontWeight: 800, color: s.color,
              }}>{s.initial}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 2 }}>{s.set} · #{s.num}</div>
              </div>
              <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 18 }}>›</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
