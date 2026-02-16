interface OAuthPageOptions {
  title: string;
  body: string;
  extraStyles?: string;
  script?: string;
}

export function oauthPageShell(options: OAuthPageOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${options.title}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500&display=swap');

      * { margin: 0; padding: 0; box-sizing: border-box; }

      body {
        font-family: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        background: #fcfcfc;
        color: #212020;
        -webkit-font-smoothing: antialiased;
      }

      .container {
        text-align: center;
        padding: 3rem 2rem;
        max-width: 360px;
        animation: fadeIn 0.3s ease-out;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .icon {
        margin-bottom: 1.25rem;
      }

      h1 {
        font-size: 1.125rem;
        font-weight: 500;
        margin-bottom: 0.5rem;
        letter-spacing: -0.01em;
      }

      p {
        font-size: 0.875rem;
        color: #212020;
        opacity: 0.6;
        line-height: 1.5;
      }

      ${options.extraStyles || ""}
    </style>
  </head>
  <body>
    <div class="container">
      ${options.body}
    </div>
    ${options.script ? `<script>${options.script}</script>` : ""}
  </body>
</html>`;
}
