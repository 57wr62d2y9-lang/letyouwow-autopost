// VK community bot: someone writes «WOW» (or «вау») (in messages or under a post) → gets the design link.
// Runs all the time (Bots Long Poll API). Env: VK_GROUP_TOKEN (community key: messages + wall), VK_GROUP_ID.
// In the community: Управление → Настройки → Работа с API → Long Poll API: включить,
// типы событий: «Входящее сообщение», «Новый комментарий на стене».
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { req, form, sleep, scrub } from './lib/http.mjs';
import { withUtm } from './lib/captions.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
// state.json is written by the GitHub robot; the bot reads the fresh copy from STATE_URL (raw file), else a local one.
const STATE_URL = process.env.STATE_URL || '';
const TOKEN = process.env.VK_GROUP_TOKEN, GROUP = Number(process.env.VK_GROUP_ID);
// wall.getById may refuse a community key; an app service key (optional) is used for it instead.
const SERVICE = process.env.VK_SERVICE_TOKEN || '';
if (!TOKEN || !GROUP) { console.error('Нужны VK_GROUP_TOKEN и VK_GROUP_ID'); process.exit(2); }
const cfg = JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8'));
const KEYWORD = /(^|[^\p{L}])(wow|вау)($|[^\p{L}])/iu;

async function vk(method, params, token = TOKEN) {
  const r = await req(`https://api.vk.com/method/${method}`, { method: 'POST', body: form({ ...params, access_token: token, v: '5.199' }) }, `vk ${method}`);
  if (r.error) { const e = new Error(`vk ${method}: ${r.error.error_code} ${r.error.error_msg}`); e.code = r.error.error_code; throw e; }
  return r.response;
}

// Which design to send: the clip of the post under which the comment was left (its link carries
// utm_campaign=<clip id>), else the latest clip posted to VK, else the catalog.
let cache = { at: 0, st: { posts: [] } };
async function loadState() {
  if (Date.now() - cache.at < 5 * 60e3) return cache.st;
  try {
    cache.st = STATE_URL ? await req(STATE_URL, { timeout: 15e3 }, 'state')
      : existsSync(join(DIR, 'state.json')) ? JSON.parse(readFileSync(join(DIR, 'state.json'), 'utf8')) : { posts: [] };
    cache.at = Date.now();
  } catch (e) { console.log('state:', scrub(e.message)); }
  return cache.st;
}
async function linkFor(postId) {
  try {
    const clips = JSON.parse(readFileSync(join(DIR, 'clips/clips.json'), 'utf8'));
    let id = null;
    if (postId) {
      try {
        const r = await vk('wall.getById', { posts: `-${GROUP}_${postId}` }, SERVICE || TOKEN);
        const post = (Array.isArray(r) ? r : r?.items || [])[0];
        const texts = [post?.text, ...(post?.attachments || []).map(a => a.video?.description || a.video?.title)].join(' ');
        id = texts.match(/utm_campaign=([\w-]+)/)?.[1] || null;
        if (!id) console.log(`пост ${postId}: метка ролика не найдена, шлю последний`);
      } catch (e) { console.log(`пост ${postId}:`, scrub(e.message)); }
    }
    if (!id) id = (await loadState()).posts?.filter(x => x.network === 'vk' && x.ok).at(-1)?.clip;
    const clip = id && clips.find(c => c.id === id);
    if (clip) return { url: withUtm(clip.url, 'vk', clip.id), name: clip.name };
  } catch {}
  return { url: withUtm(cfg.catalogUrl, 'vk', 'bot'), name: null };
}
const text = l => (l.name ? `Вот приглашение «${l.name}» из ролика 💌\n${l.url}` : `Вот все наши свадебные приглашения 💌\n${l.url}`)
  + `\n\nОткройте ссылку с телефона: можно посмотреть демо и сразу собрать свое.`;

const replied = new Set();   // one answer per person per post, until restart
async function onMessage(m) {
  if (!m || m.from_id < 0 || !KEYWORD.test(m.text || '')) return;
  await vk('messages.send', { peer_id: m.peer_id, random_id: Date.now() % 2147483647, message: text(await linkFor()) });
  console.log(`ответ в личку ${m.peer_id}`);
}
async function onComment(c) {
  if (!c || c.from_id < 0 || !KEYWORD.test(c.text || '')) return;
  const key = `${c.from_id}:${c.post_id}`;
  if (replied.has(key)) return;
  replied.add(key);
  const l = await linkFor(c.post_id);
  try {
    await vk('messages.send', { user_id: c.from_id, random_id: Date.now() % 2147483647, message: text(l) });
    await vk('wall.createComment', { owner_id: -GROUP, post_id: c.post_id, reply_to_comment: c.id, from_group: GROUP, message: 'Отправили ссылку в сообщения 💌' });
  } catch (e) {
    // 901/902: the person has not allowed messages from the community — answer right in the comments.
    await vk('wall.createComment', { owner_id: -GROUP, post_id: c.post_id, reply_to_comment: c.id, from_group: GROUP, message: `Вот ссылка 💌 ${l.url}` });
  }
  console.log(`ответ на комментарий ${key}`);
}

for (;;) {
  try {
    let s = await vk('groups.getLongPollServer', { group_id: GROUP });
    console.log('VK бот слушает');
    for (;;) {
      const r = await req(`${s.server}?act=a_check&key=${s.key}&ts=${s.ts}&wait=25`, { timeout: 40e3 }, 'vk longpoll');
      if (r.failed === 1) { s.ts = r.ts; continue; }
      if (r.failed) break;   // 2/3: key expired — get a new server
      s.ts = r.ts;
      for (const u of r.updates || []) {
        try {
          if (u.type === 'message_new') await onMessage(u.object?.message);
          if (u.type === 'wall_reply_new') await onComment(u.object);
        } catch (e) { console.log('ошибка ответа:', scrub(e.message)); }
      }
    }
  } catch (e) {
    console.log('VK бот:', scrub(e.message));
    await sleep(15e3);
  }
}
