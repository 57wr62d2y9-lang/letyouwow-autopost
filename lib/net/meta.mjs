// Instagram Reels (Instagram API with Instagram Login) and Threads video.
// Both download the clip themselves from a public URL (config.mediaBaseUrl, served as video/mp4).
import { req, form, poll, sent } from '../http.mjs';

const IG = 'https://graph.instagram.com';
const TH = 'https://graph.threads.net/v1.0';
const WAIT = { every: 30e3, max: 6 * 60e3 };

export async function refreshInstagram(tok) {
  const r = await req(`${IG}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tok.access_token)}`, {}, 'instagram refresh');
  return { ...tok, access_token: r.access_token, refreshed_at: new Date().toISOString() };
}
export async function refreshThreads(tok) {
  const r = await req(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(tok.access_token)}`, {}, 'threads refresh');
  return { ...tok, access_token: r.access_token, refreshed_at: new Date().toISOString() };
}

// Instagram professional account id; asked once and kept with the token.
export async function instagramUserId(tok, version) {
  if (tok.user_id) return tok.user_id;
  const r = await req(`${IG}/${version}/me?fields=user_id,username&access_token=${encodeURIComponent(tok.access_token)}`, {}, 'instagram me');
  if (!r.user_id) throw new Error('instagram: не получили id аккаунта');
  return String(r.user_id);
}

export async function postInstagram({ tok, userId, version, videoUrl, cap }) {
  if (!tok?.access_token) throw new Error('instagram: нет токена');
  if (!videoUrl) throw new Error('instagram: нет публичной ссылки на ролик (mediaBaseUrl)');
  const at = tok.access_token;
  const c = await req(`${IG}/${version}/${userId}/media`, { method: 'POST', body: form({ media_type: 'REELS', video_url: videoUrl, caption: cap.text, share_to_feed: true, access_token: at }) }, 'instagram container');
  await poll(async () => {
    const s = await req(`${IG}/${version}/${c.id}?fields=status_code,status&access_token=${encodeURIComponent(at)}`, {}, 'instagram status');
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`instagram: обработка не прошла: ${s.status || s.status_code}`);
    return s.status_code === 'FINISHED';
  }, { ...WAIT, label: 'instagram обработка' });
  const p = await sent(req(`${IG}/${version}/${userId}/media_publish`, { method: 'POST', body: form({ creation_id: c.id, access_token: at }) }, 'instagram publish'));
  return { id: p.id };
}

export async function postThreads({ tok, videoUrl, cap }) {
  if (!tok?.access_token) throw new Error('threads: нет токена');
  if (!videoUrl) throw new Error('threads: нет публичной ссылки на ролик (mediaBaseUrl)');
  const at = tok.access_token;
  const c = await req(`${TH}/me/threads`, { method: 'POST', body: form({ media_type: 'VIDEO', video_url: videoUrl, text: cap.text, access_token: at }) }, 'threads container');
  await poll(async () => {
    const s = await req(`${TH}/${c.id}?fields=status,error_message&access_token=${encodeURIComponent(at)}`, {}, 'threads status');
    if (s.status === 'ERROR' || s.status === 'EXPIRED') throw new Error(`threads: обработка не прошла: ${s.error_message || s.status}`);
    return s.status === 'FINISHED';
  }, { ...WAIT, label: 'threads обработка' });
  const p = await sent(req(`${TH}/me/threads_publish`, { method: 'POST', body: form({ creation_id: c.id, access_token: at }) }, 'threads publish'));
  return { id: p.id };
}
