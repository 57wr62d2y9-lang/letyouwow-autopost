import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caption, HOOKS } from '../lib/captions.mjs';
import { slotNow } from '../lib/schedule.mjs';
import { nextClip, countToday, saveTokens, loadTokens } from '../lib/state.mjs';
import { scrub } from '../lib/http.mjs';

const clip = { id: 'c1', name: 'Глициния', url: 'https://letyouwow.ru/wedding/guest.html?demo=1&style=x&lang=ru', ready: true };
const NETS = ['instagram', 'vk', 'telegram', 'threads', 'tiktok'];

test('captions: no ё, no prices outside VK/TG, limits, utm', () => {
  for (const n of NETS) for (const d of ['2026-12-01', '2026-12-02', '2026-12-03']) {
    const c = caption(clip, n, d);
    assert.ok(!/ё/i.test(c.text + (c.title || '')), `${n} has ё`);
    assert.ok(!/₽|руб|купи/i.test(c.text), `${n} mentions price`);
    if (n === 'threads') assert.ok(c.text.length <= 500);
    if (n === 'vk') { assert.ok(c.title.length <= 128); assert.match(c.text, /utm_source=vk/); }
    if (n === 'instagram') { assert.match(c.text, /WOW/); assert.ok(!/https?:/.test(c.text)); }
    if (n === 'telegram') assert.match(c.button, /utm_source=telegram&utm_medium=reels&utm_campaign=c1/);
  }
  assert.ok(HOOKS.every(h => !/ё/.test(h)));
});

test('captions vary by day, stable on rerun', () => {
  const a = caption(clip, 'instagram', '2026-12-01').text;
  assert.equal(a, caption(clip, 'instagram', '2026-12-01').text);
  const all = new Set(['01', '02', '03', '04', '05'].map(d => caption(clip, 'instagram', `2026-12-${d}`).text));
  assert.ok(all.size > 1);
});

test('schedule ramp 3 -> 8 -> 16 slots a day, Moscow time, late runs fill the missed slot', () => {
  const cfg = { startDate: '2026-12-01', timezoneOffsetHours: 3 };
  const at = (d, h, m = 17) => slotNow(cfg, new Date(`${d}T${String(h).padStart(2, '0')}:${m}:00Z`));
  const slots = d => new Set([...Array(24).keys()].map(h => at(d, h)).filter(s => s.post && s.day === d).map(s => s.hour));
  assert.deepEqual([...slots('2026-12-01')], [10, 15, 20]);
  assert.equal(slots('2026-12-09').size, 8);
  assert.equal(slots('2026-12-20').size, 16);
  assert.equal(slots('2026-11-30').size, 0);
  assert.equal(slotNow({ ...cfg, startDate: null }).post, false);
  // 07:17 UTC = 10:17 MSK -> slot 10; a run delayed to 11:40 MSK still belongs to slot 10
  assert.equal(at('2026-12-01', 7).hour, 10);
  assert.equal(at('2026-12-01', 8, 40).hour, 10);
  // 06:17 UTC = 9:17 MSK, before the first week-1 slot
  assert.equal(at('2026-12-01', 6).post, false);
});

test('nextClip: fresh first, then the oldest, never more often than repeatDays; skips not-ready', () => {
  const clips = [{ id: 'a', ready: true }, { id: 'b', ready: true }, { id: 'c', ready: false }];
  const st = { posts: [{ network: 'vk', clip: 'a', ok: true, at: '2026-12-01T10:00:00Z', day: '2026-12-01' }] };
  const t = new Date('2026-12-01T12:00:00Z');
  assert.equal(nextClip(clips, st, 'vk', t).id, 'b');
  assert.equal(nextClip(clips, st, 'telegram', t).id, 'a');
  st.posts.push({ network: 'vk', clip: 'b', ok: true, at: '2026-12-01T11:00:00Z', day: '2026-12-01' });
  assert.equal(nextClip(clips, st, 'vk', t), null);                       // both used today -> skip slot
  assert.equal(nextClip(clips, st, 'vk', new Date('2026-12-08T10:30:00Z')).id, 'a');  // a week later -> oldest
  st.posts.push({ network: 'vk', clip: 'a', ok: false, at: '2026-12-01T12:00:00Z', day: '2026-12-01' });
  assert.equal(countToday(st, 'vk', '2026-12-01'), 2);
  assert.equal(nextClip([{ id: 'x', ready: false }], st, 'vk', t), null);
  assert.equal(nextClip(clips, st, 'vk', new Date('2026-12-08T10:30:00Z'), 0), null);   // repeat: false -> never again
});

test('tokens round-trip encrypted; wrong key fails', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'ap-')), 'tokens.enc');
  saveTokens(p, 'k1', { tiktok: { refresh_token: 'secret-value' } });
  assert.equal(loadTokens(p, 'k1').tiktok.refresh_token, 'secret-value');
  assert.throws(() => loadTokens(p, 'k2'));
});

test('scrub hides tokens', () => {
  assert.equal(scrub('https://x/?access_token=abc123&v=1'), 'https://x/?access_token=***&v=1');
  assert.equal(scrub('https://api.telegram.org/bot123:AAbb-cc/sendVideo'), 'https://api.telegram.org/bot***/sendVideo');
});
