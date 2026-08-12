import React, { useState } from "react";
import "./SplashAdvanced.css";

// ── Real card data ────────────────────────────────────────────────────────────
const SLABS = [
  {
    id: "charizard",
    grader: "BGS" as const,
    grade: "9.5",
    label: "GEM MINT",
    name: "Charizard Holo",
    set: "1999 Pokémon Base Set",
    cardNo: "#4/102",
    certNo: "0010283477",
    subGrades: { centering: "9", corners: "9.5", edges: "10", surface: "9.5" },
    imgUrl: "https://images.pokemontcg.io/base1/4.png",
    artGradient: "from-[#B34700] via-[#E05225] to-[#FF7A3D]",
    rot: "-15deg",
    scale: "0.85",
    delay: "0s",
    offsetX: "-180px",
    offsetY: "10px",
    z: 10,
  },
  {
    id: "black-lotus",
    grader: "PSA" as const,
    grade: "10",
    label: "GEM MT",
    name: "Black Lotus",
    set: "Magic: The Gathering Alpha",
    cardNo: "#232/295",
    certNo: "70491827",
    subGrades: null,
    imgUrl: "https://cards.scryfall.io/large/front/b/d/bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd.jpg",
    artGradient: "from-[#0F0F0F] via-[#1a1a1a] to-[#2D2D2D]",
    rot: "3deg",
    scale: "1.05",
    delay: "0.2s",
    offsetX: "0px",
    offsetY: "0px",
    z: 20,
  },
  {
    id: "blue-eyes",
    grader: "CGC" as const,
    grade: "10",
    label: "PRISTINE",
    name: "Blue-Eyes White Dragon",
    set: "Legend of Blue Eyes 1st Ed.",
    cardNo: "LOB-001",
    certNo: "CGC-8843271",
    subGrades: null,
    imgUrl: "https://images.ygoprodeck.com/images/cards/89631139.jpg",
    artGradient: "from-[#1A237E] via-[#3949AB] to-[#7986CB]",
    rot: "18deg",
    scale: "0.85",
    delay: "0.1s",
    offsetX: "190px",
    offsetY: "-5px",
    z: 10,
  },
];

const GRADER_STYLES = {
  BGS: {
    headerBg: "#001F5C",
    headerText: "#FFFFFF",
    accentColor: "#D4AF37",
    gradeBg: "linear-gradient(135deg,#D4AF37,#F5E07A,#D4AF37)",
    gradeText: "#001F5C",
    logo: "BGS",
    subLogo: "BECKETT",
  },
  PSA: {
    headerBg: "#CC0000",
    headerText: "#FFFFFF",
    accentColor: "#CC0000",
    gradeBg: "linear-gradient(135deg,#CC0000,#FF3333)",
    gradeText: "#FFFFFF",
    logo: "PSA",
    subLogo: "GRADING",
  },
  CGC: {
    headerBg: "#2D1B4E",
    headerText: "#FFFFFF",
    accentColor: "#8B5CF6",
    gradeBg: "linear-gradient(135deg,#7C3AED,#A78BFA)",
    gradeText: "#FFFFFF",
    logo: "CGC",
    subLogo: "GRADING",
  },
};

// ── Graded Slab Component ─────────────────────────────────────────────────────
function GradedSlab({ slab }: { slab: typeof SLABS[0] }) {
  const [imgFailed, setImgFailed] = useState(false);
  const g = GRADER_STYLES[slab.grader];

  return (
    <div
      className="slab-outer"
      style={{ "--rot": slab.rot, "--scale": slab.scale, "--delay": slab.delay } as React.CSSProperties}
    >
      {/* ── Slab housing (frosted acrylic look) */}
      <div className="slab-housing">

        {/* ── Label area ── */}
        <div className="slab-label-area">

          {/* Grader header bar */}
          <div className="grader-header" style={{ background: g.headerBg }}>
            <div className="grader-header-left">
              <span className="grader-logo-text" style={{ color: g.headerText }}>{g.logo}</span>
              <span className="grader-sub-text" style={{ color: `${g.headerText}99` }}>{g.subLogo}</span>
            </div>
            {/* Holographic sticker */}
            <div className="holo-sticker" />
          </div>

          {/* Card info + grade box */}
          <div className="label-body">
            <div className="label-card-info">
              <span className="label-set">{slab.set}</span>
              <span className="label-name">{slab.name}</span>
              <span className="label-cardno">{slab.cardNo}</span>
              {slab.subGrades && (
                <div className="sub-grades">
                  <SubGrade label="CEN" val={slab.subGrades.centering} />
                  <SubGrade label="COR" val={slab.subGrades.corners} />
                  <SubGrade label="EDG" val={slab.subGrades.edges} />
                  <SubGrade label="SUR" val={slab.subGrades.surface} />
                </div>
              )}
              <span className="cert-no">Cert #{slab.certNo}</span>
            </div>

            {/* Grade badge */}
            <div className="grade-badge-wrap">
              <div className="grade-badge" style={{ background: g.gradeBg }}>
                <span className="grade-label-text" style={{ color: `${g.gradeText}99` }}>{slab.label}</span>
                <span className="grade-number" style={{ color: g.gradeText }}>{slab.grade}</span>
                <div className="grade-shimmer-overlay" />
              </div>
              <div className="barcode-strip">
                {Array.from({ length: 18 }).map((_, i) => (
                  <div key={i} className="barcode-line" style={{ width: i % 3 === 0 ? "2px" : "1px", opacity: i % 5 === 0 ? 1 : 0.5 }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Card art area ── */}
        <div className={`card-art-area bg-gradient-to-br ${slab.artGradient}`}>
          {!imgFailed ? (
            <img
              className="card-art-img"
              src={slab.imgUrl}
              alt={slab.name}
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="card-art-fallback">
              <div className="card-art-shape1" />
              <div className="card-art-shape2" />
            </div>
          )}

          {/* Holographic foil sweep */}
          <div className="holo-foil" />
          {/* Inner card border */}
          <div className="card-inner-border" />
        </div>

        {/* ── Slab glass reflections ── */}
        <div className="slab-reflection-top" />
        <div className="slab-edge-left" />
        <div className="slab-edge-top" />
      </div>
    </div>
  );
}

function SubGrade({ label, val }: { label: string; val: string }) {
  return (
    <div className="sub-grade-item">
      <span className="sub-grade-label">{label}</span>
      <span className="sub-grade-val">{val}</span>
    </div>
  );
}

// ── Root Export ───────────────────────────────────────────────────────────────
export function SplashAdvanced() {
  const [isEntering, setIsEntering] = useState(false);

  return (
    <div className={`splash-root transition-all duration-1000 ${isEntering ? "scale-110 opacity-0 blur-md" : ""}`}>

      {/* Background glows */}
      <div className="bg-glow-primary" />
      <div className="bg-glow-secondary" />

      {/* ── Card stack ── */}
      <div className="card-stack">
        {SLABS.map((s) => (
          <div
            key={s.id}
            className="card-position"
            style={{ marginLeft: s.offsetX, marginTop: s.offsetY, zIndex: s.z } as React.CSSProperties}
          >
            <GradedSlab slab={s} />
          </div>
        ))}
      </div>

      {/* ── Branding ── */}
      <div className="branding-block">
        <img
          className="logo-img logo-reveal"
          src="/__mockup/images/verified-logo-white.png"
          alt="Verified TCG"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
            const fb = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
            if (fb) fb.style.display = "block";
          }}
        />
        <h1 className="logo-fallback logo-reveal" style={{ display: "none" }}>VERIFIED</h1>
        <p className="tagline subtitle-reveal">THE COLLECTOR'S STANDARD</p>
      </div>

      {/* ── CTA ── */}
      <button className="enter-btn btn-enter" onClick={() => setIsEntering(true)}>
        <span className="enter-btn-text">ENTER VAULT</span>
        <svg className="enter-btn-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>
        <div className="btn-shimmer" />
      </button>

      <p className="guest-link subtitle-reveal">Continue as guest →</p>
    </div>
  );
}
