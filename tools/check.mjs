// Read-only connection check: never posts anything, never prints keys.
//   node tools/check.mjs   (GitHub: Actions → check → Run workflow)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { req } from '../lib/http.mjs';
import { vk as vkApi, storyUploadServer } from '../lib/net/vk.mjs';
import { withUtm } from '../lib/captions.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8'));
const env = process.env;
let bad = 0;
const ok = (net, msg) => console.log(`✅ ${net}: ${msg}`);
const fail = (net, msg) => { bad++; console.log(`❌ ${net}: ${msg}`); };
const skip = (net, msg) => console.log(`— ${net}: ${msg}`);

async function telegram() {
  const t = env.TG_BOT_TOKEN, ch = cfg.networks.telegram.channel;
  if (!t) return (cfg.networks.telegram.enabled ? fail : skip)('telegram', 'нет ключа TG_BOT_TOKEN');
  const api = m => req(`https://api.telegram.org/bot${t}/${m}`, {}, `telegram ${m.split('?')[0]}`);
  const me = await api('getMe');
  if (!me.ok) return fail('telegram', 'ключ не подходит');
  // HTTP 400/403 = no access to the channel; network errors and 429 fall through with their real cause.
  const noAccess = e => { if (/HTTP 40[03]/.test(e.message)) return { ok: false, why: e.message }; throw e; };
  const chat = await api(`getChat?chat_id=${encodeURIComponent(ch)}`).catch(noAccess);
  if (!chat.ok) return fail('telegram', `бот @${me.result.username} не видит канал ${ch} (${chat.why})`);
  const m = await api(`getChatMember?chat_id=${encodeURIComponent(ch)}&user_id=${me.result.id}`).catch(noAccess);
  if (!m.ok || m.result.status !== 'administrator') return fail('telegram', `бот @${me.result.username} не админ в ${ch}`);
  if (!m.result.can_post_messages) return fail('telegram', `бот @${me.result.username} админ в ${ch}, но без права публиковать`);
  ok('telegram', `бот @${me.result.username} может публиковать в «${chat.result.title}» (${ch})`);
}

// VK stories: asks VK for an upload address with our link — VK checks the key, the right and the link; nothing is posted.
async function vk() {
  const c = cfg.networks.vk, t = env.VK_STORIES_TOKEN;
  if (c.mode !== 'stories') return skip('vk', `режим ${c.mode} не проверяется`);
  if (!t) return (c.enabled ? fail : skip)('vk', 'нет ключа VK_STORIES_TOKEN');
  const g = (await vkApi('groups.getById', { group_id: c.groupId }, t)).groups?.[0];
  const s = await storyUploadServer(t, c, withUtm(cfg.catalogUrl, 'vk', 'check'));
  if (!s.upload_url) return fail('vk', 'ВК не дал адрес для загрузки истории');
  ok('vk', `можно выкладывать истории в «${g?.name || c.groupId}» со ссылкой на сайт`);
}

for (const [net, fn] of Object.entries({ telegram, vk })) {
  try { await fn(); } catch (e) { fail(net, e.message); }
}
process.exit(bad ? 1 : 0);
