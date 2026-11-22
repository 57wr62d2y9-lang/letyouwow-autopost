// TikTok Content Posting API, Direct Post, FILE_UPLOAD (one chunk, up to 64 MB).
// Until TikTok audits the app, only SELF_ONLY (private) posts are allowed.
import { req, form, fileBlob, poll, sent } from '../http.mjs';

const API = 'https://open.tiktokapis.com/v2';
const json = (at, body) => ({ method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body) });
const check = (r, label) => { if (r.error && r.error.code && r.error.code !== 'ok') throw new Error(`${label}: ${r.error.code} ${r.error.message || ''}`); return r.data; };

// tok: {access_token, refresh_token, expires_at}; app: {client_key, client_secret}
export async function refreshTiktok(tok, app) {
  if (tok.access_token && tok.expires_at && Date.parse(tok.expires_at) - Date.now() > 30 * 60e3) return null;
  if (!app.client_key || !app.client_secret) throw new Error('tiktok: нет ключей приложения');
  const r = await req(`${API}/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_key: app.client_key, client_secret: app.client_secret, grant_type: 'refresh_token', refresh_token: tok.refresh_token }) }, 'tiktok refresh');
  if (!r.access_token) throw new Error(`tiktok refresh: ${r.error || 'нет токена'}`);
  return { ...tok, access_token: r.access_token, refresh_token: r.refresh_token || tok.refresh_token, expires_at: new Date(Date.now() + r.expires_in * 1e3).toISOString() };
}

export async function postTiktok({ tok, cfg, file, cap, seconds }) {
  if (!tok?.access_token) throw new Error('tiktok: нет токена');
  const at = tok.access_token;
  const info = check(await req(`${API}/post/publish/creator_info/query/`, json(at, {}), 'tiktok creator'), 'tiktok creator');
  const privacy = info.privacy_level_options?.includes(cfg.privacy) ? cfg.privacy : 'SELF_ONLY';
  if (seconds && info.max_video_post_duration_sec && seconds > info.max_video_post_duration_sec) throw new Error(`tiktok: ролик длиннее ${info.max_video_post_duration_sec} с`);
  const { blob, size } = await fileBlob(file);
  if (size > 64 * 1024 * 1024) throw new Error('tiktok: файл больше 64 МБ (нужна загрузка частями)');
  const init = check(await req(`${API}/post/publish/video/init/`, json(at, {
    post_info: {
      title: cap.text, privacy_level: privacy,
      disable_comment: !!info.comment_disabled, disable_duet: !!info.duet_disabled, disable_stitch: !!info.stitch_disabled,
      video_cover_timestamp_ms: 1500, brand_content_toggle: false, brand_organic_toggle: false,
    },
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 },
  }), 'tiktok init'), 'tiktok init');
  await sent(req(init.upload_url, { method: 'PUT', body: blob, timeout: 600e3, headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${size - 1}/${size}` } }, 'tiktok upload'));
  // From here TikTok publishes on its own. A failed status check must not cause a second upload.
  let status = 'pending';
  try {
    await poll(async () => {
      const s = check(await req(`${API}/post/publish/status/fetch/`, json(at, { publish_id: init.publish_id }), 'tiktok status'), 'tiktok status');
      if (s.status === 'FAILED') throw Object.assign(new Error(`tiktok: ${s.fail_reason || 'не опубликовано'}`), { final: true });
      return s.status === 'PUBLISH_COMPLETE';
    }, { every: 20e3, max: 5 * 60e3, label: 'tiktok обработка' });
    status = 'done';
  } catch (e) { if (e.final) throw e; }
  return { id: init.publish_id, privacy, status };
}
