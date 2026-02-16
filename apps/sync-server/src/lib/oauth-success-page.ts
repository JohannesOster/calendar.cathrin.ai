import { oauthPageShell } from "./oauth-page-shell.js";

export function renderOAuthSuccessPage(
  jwt: string,
  provider?: string,
): string {
  const providerLabel = provider === "outlook" ? "Outlook" : "Google";

  return oauthPageShell({
    title: "Connected — Cathrin",
    body: `
      <div class="icon">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#212020"/>
          <path class="checkmark" d="M10 16.5L14 20.5L22 12.5" stroke="#fcfcfc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>
      <h1>You're all set</h1>
      <p>Your ${providerLabel} calendar is connected.<br/>Head back to Cathrin.</p>
      <div class="token" id="token" style="display:none;">${jwt}</div>
    `,
    extraStyles: `
      .checkmark {
        stroke-dasharray: 24;
        stroke-dashoffset: 24;
        animation: draw 0.4s ease-out 0.2s forwards;
      }
      @keyframes draw {
        to { stroke-dashoffset: 0; }
      }
    `,
    script: `
      if (window.opener) {
        window.opener.postMessage({ type: 'oauth-success', token: '${jwt}' }, '*');
      }
      // Attempt to close — works in some browsers when tab was opened programmatically
      setTimeout(function() { window.close(); }, 3000);
    `,
  });
}
