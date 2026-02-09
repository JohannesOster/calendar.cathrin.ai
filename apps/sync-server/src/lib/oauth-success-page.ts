export function renderOAuthSuccessPage(jwt: string): string {
  return `<!DOCTYPE html>
        <html>
          <head>
            <title>Connected!</title>
            <meta name="session-token" content="${jwt}">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: #f5f5f5;
              }
              .container {
                text-align: center;
                padding: 2rem;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              h1 { color: #10b981; margin-bottom: 0.5rem; }
              p { color: #666; }
              .token {
                margin-top: 1rem;
                padding: 0.5rem;
                background: #f0f0f0;
                border-radius: 4px;
                font-family: monospace;
                font-size: 0.75rem;
                word-break: break-all;
                max-width: 400px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Connected!</h1>
              <p>Your Google Calendar account has been connected.</p>
              <p>You can close this window.</p>
              <div class="token" id="token" style="display: none;">${jwt}</div>
            </div>
            <script>
              // Notify the desktop app via custom protocol or window message
              if (window.opener) {
                window.opener.postMessage({ type: 'oauth-success', token: '${jwt}' }, '*');
              }
            </script>
          </body>
        </html>`;
}
