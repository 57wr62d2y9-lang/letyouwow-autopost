// One-time TikTok login: gets a refresh token and stores it encrypted in tokens.enc (never printed).
//   TIKTOK_CLIENT_KEY=… TIKTOK_CLIENT_SECRET=… STATE_KEY=… node tools/tiktok-login.mjs [redirect_uri]
// 1) open the printed link, press «Авторизовать»; 2) TikTok opens redirect_uri?code=…; 3) paste that whole address here.
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTokens, saveTokens } from '../lib/state.mjs';
import { req, form } from '../lib/http.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const { TIKTOK_CLIENT_KEY: key, TIKTOK_CLIENT_SECRET: secret, STATE_KEY } = process.env;
if (!key || !secret || !STATE_KEY) { console.error('Нужны TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET и STATE_KEY'); process.exit(2); }
const redirect = process.argv[2] || 'https://letyouwow.ru/';
const state = randomBytes(8).toString('hex');
const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
Object.entries({ client_key: key, scope: 'user.info.basic,video.publish,video.upload', response_type: 'code', redirect_uri: redirect, state })
  .forEach(([k, v]) => u.searchParams.set(k, v));
console.log(`Откройте и нажмите «Авторизовать»:\n${u}\n`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const back = new URL((await rl.question('Вставьте адрес, на который вас перекинуло: ')).trim());
rl.close();
if (back.searchParams.get('state') !== state) { console.error('Не тот адрес (state не совпал)'); process.exit(1); }
const code = back.searchParams.get('code');
if (!code) { console.error('В адресе нет code'); process.exit(1); }
const r = await req('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: form({ client_key: key, client_secret: secret, code, grant_type: 'authorization_code', redirect_uri: redirect }) }, 'tiktok token');
if (!r.refresh_token) { console.error(`TikTok не выдал токен: ${r.error || ''} ${r.error_description || ''}`); process.exit(1); }
const path = join(DIR, 'tokens.enc');
const tokens = loadTokens(path, STATE_KEY);
tokens.tiktok = { access_token: r.access_token, refresh_token: r.refresh_token, expires_at: new Date(Date.now() + r.expires_in * 1e3).toISOString(), open_id: r.open_id };
saveTokens(path, STATE_KEY, tokens);
console.log(`Готово: вход TikTok сохранен в tokens.enc (права: ${r.scope}).`);
