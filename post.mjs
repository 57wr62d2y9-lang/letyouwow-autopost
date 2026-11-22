// One run = one time slot. Cron calls it every hour; it decides by the schedule whether to post.
//   node post.mjs                — normal run
//   node post.mjs --dry --force  — show what would be posted now, post nothing
//   node post.mjs --force --only=telegram --clip=glicinia-01   — one manual test post
// Secrets come only from env; nothing secret is printed.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caption } from './lib/captions.mjs';
import { slotNow, local } from './lib/schedule.mjs';
import { loadState, saveState, nextClip, countToday, loadTokens, saveTokens } from './lib/state.mjs';
import { scrub } from './lib/http.mjs';
import { postTelegram } from './lib/net/telegram.mjs';
import { postVk } from './lib/net/vk.mjs';
import { postInstagram, postThreads, refreshInstagram, refreshThreads, instagramUserId } from './lib/net/meta.mjs';
import { postTiktok, refreshTiktok } from './lib/net/tiktok.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const arg = n => process.argv.find(a => a === `--${n}` || a.startsWith(`--${n}=`))?.split('=')[1] ?? process.argv.includes(`--${n}`);
const DRY = !!arg('dry'), FORCE = !!arg('force'), ONLY = arg('only'), CLIP = arg('clip');
const env = process.env;
const NETWORKS = ['telegram', 'vk', 'instagram', 'threads', 'tiktok'];
const ROTATING = ['instagram', 'threads', 'tiktok'];

const cfg = JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8'));
const clips = JSON.parse(readFileSync(join(DIR, 'clips/clips.json'), 'utf8'));
const STATE = join(DIR, 'state.json'), TOKENS = join(DIR, 'tokens.enc');
const st = loadState(STATE);
const now = new Date();
const slot = FORCE ? { post: true, reason: 'ручной запуск', ...local(now, cfg.timezoneOffsetHours) } : slotNow(cfg, now);
console.log(`${now.toISOString()} — ${slot.reason}`);
if (!slot.post) process.exit(0);
const { day, hour } = slot;
const mediaUrl = clip => cfg.mediaBaseUrl ? `${cfg.mediaBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(clip.file)}` : '';

let nets = Object.entries(cfg.networks).filter(([n, c]) => c.enabled && (!ONLY || ONLY === n)).map(([n]) => n);
for (const n of nets) if (!NETWORKS.includes(n)) { console.log(`неизвестная сеть в config.json: ${n}`); process.exit(1); }
if (!nets.length) console.log('Ни одна сеть не включена в config.json');

// Rotating tokens live in tokens.enc. If it cannot be opened, skip those networks and never overwrite it.
let tokens = {}, tokensOk = true;
if (!DRY && nets.some(n => ROTATING.includes(n))) {
  if (!env.STATE_KEY) { console.log('STATE_KEY не задан: Instagram, Threads и TikTok пропускаю'); tokensOk = false; }
  else try { tokens = loadTokens(TOKENS, env.STATE_KEY); } catch { console.log('tokens.enc не открылся (другой STATE_KEY?): Instagram, Threads и TikTok пропускаю'); tokensOk = false; }
  if (!tokensOk) nets = nets.filter(n => !ROTATING.includes(n));
}
// A token in a GitHub secret seeds tokens.enc; putting a NEW value into the secret replaces it.
let tokensChanged = false;
const fp = v => createHash('sha256').update(v).digest('hex').slice(0, 16);
for (const [net, name, make] of [
  ['instagram', 'IG_TOKEN', v => ({ access_token: v, refreshed_at: now.toISOString() })],
  ['threads', 'THREADS_TOKEN', v => ({ access_token: v, refreshed_at: now.toISOString() })],
  ['tiktok', 'TIKTOK_REFRESH_TOKEN', v => ({ refresh_token: v })],
]) {
  const v = env[name];
  if (v && tokensOk && tokens[net]?.seed !== fp(v)) { tokens[net] = { ...make(v), seed: fp(v) }; tokensChanged = true; }
}
const older = (iso, days) => !iso || now - Date.parse(iso) > days * 86400e3;

// Clips live in public storage (mediaBaseUrl); fetch only the one needed for this run.
async function download(url, to) {
  const r = await fetch(url, { signal: AbortSignal.timeout(300e3) });
  if (!r.ok) throw new Error(`скачивание ролика: HTTP ${r.status}`);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, Buffer.from(await r.arrayBuffer()));
}

let ok = 0, fail = 0;
for (const net of nets) {
  const ncfg = cfg.networks[net];
  const done = st.posts.some(p => p.network === net && p.ok && !p.manual && p.day === day && p.hour === hour);
  if (done && !FORCE) { console.log(`${net}: слот ${hour}:00 уже выполнен`); continue; }
  if (ncfg.maxPerDay && countToday(st, net, day) >= ncfg.maxPerDay && !FORCE) { console.log(`${net}: дневной лимит ${ncfg.maxPerDay}`); continue; }
  const clip = CLIP ? clips.find(c => c.id === CLIP) : nextClip(clips, st, net, now, cfg.repeatAfterDays ?? 7);
  if (!clip) { console.log(`${net}: нет ролика (все готовые уже выходили за последние ${cfg.repeatAfterDays ?? 7} дней) — пропускаю`); continue; }
  let cap;
  try { cap = caption(clip, net, day); } catch (e) { console.log(`${net}: ✗ ролик ${clip.id}: плохая карточка (${e.message})`); fail++; continue; }
  if (DRY) { console.log(`\n=== ${net} — ${clip.id}\n${cap.title ? `[${cap.title}]\n` : ''}${cap.text}${cap.button ? `\n[кнопка → ${cap.button}]` : ''}`); continue; }
  const file = join(DIR, 'clips/files', clip.file);
  const rec = { network: net, clip: clip.id, at: new Date().toISOString(), day, hour, ...(FORCE ? { manual: true } : {}) };
  try {
    const needsFile = ['telegram', 'vk', 'tiktok'].includes(net);
    if (needsFile && !existsSync(file) && cfg.mediaBaseUrl) await download(mediaUrl(clip), file);
    if (needsFile && !existsSync(file)) throw new Error(`нет файла ${clip.file}`);
    let r;
    if (net === 'telegram') r = await postTelegram({ token: env.TG_BOT_TOKEN, cfg: ncfg, file, cap });
    else if (net === 'vk') r = await postVk({ token: env.VK_USER_TOKEN, cfg: ncfg, file, cap });
    else if (net === 'instagram') {
      if (!tokens.instagram) throw new Error('instagram: нет токена');
      if (older(tokens.instagram.refreshed_at, 7)) { tokens.instagram = await refreshInstagram(tokens.instagram); tokensChanged = true; }
      if (!tokens.instagram.user_id) { tokens.instagram.user_id = ncfg.userId || await instagramUserId(tokens.instagram, cfg.graphVersion); tokensChanged = true; }
      r = await postInstagram({ tok: tokens.instagram, userId: tokens.instagram.user_id, version: cfg.graphVersion, videoUrl: mediaUrl(clip), cap });
    } else if (net === 'threads') {
      if (!tokens.threads) throw new Error('threads: нет токена');
      if (older(tokens.threads.refreshed_at, 7)) { tokens.threads = await refreshThreads(tokens.threads); tokensChanged = true; }
      r = await postThreads({ tok: tokens.threads, videoUrl: mediaUrl(clip), cap });
    } else if (net === 'tiktok') {
      if (!tokens.tiktok) throw new Error('tiktok: нет токена');
      const t = await refreshTiktok(tokens.tiktok, { client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET });
      if (t) { tokens.tiktok = t; tokensChanged = true; saveTokens(TOKENS, env.STATE_KEY, tokens); }
      r = await postTiktok({ tok: tokens.tiktok, cfg: ncfg, file, cap, seconds: clip.seconds });
    }
    Object.assign(rec, { ok: true }, r);
    ok++;
    console.log(`${net}: ✓ ${clip.id} ${r.url || r.id}${r.privacy ? ` (${r.privacy})` : ''}${r.status === 'pending' ? ' — еще обрабатывается' : ''}`);
  } catch (e) {
    // maybePosted: the upload may have gone through — count it, so the clip is not posted twice.
    Object.assign(rec, { ok: !!e.maybePosted, status: e.maybePosted ? 'unknown' : undefined, error: scrub(e.message).slice(0, 300) });
    fail++;
    console.log(`${net}: ✗ ${rec.error}${e.maybePosted ? ' (возможно, все же вышел — повторять не буду)' : ''}`);
  }
  st.posts.push(rec);
  saveState(STATE, st);   // after each network, so a crash never causes a double post
}

if (tokensChanged && tokensOk && !DRY) saveTokens(TOKENS, env.STATE_KEY, tokens);
console.log(`\nИтого: опубликовано ${ok}, ошибок ${fail}`);
process.exit(fail && !ok ? 1 : 0);
