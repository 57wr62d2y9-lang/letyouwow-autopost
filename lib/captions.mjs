// Per-network captions. Russian text: never the letter «ё» (owner rule).
// Instagram/Threads/TikTok: no prices, no «купить» (keep clear of ad restrictions).

export const HOOKS = [
  'Самое красивое свадебное приглашение 😍',
  'POV: мама открывает ваше приглашение 🥹',
  'Представьте, что гости открывают вот это 💌',
  'Приглашение, которое хочется открыть еще раз 🤍',
  'POV: подруга открывает приглашение на вашу свадьбу 😭',
  'Когда приглашение настолько красивое, что все сохраняют ссылку ✨',
];

const BODY = [
  'Дизайн «{name}». Гости открывают приглашение по ссылке: с музыкой, анимацией и программой дня.',
  'Дизайн «{name}». Приглашение открывается как настоящее письмо, а внутри — ваша история, место и время.',
  'Дизайн «{name}». Одна ссылка вместо бумажных открыток: гости открывают ее с телефона и сразу отвечают, придут ли.',
];

const TAGS = ['#свадьба', '#свадебноеприглашение', '#приглашениенасвадьбу', '#свадьба2027', '#невеста',
  '#жених', '#свадебнаяподготовка', '#электронноеприглашение', '#свадебныеидеи', '#свадьбамечты',
  '#подготовкаксвадьбе', '#приглашение'];

// Stable pseudo-random from a string: same clip + network + day gives the same text on reruns.
export function seed(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (arr, s) => arr[s % arr.length];
function tags(s, n) {
  const out = [], pool = [...TAGS];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice((s >>> i) % pool.length, 1)[0]);
  return out.join(' ');
}

export function withUtm(url, network, clipId) {
  const u = new URL(url);
  u.searchParams.set('utm_source', network);
  u.searchParams.set('utm_medium', 'reels');
  u.searchParams.set('utm_campaign', clipId);
  return u.toString();
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Returns {text, title?, button?} for one network.
export function caption(clip, network, day = '') {
  const s = seed(`${clip.id}|${network}|${day}`);
  const hook = clip.hook || pick(HOOKS, s);
  const body = pick(BODY, s >>> 3).replace('{name}', clip.name);
  const link = withUtm(clip.url, network, clip.id);
  switch (network) {
    case 'instagram':
      return { text: `${hook}\n\n${body}\n\nНапиши WOW в комментариях — пришлем ссылку на этот дизайн в личку 💌\n\n${tags(s, 8)}` };
    case 'vk':
      return {
        title: `${hook} Свадебное приглашение «${clip.name}»`.slice(0, 128),
        text: `${hook}\n\n${body}\n\nПосмотреть приглашение: ${link}\n\nИли напишите WOW в сообщения сообщества — пришлем ссылку.\n\n${tags(s, 5)}`,
      };
    case 'telegram':
      return { text: `<b>${esc(hook)}</b>\n\n${esc(body)}`, button: link };
    case 'threads':
      return { text: `${hook}\n\n${body}\n\nСсылка в профиле.`.slice(0, 500) };
    case 'tiktok':
      return { text: `${hook} ${body} Ссылка в профиле. ${tags(s, 5)}`.slice(0, 2200) };
    default:
      throw new Error(`unknown network ${network}`);
  }
}
