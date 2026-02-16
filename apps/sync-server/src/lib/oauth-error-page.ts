import { oauthPageShell } from "./oauth-page-shell.js";

export function renderOAuthErrorPage(message: string): string {
  // Sanitize message to prevent XSS
  const safe = message.replace(/[&<>"']/g, (c: string) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c
  );

  return oauthPageShell({
    title: "Connection failed — Cathrin",
    body: `
      <div class="icon">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#212020"/>
          <path d="M11.5 11.5L20.5 20.5M20.5 11.5L11.5 20.5" stroke="#fcfcfc" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </div>
      <h1>Something went wrong</h1>
      <p>${safe}</p>
      <p class="hint">Close this tab and try again from Cathrin.</p>
    `,
    extraStyles: `
      .hint { opacity: 0.5; font-size: 0.8125rem; }
    `,
  });
}
