import './styles.css';

const nativeOrigin = (import.meta.env.VITE_SCRYPTED_ORIGIN || window.location.origin).replace(/\/$/, '');
const version = import.meta.env.VITE_SCRYVEX_VERSION || '4.0.0';
const nativeUrl = `${nativeOrigin}/`;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="shell">
    <header class="glass"><div><strong>Scryvex Pro</strong><span>Visual layer · ${version}</span></div><a href="${nativeUrl}" target="_blank" rel="noreferrer">Abrir interfaz original ↗</a></header>
    <iframe id="scrypted-console" title="Scryvex Pro Console" src="${nativeUrl}"></iframe>
  </main>`;

const iframe = document.querySelector<HTMLIFrameElement>('#scrypted-console')!;
const liquidGlass = `
  :root { --scryvex-glass: rgba(18, 27, 46, .68); --scryvex-border: rgba(255,255,255,.18); }
  body { background: radial-gradient(circle at top right, #234d9d 0, transparent 35%), #07101f !important; }
  header, nav, aside, .toolbar, [role="toolbar"], [role="navigation"], button, input, select, textarea, dialog, [class*="card"], [class*="panel"] { backdrop-filter: blur(20px) saturate(145%); -webkit-backdrop-filter: blur(20px) saturate(145%); }
  button, input, select, textarea, [class*="card"], [class*="panel"] { border-color: var(--scryvex-border) !important; border-radius: 14px !important; }
  #scryvex-version-badge { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; padding: 7px 10px; border: 1px solid var(--scryvex-border); border-radius: 999px; background: var(--scryvex-glass); color: white; font: 600 12px system-ui; box-shadow: 0 10px 30px #0008; }
`;

function rebrand(doc: Document) {
  if (!doc.head.querySelector('#scryvex-liquid-glass')) {
    const style = doc.createElement('style'); style.id = 'scryvex-liquid-glass'; style.textContent = liquidGlass; doc.head.append(style);
    const badge = doc.createElement('div'); badge.id = 'scryvex-version-badge'; badge.textContent = `Scryvex Pro ${version}`; doc.body.append(badge);
  }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = []; while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) node.data = node.data.replace(/\bScrypted\b/g, 'Scryvex Pro');
}

iframe.addEventListener('load', () => {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    rebrand(doc);
    new MutationObserver(() => rebrand(doc)).observe(doc.body, { childList: true, subtree: true });
  } catch {
    console.warn('Scryvex Pro requiere servirse desde el mismo origen que Scrypted para aplicar la capa visual.');
  }
});
