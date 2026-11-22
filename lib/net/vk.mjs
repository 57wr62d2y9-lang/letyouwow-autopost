// VK community video. Needs a USER token of a community admin with scopes video, wall, groups (offline).
// mode "video": video.save + wallpost=1 (documented, reliable).
// mode "clip": shortVideo.create (undocumented publicly) — try only after one manual test.
// mode "stories": community story with a «Посмотреть» link. Works with a COMMUNITY key that has the
//   "stories" right (VK gives the "video" right for user keys only on request). A story lives 24 hours.
import { req, form, fileBlob, sent } from '../http.mjs';

const V = '5.199';
export async function vk(method, params, token) {
  const r = await req(`https://api.vk.com/method/${method}`, { method: 'POST', body: form({ ...params, access_token: token, v: V }) }, `vk ${method}`);
  if (r.error) throw new Error(`vk ${method}: ${r.error.error_code} ${r.error.error_msg}`);
  return r.response;
}

// Once the upload has started, VK may finish it even if we lose the answer:
// mark such errors maybePosted so the run does not upload the same clip again.
// publishes=false: the upload alone publishes nothing (stories go live only on stories.save).
async function upload(url, blob, field, publishes = true) {
  const f = new FormData(); f.set(field, blob, 'reel.mp4');
  const p = req(url, { method: 'POST', body: f, timeout: 600e3 }, 'vk upload');
  const r = await (publishes ? sent(p) : p);
  if (r.error) throw new Error(`vk upload: ${typeof r.error === 'string' ? r.error : JSON.stringify(r.error).slice(0, 200)}`);
  return r;
}

// Link check without publishing: VK validates link_url when it hands out the upload address.
export const storyUploadServer = (token, cfg, url) =>
  vk('stories.getVideoUploadServer', { group_id: cfg.groupId, add_to_news: 1, link_text: cfg.linkText || 'view', link_url: url }, token);

export async function postVk({ token, cfg, file, cap }) {
  if (!token) throw new Error(`vk: нет токена (${cfg.mode === 'stories' ? 'VK_STORIES_TOKEN' : 'VK_USER_TOKEN'})`);
  if (!cfg.groupId) throw new Error('vk: не задан groupId');
  const { blob, size } = await fileBlob(file);
  if (cfg.mode === 'stories') {
    if (size > 256 * 1024 * 1024) throw new Error('vk: файл больше 256 МБ');
    const s = await storyUploadServer(token, cfg, cap.button);
    const up = await upload(s.upload_url, blob, 'video_file', false);
    const result = up.response?.upload_result;
    if (!result) throw new Error('vk: ВК не вернул upload_result');
    const r = await sent(vk('stories.save', { upload_results: result }, token));
    // stories.save went through: never throw after this point, or the next slot would post it again.
    const st = r?.items?.[0];
    return st ? { id: `${st.owner_id}_${st.id}`, url: `https://vk.com/story${st.owner_id}_${st.id}` } : { id: 'unknown' };
  }
  if (cfg.mode === 'clip') {
    const r = await vk('shortVideo.create', { group_id: cfg.groupId, file_size: Math.ceil(size / 1024), description: cap.text, wallpost: 1 }, token);
    await upload(r.upload_url, blob, 'file');
    return { id: `${r.owner_id}_${r.video_id}`, url: `https://vk.com/clip${r.owner_id}_${r.video_id}` };
  }
  const s = await vk('video.save', { group_id: cfg.groupId, name: cap.title, description: cap.text, wallpost: 1, repeat: 0 }, token);
  await upload(s.upload_url, blob, 'video_file');
  return { id: `${s.owner_id}_${s.video_id}`, url: `https://vk.com/video${s.owner_id}_${s.video_id}` };
}
