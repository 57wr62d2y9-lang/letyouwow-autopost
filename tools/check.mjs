// Read-only connection check: never posts anything, never prints keys.
//   node tools/check.mjs   (GitHub: Actions → check → Run workflow)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { req } from '../lib/http.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8'));
const env = process.env;
let bad = 0;
const ok = (net, msg) => console.log(`✅ ${net}: ${msg}`);
const fail = (net, msg) => { bad++; console.log(`❌ ${net}: ${msg}`); };
const skip = (net, msg) => console.log(`— ${net}: ${msg}`);

async function telegram() {
  const t = env.TG_BOT_TOKEN, ch = cfg.networks.telegram.channel;
  if (!t) return skip('telegram', 'нет ключа TG_BOT_TOKEN');
  const api = m => req(`https://api.telegram.org/bot${t}/${m}`, {}, `telegram ${m.split('?')[0]}`);
  const me = await api('getMe');
  if (!me.ok) return fail('telegram', 'ключ не подходит');
  const chat = await api(`getChat?chat_id=${encodeURIComponent(ch)}`).catch(() => ({ ok: false }));
  if (!chat.ok) return fail('telegram', `бот @${me.result.username} не видит канал ${ch}`);
  const m = await api(`getChatMember?chat_id=${encodeURIComponent(ch)}&user_id=${me.result.id}`).catch(() => ({ ok: false }));
  if (!m.ok || m.result.status !== 'administrator') return fail('telegram', `бот @${me.result.username} не админ в ${ch}`);
  if (!m.result.can_post_messages) return fail('telegram', `бот @${me.result.username} админ в ${ch}, но без права публиковать`);
  ok('telegram', `бот @${me.result.username} может публиковать в «${chat.result.title}» (${ch})`);
}

for (const [net, fn] of Object.entries({ telegram })) {
  try { await fn(); } catch (e) { fail(net, e.message); }
}
process.exit(bad ? 1 : 0);
