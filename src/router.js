// Hash router. Each view module exports mount(root, params, query) → dispose.

const routes = [];
let current = null;
let viewRoot = null;
let onNavigate = null;

export function route(pattern, loader, opts = {}) {
  const keys = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/\/:(\w+)/g, (_, k) => {
        keys.push(k);
        return '/([^/]+)';
      }) +
      '/?$'
  );
  routes.push({ re, keys, loader, opts });
}

export function startRouter(root, navigateHook) {
  viewRoot = root;
  onNavigate = navigateHook;
  window.addEventListener('hashchange', render);
  render();
}

export function navigate(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (replace) {
    history.replaceState(null, '', hash);
    render();
  } else if (location.hash === hash) {
    render();
  } else {
    location.hash = hash;
  }
}

export function currentPath() {
  return (location.hash.slice(1) || '/').split('?')[0];
}

export function currentView() {
  return current;
}

let renderToken = 0;

async function render() {
  const token = ++renderToken;
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs ?? ''));
  let match = null;
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      match = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      break;
    }
  }
  if (!match) {
    navigate('/', { replace: true });
    return;
  }
  const mod = await match.r.loader();
  if (token !== renderToken) return;
  if (current?.dispose) {
    try {
      current.dispose();
    } catch (e) {
      console.error(e);
    }
  }
  viewRoot.replaceChildren();
  viewRoot.scrollTop = 0;
  current = { path, opts: match.r.opts, dispose: null, onBack: null };
  onNavigate?.(path, match.r.opts);
  const ctx = current;
  const result = await mod.mount(viewRoot, match.params, query, {
    setBackHandler: (fn) => {
      ctx.onBack = fn;
    },
  });
  if (ctx === current) ctx.dispose = result;
  else if (typeof result === 'function') result();
}
