import {
  installStartupDiagnostics,
  recordStartupPhase,
} from './services/startupDiagnostics';

declare const require: (moduleName: string) => unknown;

function installWebStartupSplash() {
  if (typeof document === 'undefined' || document.getElementById('startup-splash')) return;

  const style = document.createElement('style');
  style.id = 'startup-splash-styles';
  style.textContent = `
    html,body,#root{margin:0;min-height:100%;background:#100e0f}
    #startup-splash{position:fixed;z-index:2147483647;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;box-sizing:border-box;padding:30px 28px;overflow:hidden;color:#f7f4f4;background:radial-gradient(circle at 50% 38%,rgba(239,51,64,.1),transparent 28%),radial-gradient(circle at -8% 14%,rgba(127,29,45,.18),transparent 25%),#100e0f;font-family:Arial,sans-serif}
    .startup-orbit{position:absolute;top:17%;left:50%;width:min(440px,112vw);aspect-ratio:1;transform:translateX(-50%);border:1px solid rgba(239,51,64,.14);border-radius:50%}
    .startup-orbit:after{content:"";position:absolute;inset:11%;border:1px solid rgba(239,51,64,.18);border-radius:50%}
    .startup-top,.startup-bottom,.startup-center{position:relative;z-index:1}
    .startup-top{width:100%;display:flex;align-items:center;justify-content:space-between;padding-top:env(safe-area-inset-top,0);color:#a7a0a1;font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase}
    .startup-brand{display:flex;align-items:center;gap:8px}.startup-dot{width:6px;height:6px;border-radius:50%;background:#ef3340;box-shadow:0 0 12px #ef3340}
    .startup-center{display:flex;flex-direction:column;align-items:center;transform:translateY(-12px);text-align:center}
    .startup-orb{display:flex;width:min(224px,58vw);aspect-ratio:1;align-items:center;justify-content:center;border:1px solid rgba(239,51,64,.22);border-radius:50%;background:rgba(23,19,21,.84);box-shadow:0 0 70px rgba(239,51,64,.16)}
    .startup-logo{font-size:clamp(25px,8vw,40px);font-weight:800;letter-spacing:-.08em}.startup-logo span{color:#ef3340}
    .startup-tagline{margin-top:32px;color:#f7f4f4;font-size:11px;font-weight:700;letter-spacing:.34em}
    .startup-copy{max-width:255px;margin:12px 0 0;color:#8e8587;font-size:14px;line-height:22px}
    .startup-bottom{display:flex;flex-direction:column;align-items:center;gap:14px;padding-bottom:env(safe-area-inset-bottom,0)}
    .startup-dots{display:flex;gap:6px}.startup-dots i{display:block;width:6px;height:6px;border-radius:50%;background:rgba(239,51,64,.35)}.startup-dots i:nth-child(2){background:#ef3340}
    .startup-loading{color:#726a6c;font-size:9px;font-weight:700;letter-spacing:.24em}
  `;

  const splash = document.createElement('div');
  splash.id = 'startup-splash';
  splash.setAttribute('aria-label', 'Loading Verified TCG');
  splash.innerHTML = `
    <div class="startup-orbit"></div>
    <div class="startup-top"><div class="startup-brand"><i class="startup-dot"></i>Verified TCG</div><div>EST. 2024</div></div>
    <div class="startup-center">
      <div class="startup-orb"><div class="startup-logo"><span>V</span>ERIFIED<br>TCG</div></div>
      <div class="startup-tagline">THE COLLECTOR'S STANDARD</div>
      <p class="startup-copy">Know what you own. Know what it's worth.</p>
    </div>
    <div class="startup-bottom">
      <div class="startup-dots" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="startup-loading">PREPARING YOUR COLLECTION</div>
    </div>
  `;

  document.head.appendChild(style);
  document.body.appendChild(splash);
}

installWebStartupSplash();
installStartupDiagnostics();
recordStartupPhase('js-entry', 'success');

require('expo-router/entry');