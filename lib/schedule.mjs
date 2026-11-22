// When to post. Moscow hours 8..23. Ramp so new accounts are not flagged as spam:
// week 1 — 3 a day, week 2 — 8 a day, then every hour.
export const RAMP = [
  { untilDay: 7, hours: [10, 15, 20] },
  { untilDay: 14, hours: [8, 10, 12, 14, 16, 18, 20, 22] },
  { untilDay: Infinity, hours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] },
];

// Local (Moscow) calendar parts for a Date.
export function local(now, offsetHours) {
  const d = new Date(now.getTime() + offsetHours * 3600e3);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

export function dayIndex(startDate, today) {
  return Math.round((Date.parse(today) - Date.parse(startDate)) / 86400e3);
}

// The latest planned slot of today that is not in the future. A late cron run (GitHub often
// delays them) still fills the slot it missed; post.mjs skips a slot that is already done.
// Returns {post:boolean, reason, day, hour}
export function slotNow(cfg, now = new Date()) {
  if (!cfg.startDate) return { post: false, reason: 'startDate не задан: система выключена' };
  const { day, hour } = local(now, cfg.timezoneOffsetHours);
  const idx = dayIndex(cfg.startDate, day);
  if (idx < 0) return { post: false, reason: `старт ${cfg.startDate}, еще рано` };
  const step = RAMP.find(r => idx < r.untilDay);
  const slot = step.hours.filter(h => h <= hour).at(-1);
  if (slot === undefined) return { post: false, reason: `до первого слота дня (${step.hours[0]}:00)` };
  return { post: true, reason: `день ${idx + 1}, слот ${slot}:00`, day, hour: slot };
}
