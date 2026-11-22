// Small fetch helpers. Errors never contain tokens: URLs and bodies are scrubbed.
import { openAsBlob, statSync } from 'node:fs';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
const SECRET_RE = /(access_token|client_secret|refresh_token|token)=[^&\s"]+/gi;
export const scrub = s => String(s).replace(SECRET_RE, '$1=***').replace(/bot\d+:[\w-]+/g, 'bot***');

export async function req(url, opts = {}, label = 'request') {
  let res, text;
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 120e3) });
    text = await res.text();
  } catch (e) {
    throw Object.assign(new Error(`${label}: сеть: ${scrub(e.message)}`), { network: true });
  }
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${scrub(JSON.stringify(data)).slice(0, 400)}`);
  return data;
}

// For a call that may already have published: a lost answer (network error/timeout) means
// «maybe posted» — the run records it as done so the clip is never posted twice.
export const sent = p => p.catch(e => { if (e.network) e.maybePosted = true; throw e; });

export const form = obj => {
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
};

export async function fileBlob(path) {
  return { blob: await openAsBlob(path, { type: 'video/mp4' }), size: statSync(path).size };
}

// Poll fn() until it returns a truthy value or time runs out.
export async function poll(fn, { every = 10e3, max = 10 * 60e3, label = 'ожидание' } = {}) {
  const end = Date.now() + max;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  throw new Error(`${label}: не дождались`);
}
