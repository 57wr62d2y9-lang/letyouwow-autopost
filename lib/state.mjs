// state.json — what was posted where (safe to commit, no secrets).
// tokens.enc — rotating access tokens, AES-256-GCM with key from env STATE_KEY (never printed).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function loadState(path) {
  if (!existsSync(path)) return { posts: [] };
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function saveState(path, st) {
  st.posts = st.posts.slice(-5000);
  writeFileSync(path, JSON.stringify(st, null, 1) + '\n');
}

// Next clip for a network: first ready clip never posted there, else the one posted longest ago —
// but never the same clip in the same network more often than every repeatDays (0 = never repeat). null = skip the slot.
export function nextClip(clips, st, network, now = new Date(), repeatDays = 7) {
  const ready = clips.filter(c => c.ready);
  if (!ready.length) return null;
  const last = new Map();
  for (const p of st.posts) if (p.network === network && p.ok && (!last.has(p.clip) || p.at > last.get(p.clip))) last.set(p.clip, p.at);
  const fresh = ready.find(c => !last.has(c.id));
  if (fresh) return fresh;
  if (!repeatDays) return null;   // repeat: false — every clip once, then wait for new ones
  const oldest = [...ready].sort((a, b) => last.get(a.id).localeCompare(last.get(b.id)))[0];
  return now - Date.parse(last.get(oldest.id)) >= repeatDays * 86400e3 ? oldest : null;
}

export function countToday(st, network, day) {
  return st.posts.filter(p => p.network === network && p.ok && p.day === day).length;
}

const keyOf = k => createHash('sha256').update(k).digest();
export function loadTokens(path, key) {
  if (!existsSync(path)) return {};
  if (!key) throw new Error('STATE_KEY не задан');
  const buf = Buffer.from(readFileSync(path, 'utf8'), 'base64');
  const d = createDecipheriv('aes-256-gcm', keyOf(key), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}
export function saveTokens(path, key, tokens) {
  if (!key) throw new Error('STATE_KEY не задан');
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', keyOf(key), iv);
  const body = Buffer.concat([c.update(JSON.stringify(tokens), 'utf8'), c.final()]);
  writeFileSync(path, Buffer.concat([iv, c.getAuthTag(), body]).toString('base64') + '\n');
}
