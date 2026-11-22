// Telegram channel: sendVideo with a link button. Bot must be a channel admin. Bot upload limit 50 MB.
import { req, fileBlob, sent } from '../http.mjs';

export async function postTelegram({ token, cfg, file, cap }) {
  if (!token) throw new Error('telegram: нет TG_BOT_TOKEN');
  const { blob, size } = await fileBlob(file);
  if (size > 50 * 1024 * 1024) throw new Error('telegram: файл больше 50 МБ');
  const f = new FormData();
  f.set('chat_id', cfg.channel);
  f.set('video', blob, 'reel.mp4');
  f.set('caption', cap.text);
  f.set('parse_mode', 'HTML');
  f.set('supports_streaming', 'true');
  f.set('width', '1080'); f.set('height', '1920');
  f.set('reply_markup', JSON.stringify({ inline_keyboard: [[{ text: cfg.button, url: cap.button }]] }));
  const r = await sent(req(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body: f, timeout: 300e3 }, 'telegram'));
  if (!r.ok) throw new Error(`telegram: ${r.description || 'ошибка'}`);
  return { id: String(r.result.message_id) };
}
