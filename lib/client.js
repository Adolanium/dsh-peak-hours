/**
 * dsh-peak-hours — browser half.
 *
 * Contributes one badge to `conversation.input.right`, just left of the model
 * selector, plus a detail popover anchored to it. Everything is computed from
 * the local clock: no Host route, no network, no persistence.
 *
 * This is DeepSeek pricing information, so the badge renders only while the
 * Session's effective model selection is served by DeepSeek's own API. The
 * composer's model directory supplies that selection (including the catalog
 * default before a Session picks a model); a third-party provider never gets a
 * half-price claim it cannot honour.
 *
 * The pricing model implemented here is DeepSeek's published schedule:
 * peak is 01:00–04:00 and 06:00–10:00 UTC, Monday through Friday, excluding
 * Chinese public holidays; every other hour is off-peak at half the peak rate.
 * The schedule is evaluated on the Beijing calendar (the source of the policy)
 * and rendered in the viewer's own timezone.
 *
 * Plain JavaScript on purpose: the Host serves this file as the package's
 * `dsh.client` bundle, so it is hand-written in the module-loader factory form
 * instead of being compiled from JSX.
 */
window.__ModuleLoader__.load({
  id: 'dsh-peak-hours',
  factory: (require) => {
    'use strict'

    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // ═══════════════════════════════════════════════════════════════════════
    // Engine — pure, clock-in / state-out.
    // ═══════════════════════════════════════════════════════════════════════

    const NS = 'plugin.peakHours'
    const MINUTE = 60_000
    const DAY = 86_400_000
    const POLICY_ZONE = 'Asia/Shanghai'
    const FALLBACK_ZONE = 'Asia/Shanghai'

    /** Peak windows as minutes from UTC midnight: 01:00–04:00, 06:00–10:00. */
    const PEAK_WINDOWS = [[60, 240], [360, 600]]

    /**
     * Provider routes served by DeepSeek's own API — the only routes the
     * published peak / off-peak schedule prices. `deepseek-official` is the
     * direct API-key route and `deepseek-account` the direct account route;
     * third-party providers and gateways that merely host a DeepSeek model
     * bill on their own terms and must not inherit this badge.
     */
    const DIRECT_PROVIDERS = ['deepseek-official', 'deepseek-account']

    /**
     * Chinese public holidays, 2026 — 国务院办公厅关于2026年部分节假日安排的通知
     * (国办发明电〔2025〕7号). Peak pricing is suspended for the whole of each
     * listed day; make-up weekend workdays (Feb 14, Feb 28, May 9, Sep 20,
     * Oct 10) remain weekends for pricing because the policy is Mon–Fri.
     *
     * @type {Record<string, string>}
     */
    const HOLIDAYS = Object.assign(
      {},
      holidaySpan('2026-01-01', 3, 'newYear'),
      holidaySpan('2026-02-15', 9, 'springFestival'),
      holidaySpan('2026-04-04', 3, 'qingming'),
      holidaySpan('2026-05-01', 5, 'labourDay'),
      holidaySpan('2026-06-19', 3, 'dragonBoat'),
      holidaySpan('2026-09-25', 3, 'midAutumn'),
      holidaySpan('2026-10-01', 7, 'nationalDay'),
    )

    function pad(n) {
      return n < 10 ? `0${n}` : String(n)
    }

    function dayKey(year, month, day) {
      return `${year}-${pad(month)}-${pad(day)}`
    }

    /** Expand one contiguous holiday block into a date-keyed map. */
    function holidaySpan(startIso, days, name) {
      const [year, month, day] = startIso.split('-').map(Number)
      const out = {}
      for (let i = 0; i < days; i += 1) {
        const date = new Date(Date.UTC(year, month - 1, day + i))
        out[dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())] = name
      }
      return out
    }

    const formatterCache = new Map()

    function formatter(zone, options) {
      const key = `${zone}|${JSON.stringify(options)}`
      let cached = formatterCache.get(key)
      if (cached === undefined) {
        cached = new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options })
        formatterCache.set(key, cached)
      }
      return cached
    }

    /**
     * Wall-clock parts of one instant in a zone. Throws on an unknown zone, which
     * is exactly the signal `resolveZone` uses to fall back.
     */
    function partsInZone(ms, zone) {
      const parts = formatter(zone, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      }).formatToParts(new Date(ms))
      const out = {}
      for (const part of parts) {
        if (part.type !== 'literal') out[part.type] = part.value
      }
      return {
        year: Number(out.year),
        month: Number(out.month),
        day: Number(out.day),
        hour: Number(out.hour),
        minute: Number(out.minute),
        second: Number(out.second),
        weekday: out.weekday,
      }
    }

    /** The viewer's zone when the runtime exposes one, otherwise null. */
    function detectZone() {
      try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
        if (typeof zone === 'string' && zone !== '') {
          partsInZone(Date.now(), zone)
          return zone
        }
      } catch {
        // No usable zone: fall through to Beijing.
      }
      return null
    }

    /**
     * Resolve a requested zone, falling back to Beijing time. The fallback is a
     * real product rule, not an error path: every deep-link in the pricing docs
     * is expressed in Beijing/UTC, so a viewer without a usable zone still gets
     * a truthful schedule.
     */
    function resolveZone(requested) {
      if (typeof requested === 'string' && requested.trim() !== '') {
        try {
          partsInZone(Date.now(), requested.trim())
          return { zone: requested.trim(), fallback: false }
        } catch {
          // Invalid IANA id.
        }
      }
      return { zone: FALLBACK_ZONE, fallback: true }
    }

    /**
     * The instant whose wall clock in `zone` reads the given civil time.
     * Iterated twice so a DST offset change between guess and target settles.
     */
    function instantFromWall(zone, year, month, day, hour, minute) {
      const target = Date.UTC(year, month - 1, day, hour, minute)
      let guess = target
      for (let i = 0; i < 4; i += 1) {
        const parts = partsInZone(guess, zone)
        const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
        const offset = asUtc - guess
        const next = target - offset
        if (next === guess) break
        guess = next
      }
      return guess
    }

    /** The local civil day containing `ms`, as [start, end) instants. */
    function localDay(ms, zone) {
      const parts = partsInZone(ms, zone)
      const start = instantFromWall(zone, parts.year, parts.month, parts.day, 0, 0)
      const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1))
      const end = instantFromWall(
        zone,
        next.getUTCFullYear(),
        next.getUTCMonth() + 1,
        next.getUTCDate(),
        0,
        0,
      )
      return { start, end: end > start ? end : start + DAY }
    }

    function weekdayOfUtcDate(year, month, day) {
      return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    }

    /**
     * Peak windows that begin on one UTC date. For the 01:00–10:00 UTC windows
     * the UTC date and the Beijing date coincide, so the weekday and holiday
     * checks are the policy's own calendar.
     */
    function peakWindowsOnDate(year, month, day) {
      const weekday = weekdayOfUtcDate(year, month, day)
      if (weekday === 0 || weekday === 6) return []
      if (HOLIDAYS[dayKey(year, month, day)] !== undefined) return []
      const midnight = Date.UTC(year, month - 1, day)
      return PEAK_WINDOWS.map(([from, to]) => ({
        start: midnight + from * MINUTE,
        end: midnight + to * MINUTE,
      }))
    }

    /** Every peak window overlapping [fromMs, toMs), untrimmed. */
    function peakWindowsBetween(fromMs, toMs) {
      const out = []
      const first = fromMs - DAY
      const days = Math.ceil((toMs - first) / DAY) + 1
      for (let i = 0; i < days; i += 1) {
        const date = new Date(first + i * DAY)
        const windows = peakWindowsOnDate(
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          date.getUTCDate(),
        )
        for (const window of windows) {
          if (window.start < toMs && window.end > fromMs) out.push(window)
        }
      }
      return out
    }

    /** Earliest peak start strictly after `ms`. */
    function nextPeakStart(ms) {
      const bj = partsInZone(ms, POLICY_ZONE)
      const base = Date.UTC(bj.year, bj.month - 1, bj.day)
      for (let i = 0; i < 21; i += 1) {
        const date = new Date(base + i * DAY)
        const windows = peakWindowsOnDate(
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          date.getUTCDate(),
        )
        for (const window of windows) {
          if (window.start > ms) return window.start
        }
      }
      return null
    }

    /** Latest peak end at or before `ms`. */
    function previousPeakEnd(ms) {
      const bj = partsInZone(ms, POLICY_ZONE)
      const base = Date.UTC(bj.year, bj.month - 1, bj.day)
      for (let i = 0; i < 21; i += 1) {
        const date = new Date(base - i * DAY)
        const windows = peakWindowsOnDate(
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          date.getUTCDate(),
        )
        for (let j = windows.length - 1; j >= 0; j -= 1) {
          if (windows[j].end <= ms) return windows[j].end
        }
      }
      return ms - DAY
    }

    /** The canonical weekday whose windows describe "a normal day" locally. */
    function scheduleWindows(ms) {
      const bj = partsInZone(ms, POLICY_ZONE)
      const base = Date.UTC(bj.year, bj.month - 1, bj.day)
      for (let i = 0; i < 14; i += 1) {
        const date = new Date(base + i * DAY)
        const windows = peakWindowsOnDate(
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          date.getUTCDate(),
        )
        if (windows.length > 0) return windows
      }
      return []
    }

    function clipToDay(windows, day) {
      return windows
        .map((window) => ({
          start: Math.max(window.start, day.start),
          end: Math.min(window.end, day.end),
        }))
        .filter((window) => window.end > window.start)
    }

    /**
     * Resolve the current pricing window.
     *
     * @param {number} nowMs - epoch milliseconds.
     * @param {{zone?: string|null, locale?: string}} [options]
     * @returns {object} a plain, render-ready snapshot.
     */
    function state(nowMs, options = {}) {
      const resolved = resolveZone(options.zone)
      const zone = resolved.zone
      const locale = typeof options.locale === 'string' ? options.locale : 'en'
      const bj = partsInZone(nowMs, POLICY_ZONE)
      const bjKey = dayKey(bj.year, bj.month, bj.day)
      const holidayKey = HOLIDAYS[bjKey] || null
      const weekend = bj.weekday === 'Sat' || bj.weekday === 'Sun'

      const utcMidnight = Math.floor(nowMs / DAY) * DAY
      const utcMinute = Math.floor((nowMs - utcMidnight) / MINUTE)
      let phase = 'off-peak'
      let periodStart = null
      let periodEnd = null

      if (!weekend && holidayKey === null) {
        for (const [from, to] of PEAK_WINDOWS) {
          if (utcMinute >= from && utcMinute < to) {
            phase = 'peak'
            periodStart = utcMidnight + from * MINUTE
            periodEnd = utcMidnight + to * MINUTE
            break
          }
        }
      }

      if (phase === 'off-peak') {
        periodEnd = nextPeakStart(nowMs)
        periodStart = previousPeakEnd(nowMs)
      }
      if (periodEnd === null) periodEnd = nowMs + DAY
      if (periodStart === null || periodStart >= periodEnd) periodStart = periodEnd - DAY

      const periodMs = Math.max(1, periodEnd - periodStart)
      const remainingMs = Math.max(0, periodEnd - nowMs)
      const progress = Math.min(1, Math.max(0, (nowMs - periodStart) / periodMs))

      const reason = holidayKey !== null ? 'holiday' : weekend ? 'weekend' : 'weekday'
      const day = localDay(nowMs, zone)
      const todayPeaks = clipToDay(peakWindowsBetween(day.start, day.end), day)

      return {
        now: nowMs,
        zone,
        fallback: resolved.fallback,
        locale,
        phase,
        reason,
        holidayKey,
        periodStart,
        periodEnd,
        remainingMs,
        periodMs,
        progress,
        localDay: day,
        todayPeaks,
        schedule: scheduleWindows(nowMs),
        offsetLabel: offsetLabel(nowMs, zone),
      }
    }

    function offsetLabel(ms, zone) {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          timeZoneName: 'shortOffset',
        }).formatToParts(new Date(ms))
        const name = parts.find((part) => part.type === 'timeZoneName')
        return name === undefined ? '' : name.value
      } catch {
        return ''
      }
    }

    /** "2h 14m", "43m", "12s" — the badge form. */
    function formatShort(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      if (hours >= 24) {
        const days = Math.floor(hours / 24)
        const rest = hours % 24
        return rest === 0 ? `${days}d` : `${days}d ${rest}h`
      }
      if (hours > 0) return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
      if (minutes > 0) return `${minutes}m`
      return `${seconds}s`
    }

    /** "2h 14m 08s", "43m 12s", "48s" — the popover form. */
    function formatLong(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      if (hours >= 24) {
        const days = Math.floor(hours / 24)
        const rest = hours % 24
        return rest === 0 ? `${days}d` : `${days}d ${rest}h`
      }
      if (hours > 0) return minutes === 0 ? `${hours}h` : `${hours}h ${pad(minutes)}m`
      if (minutes > 0) return seconds === 0 ? `${minutes}m` : `${minutes}m ${pad(seconds)}s`
      return `${seconds}s`
    }

    function formatClock(ms, zone, locale) {
      try {
        return new Intl.DateTimeFormat(locale, {
          timeZone: zone,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(ms))
      } catch {
        return '--:--'
      }
    }

    function formatDay(ms, zone, locale) {
      try {
        return new Intl.DateTimeFormat(locale, {
          timeZone: zone,
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }).format(new Date(ms))
      } catch {
        return ''
      }
    }

    /** "today", "tomorrow", or a short date. */
    function relativeDay(ms, nowMs, zone, locale) {
      const a = partsInZone(ms, zone)
      const b = partsInZone(nowMs, zone)
      const da = Date.UTC(a.year, a.month - 1, a.day)
      const db = Date.UTC(b.year, b.month - 1, b.day)
      if (da === db) return 'today'
      if (da - db === DAY) return 'tomorrow'
      return formatDay(ms, zone, locale)
    }

    const engine = {
      state,
      detectZone,
      resolveZone,
      formatShort,
      formatLong,
      formatClock,
      formatDay,
      relativeDay,
      peakWindowsOnDate,
      peakWindowsBetween,
      nextPeakStart,
      previousPeakEnd,
      localDay,
      HOLIDAYS,
      PEAK_WINDOWS,
      POLICY_ZONE,
      FALLBACK_ZONE,
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Copy.
    // ═══════════════════════════════════════════════════════════════════════

    const en = {
      'pill.peak': 'Peak',
      'pill.offPeak': 'Off-peak',
      'pill.aria': '{state}: {time} {until}. Open the pricing window details.',
      'until.peak': 'until peak',
      'until.offPeak': 'until off-peak',
      'chip.peak': 'Peak rate',
      'chip.offPeak': 'Half rate',
      'panel.title': 'DeepSeek pricing window',
      'panel.left': 'Left',
      'panel.peakHours': 'Peak hours, your time',
      'panel.today': 'Today',
      'panel.weekend': 'Weekend',
      'panel.weekday': 'Weekday',
      'panel.allDay': 'off-peak all day',
      'panel.peakStartsAt': 'Peak starts {when} at {time}',
      'panel.offPeakStartsAt': 'Off-peak starts at {time}',
      'panel.beijing': 'Beijing',
      'panel.fallback': 'Beijing time · fallback',
      'time.today': 'today',
      'time.tomorrow': 'tomorrow',
      'holiday.newYear': "New Year's Day",
      'holiday.springFestival': 'Spring Festival',
      'holiday.qingming': 'Qingming',
      'holiday.labourDay': 'Labour Day',
      'holiday.dragonBoat': 'Dragon Boat',
      'holiday.midAutumn': 'Mid-Autumn',
      'holiday.nationalDay': 'National Day',
    }

    const zh = {
      'pill.peak': '高峰',
      'pill.offPeak': '低谷',
      'pill.aria': '{state}：{time} {until}。打开计价时段详情。',
      'until.peak': '后进入高峰',
      'until.offPeak': '后进入低谷',
      'chip.peak': '高峰价',
      'chip.offPeak': '半价',
      'panel.title': 'DeepSeek 计价时段',
      'panel.left': '剩余',
      'panel.peakHours': '高峰时段（本地时间）',
      'panel.today': '今天',
      'panel.weekend': '周末',
      'panel.weekday': '工作日',
      'panel.allDay': '全天低谷',
      'panel.peakStartsAt': '高峰于{when} {time} 开始',
      'panel.offPeakStartsAt': '低谷于 {time} 开始',
      'panel.beijing': '北京',
      'panel.fallback': '北京时间 · 回退',
      'time.today': '今天',
      'time.tomorrow': '明天',
      'holiday.newYear': '元旦',
      'holiday.springFestival': '春节',
      'holiday.qingming': '清明',
      'holiday.labourDay': '劳动节',
      'holiday.dragonBoat': '端午',
      'holiday.midAutumn': '中秋',
      'holiday.nationalDay': '国庆',
    }

    function interpolate(template, params) {
      if (params === undefined || params === null) return template
      return template.replace(/\{(\w+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match,
      )
    }

    function fallbackT(key, params) {
      return interpolate(en[key] !== undefined ? en[key] : key, params)
    }

    function browserLocale() {
      try {
        return navigator.language || 'en'
      } catch {
        return 'en'
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Styles. Theme tokens only; the artwork is the SVG dial.
    // ═══════════════════════════════════════════════════════════════════════

    const CSS = `
.dshph{
  --dshph-accent: var(--dsw-alias-state-success-primary, #22c55e);
  --dshph-accent-soft: var(--dsw-alias-state-success-secondary, #4ed17e);
  --dshph-window: var(--dsw-alias-state-warn-primary, #f59e0b);
  --dshph-window-soft: var(--dsw-alias-state-warn-secondary, #f7ad31);
  --dshph-track: var(--dsw-alias-border-l3, rgba(127,127,127,.22));
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
}
.dshph[data-phase="peak"]{
  --dshph-accent: var(--dsw-alias-state-warn-primary, #f59e0b);
  --dshph-accent-soft: var(--dsw-alias-state-warn-secondary, #f7ad31);
}

.dshph-pill{
  -webkit-appearance: none;
  appearance: none;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px 0 6px;
  margin: 0;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.09));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 72%, transparent);
  color: var(--dsw-alias-label-primary, #111111);
  font-family: var(--dsw-font-family, inherit);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: .002em;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  transition: background-color .16s ease, border-color .16s ease, box-shadow .2s ease;
}
.dshph-pill:hover{
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-3, #f4f4f5) 86%, transparent);
  border-color: var(--dsw-alias-border-l3, rgba(0,0,0,.16));
}
.dshph-pill[aria-expanded="true"]{
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-3, #f4f4f5) 92%, transparent);
  border-color: color-mix(in srgb, var(--dshph-accent) 34%, var(--dsw-alias-border-l2, transparent));
}
.dshph-pill:focus-visible{
  outline: none;
  box-shadow: 0 0 0 var(--dsw-focus-ring-width, 2px) var(--dsw-focus-ring-color, #4176e6);
}
.dshph[data-phase="peak"] .dshph-pill{
  border-color: color-mix(in srgb, var(--dshph-accent) 26%, var(--dsw-alias-border-l2, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dshph-accent) 8%, transparent);
}

.dshph-ring{ display:block; flex:none; overflow:visible; }
.dshph-ring .dshph-arc{ transition: stroke-dashoffset 1s linear; }

.dshph-label{
  color: var(--dsw-alias-label-primary, #111111);
  font-weight: 550;
}
.dshph-sep{
  width: 1px;
  height: 9px;
  background: var(--dsw-alias-border-l3, rgba(0,0,0,.16));
  flex: none;
}
.dshph-time{
  color: var(--dsw-alias-label-secondary, #666666);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  min-width: 34px;
  text-align: right;
}

.dshph-panel{
  position: fixed;
  z-index: 9999;
  box-sizing: border-box;
  width: 328px;
  max-width: calc(100vw - 20px);
  padding: 14px 16px 11px;
  border-radius: 18px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.09));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 93%, transparent);
  color: var(--dsw-alias-label-primary, #111111);
  font-family: var(--dsw-font-family, inherit);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.045),
    var(--dsw-elevation-panel, 0 22px 56px -16px rgba(15,17,21,.32), 0 3px 12px rgba(15,17,21,.08));
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  transform-origin: var(--dshph-origin, bottom right);
  animation: dshph-in .16s cubic-bezier(.2,.8,.2,1);
}
@keyframes dshph-in{
  from{ opacity:0; transform: translateY(4px) scale(.985); }
  to{ opacity:1; transform: none; }
}

.dshph-head{ display:flex; align-items:center; gap:8px; }
.dshph-dot{
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--dshph-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dshph-accent) 14%, transparent);
}
.dshph[data-phase="peak"] .dshph-dot{ animation: dshph-breathe 2.8s ease-in-out infinite; }
@keyframes dshph-breathe{
  50%{ box-shadow: 0 0 0 6px color-mix(in srgb, var(--dshph-accent) 5%, transparent); }
}
.dshph-state{
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -.012em;
}
.dshph-chip{
  margin-left: auto;
  padding: 4px 7px 3px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--dshph-accent) 11%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dshph-accent) 15%, transparent);
  color: var(--dshph-accent);
  font-size: 9px;
  font-weight: 650;
  line-height: 1;
  letter-spacing: .075em;
  text-transform: uppercase;
}

.dshph-dial{
  position: relative;
  width: 132px;
  height: 132px;
  margin: 9px auto 1px;
}
.dshph-dial svg{ display:block; }
.dshph-center{
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  pointer-events: none;
  text-align: center;
}
.dshph-count{
  font-size: 21px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -.022em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
.dshph-sub{
  font-size: 9px;
  font-weight: 550;
  line-height: 1;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary, #999999);
}

.dshph-next{
  margin-top: 7px;
  text-align: center;
  font-size: 11px;
  line-height: 1.35;
  color: var(--dsw-alias-label-secondary, #666666);
}
.dshph-rule{
  height: 1px;
  margin: 12px 0 9px;
  background: var(--dsw-alias-border-l1, rgba(0,0,0,.06));
}
.dshph-rows{ margin: 0; }
.dshph-row{
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
  padding: 2.5px 0;
}
.dshph-row dt{
  margin: 0;
  flex: none;
  font-size: 10px;
  letter-spacing: .01em;
  color: var(--dsw-alias-label-tertiary, #999999);
}
.dshph-row dd{
  margin: 0;
  font-size: 11px;
  line-height: 1.35;
  text-align: right;
  color: var(--dsw-alias-label-primary, #111111);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}
.dshph-foot{
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));
  font-size: 10px;
  letter-spacing: .012em;
  color: var(--dsw-alias-label-tertiary, #999999);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 700px){
  .dshph-label{ display:none; }
  .dshph-sep{ display:none; }
  .dshph-time{ min-width: 0; }
}
@media (max-width: 560px){
  .dshph-time{ display:none; }
  .dshph-pill{ padding: 0 5px; }
}
@media (prefers-reduced-motion: reduce){
  .dshph-panel{ animation: none; }
  .dshph[data-phase="peak"] .dshph-dot{ animation: none; }
  .dshph-ring .dshph-arc{ transition: none; }
  .dshph-pill{ transition: none; }
}
`

    // ═══════════════════════════════════════════════════════════════════════
    // Selection — which provider is the composer set to?
    // ═══════════════════════════════════════════════════════════════════════

    /** Whether one provider route is billed by DeepSeek's own schedule. */
    function isDirectProvider(providerId) {
      return typeof providerId === 'string' && DIRECT_PROVIDERS.includes(providerId)
    }

    /** Selected provider id from a directory snapshot, or null while unknown. */
    function providerOf(snapshot) {
      if (snapshot === null || snapshot === undefined) return null
      const current = snapshot.current
      if (current === null || current === undefined) return null
      return typeof current.provider === 'string' ? current.provider : null
    }

    /**
     * The Session's shared model-directory store — the same store the composer
     * model selector renders from. Unknown Sessions and addressed subagent
     * Sessions resolve no directory; the badge then stays out of the way.
     * Resolved on every render because a Session binding can land after mount.
     */
    function resolveDirectory(modelDirectories, sessionId) {
      if (modelDirectories === undefined || modelDirectories === null) return null
      if (sessionId === undefined || sessionId === null) return null
      try {
        const directory = modelDirectories.directoryFor(sessionId)
        return directory === null || directory === undefined ? null : directory.store
      } catch {
        // No binding yet (or an unroutable Session): no selection to report.
        return null
      }
    }

    /** Live snapshot of one model directory, or null while there is none. */
    function useDirectorySnapshot(directory) {
      const subscribe = React.useCallback(
        (notify) => (directory === null ? () => {} : directory.subscribe(notify)),
        [directory],
      )
      const read = React.useCallback(
        () => (directory === null ? null : directory.getSnapshot()),
        [directory],
      )
      return React.useSyncExternalStore(subscribe, read, () => null)
    }

    /**
     * Fallback for a client that predates the `useProjection` standard prop.
     * It intentionally touches no hooks, so the caller's hook order is stable.
     */
    function useNoProjection() {
      return undefined
    }

    /**
     * The provider route the composer is currently set to use. The directory's
     * `current` is the effective selection — the user's pick, or the catalog
     * default before the Session has picked one — which is exactly what the
     * model selector shows. The durable projection covers the case where the
     * catalog cannot be read but the Session still remembers its selection.
     *
     * @param {object} props - Session standard props plus the injected service.
     * @returns {string|null} a provider id, or null while it is unknown.
     */
    function useSelectedProvider(props) {
      const directory = resolveDirectory(props.modelDirectories, props.sessionId)
      const directoryState = useDirectorySnapshot(directory)
      const useProjection =
        typeof props.useProjection === 'function' ? props.useProjection : useNoProjection
      const projected = useProjection('modelSelection')

      const fromDirectory = providerOf(directoryState)
      if (fromDirectory !== null) return fromDirectory

      if (projected === null || projected === undefined) return null
      const next = projected.next
      if (next === null || next === undefined) return null
      return typeof next.provider === 'string' ? next.provider : null
    }

    // ═══════════════════════════════════════════════════════════════════════
    // React surface.
    // ═══════════════════════════════════════════════════════════════════════

    const useLayout = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect

    function useNow(intervalMs) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(timer)
      }, [intervalMs])
      return now
    }

    function polar(cx, cy, radius, degrees) {
      const radians = ((degrees - 90) * Math.PI) / 180
      return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)]
    }

    function arcPath(cx, cy, radius, fromDeg, toDeg) {
      const sweep = toDeg - fromDeg
      const [sx, sy] = polar(cx, cy, radius, fromDeg)
      const [ex, ey] = polar(cx, cy, radius, toDeg)
      const large = sweep > 180 ? 1 : 0
      return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`
    }

    function Ring({ progress }) {
      const radius = 6.1
      const circumference = 2 * Math.PI * radius
      const offset = circumference * Math.min(1, Math.max(0, progress))
      return h(
        'svg',
        {
          className: 'dshph-ring',
          width: 18,
          height: 18,
          viewBox: '0 0 18 18',
          'aria-hidden': true,
          focusable: false,
        },
        [
          h('circle', {
            key: 'track',
            cx: 9,
            cy: 9,
            r: radius,
            fill: 'none',
            stroke: 'var(--dshph-track)',
            strokeWidth: 2,
          }),
          h('circle', {
            key: 'arc',
            className: 'dshph-arc',
            cx: 9,
            cy: 9,
            r: radius,
            fill: 'none',
            stroke: 'var(--dshph-accent)',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeDasharray: circumference.toFixed(2),
            strokeDashoffset: offset.toFixed(2),
            transform: 'rotate(-90 9 9)',
          }),
          h('circle', {
            key: 'core',
            cx: 9,
            cy: 9,
            r: 1.55,
            fill: 'var(--dshph-accent)',
          }),
        ],
      )
    }

    /**
     * The 24-hour face: the viewer's own civil day as a ring, with every peak
     * window painted in amber and a live marker for now. It is directional, not
     * a metrology instrument — the exact times live in the rows below it.
     */
    function Dial({ state: snapshot }) {
      const size = 132
      const cx = size / 2
      const cy = size / 2
      const radius = size / 2 - 12
      const span = Math.max(1, snapshot.localDay.end - snapshot.localDay.start)
      const angle = (ms) => ((ms - snapshot.localDay.start) / span) * 360
      const gradientId = `dshph-grad-${React.useId ? React.useId().replace(/[^a-zA-Z0-9_-]/g, '') : 'x'}`

      const segments = []
      for (const window of snapshot.todayPeaks) {
        const from = Math.max(0, Math.min(360, angle(window.start)))
        const to = Math.max(0, Math.min(360, angle(window.end)))
        if (to - from > 0.4) segments.push({ from, to })
      }

      const nowAngle = angle(snapshot.now)
      const [mx, my] = polar(cx, cy, radius, nowAngle)

      const ticks = []
      for (let hour = 0; hour < 24; hour += 2) {
        const degrees = (hour / 24) * 360
        const major = hour % 6 === 0
        const [x1, y1] = polar(cx, cy, radius + 4.5, degrees)
        const [x2, y2] = polar(cx, cy, radius + (major ? 8.5 : 6.5), degrees)
        ticks.push(
          h('line', {
            key: `tick-${hour}`,
            x1,
            y1,
            x2,
            y2,
            stroke: 'var(--dsw-alias-border-l3, rgba(0,0,0,.16))',
            strokeWidth: major ? 1.5 : 1,
            strokeLinecap: 'round',
            opacity: major ? 1 : 0.55,
          }),
        )
      }

      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: `0 0 ${size} ${size}`,
          'aria-hidden': true,
          focusable: false,
        },
        [
          h('defs', { key: 'defs' }, [
            h(
              'linearGradient',
              { key: 'g', id: gradientId, x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
              [
                h('stop', { key: 'a', offset: '0%', stopColor: 'var(--dshph-window-soft)' }),
                h('stop', { key: 'b', offset: '100%', stopColor: 'var(--dshph-window)' }),
              ],
            ),
          ]),
          h('circle', {
            key: 'wash',
            cx,
            cy,
            r: radius - 7,
            fill: 'var(--dshph-window)',
            opacity: 0.03,
          }),
          h('circle', {
            key: 'track',
            cx,
            cy,
            r: radius,
            fill: 'none',
            stroke: 'var(--dshph-track)',
            strokeWidth: 7,
            opacity: 0.7,
          }),
          ...segments.map((segment, index) =>
            h('path', {
              key: `seg-${index}`,
              d: arcPath(cx, cy, radius, segment.from, segment.to),
              fill: 'none',
              stroke: `url(#${gradientId})`,
              strokeWidth: 7,
              strokeLinecap: 'round',
            }),
          ),
          ...ticks,
          h('circle', {
            key: 'halo',
            cx: mx,
            cy: my,
            r: 8,
            fill: 'var(--dshph-accent)',
            opacity: 0.16,
          }),
          h('circle', {
            key: 'now',
            cx: mx,
            cy: my,
            r: 3.4,
            fill: 'var(--dsw-alias-bg-layer-2, #ffffff)',
            stroke: 'var(--dshph-accent)',
            strokeWidth: 2,
          }),
        ],
      )
    }

    function PeakPanel({ state: snapshot, t, locale, onClose, anchorRef }) {
      const panelRef = React.useRef(null)
      const [position, setPosition] = React.useState(null)

      useLayout(() => {
        const panel = panelRef.current
        const anchor = anchorRef.current
        if (panel === null || anchor === null) return undefined

        const place = () => {
          const surface =
            typeof anchor.closest === 'function'
              ? anchor.closest('[data-composer-card]') || anchor
              : anchor
          const rect = surface.getBoundingClientRect()
          const width = panel.offsetWidth || 328
          const height = panel.offsetHeight || 330
          const margin = 10
          const gap = 10
          const maxLeft = Math.max(margin, window.innerWidth - width - margin)
          const left = Math.min(Math.max(margin, rect.right - width), maxLeft)

          let top
          let placement
          if (rect.top - height - gap >= margin) {
            top = rect.top - height - gap
            placement = 'top'
          } else {
            top = Math.min(rect.bottom + gap, window.innerHeight - height - margin)
            placement = 'bottom'
          }
          setPosition((previous) =>
            previous !== null &&
            previous.left === left &&
            previous.top === top &&
            previous.placement === placement
              ? previous
              : { left, top, placement },
          )
        }

        place()
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
        if (observer !== null) observer.observe(panel)
        window.addEventListener('resize', place)
        window.addEventListener('scroll', place, true)
        return () => {
          if (observer !== null) observer.disconnect()
          window.removeEventListener('resize', place)
          window.removeEventListener('scroll', place, true)
        }
      }, [anchorRef])

      React.useEffect(() => {
        const onPointerDown = (event) => {
          const panel = panelRef.current
          const anchor = anchorRef.current
          if (panel === null) return
          if (panel.contains(event.target)) return
          if (anchor !== null && anchor.contains(event.target)) return
          onClose()
        }
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          if (event.defaultPrevented) return
          event.preventDefault()
          onClose()
          if (anchorRef.current !== null) anchorRef.current.focus()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [anchorRef, onClose])

      const phaseLabel = snapshot.phase === 'peak' ? t('pill.peak') : t('pill.offPeak')
      const chip = snapshot.phase === 'peak' ? t('chip.peak') : t('chip.offPeak')
      const untilLabel = t('panel.left')
      const duration = formatLong(snapshot.remainingMs)
      const clock = (ms) => formatClock(ms, snapshot.zone, locale)

      const when = relativeDay(snapshot.periodEnd, snapshot.now, snapshot.zone, locale)
      const whenLabel =
        when === 'today' ? t('time.today') : when === 'tomorrow' ? t('time.tomorrow') : when

      const nextLine =
        snapshot.phase === 'peak'
          ? t('panel.offPeakStartsAt', { time: clock(snapshot.periodEnd) })
          : t('panel.peakStartsAt', { when: whenLabel, time: clock(snapshot.periodEnd) })

      const schedule =
        snapshot.schedule.length === 0
          ? '—'
          : snapshot.schedule.map((window) => `${clock(window.start)}–${clock(window.end)}`).join(' · ')

      let todayLine
      if (snapshot.reason === 'holiday' && snapshot.holidayKey !== null) {
        todayLine = `${t(`holiday.${snapshot.holidayKey}`)} · ${t('panel.allDay')}`
      } else if (snapshot.reason === 'weekend') {
        todayLine = `${t('panel.weekend')} · ${t('panel.allDay')}`
      } else {
        todayLine = t('panel.weekday')
      }

      const zoneLine = snapshot.fallback
        ? t('panel.fallback')
        : `${snapshot.zone}${snapshot.offsetLabel === '' ? '' : ` · ${snapshot.offsetLabel}`}`

      const style =
        position === null
          ? { position: 'fixed', left: -9999, top: -9999, visibility: 'hidden' }
          : {
              position: 'fixed',
              left: position.left,
              top: position.top,
              visibility: 'visible',
              '--dshph-origin': position.placement === 'top' ? 'bottom right' : 'top right',
            }

      return h(
        'div',
        {
          ref: panelRef,
          className: 'dshph-panel',
          'data-phase': snapshot.phase,
          role: 'dialog',
          'aria-label': t('panel.title'),
          style,
        },
        [
          h('div', { key: 'head', className: 'dshph-head' }, [
            h('span', { key: 'dot', className: 'dshph-dot', 'aria-hidden': true }),
            h('span', { key: 'state', className: 'dshph-state' }, phaseLabel),
            h('span', { key: 'chip', className: 'dshph-chip' }, chip),
          ]),
          h('div', { key: 'dial', className: 'dshph-dial' }, [
            h(Dial, { key: 'face', state: snapshot }),
            h('div', { key: 'center', className: 'dshph-center' }, [
              h('span', { key: 'count', className: 'dshph-count' }, duration),
              h('span', { key: 'sub', className: 'dshph-sub' }, untilLabel),
            ]),
          ]),
          h('div', { key: 'next', className: 'dshph-next' }, nextLine),
          h('div', { key: 'rule', className: 'dshph-rule' }),
          h('dl', { key: 'rows', className: 'dshph-rows' }, [
            h('div', { key: 'hours', className: 'dshph-row' }, [
              h('dt', { key: 'k' }, t('panel.peakHours')),
              h('dd', { key: 'v' }, schedule),
            ]),
            h('div', { key: 'today', className: 'dshph-row' }, [
              h('dt', { key: 'k' }, t('panel.today')),
              h('dd', { key: 'v' }, todayLine),
            ]),
          ]),
          h('div', { key: 'foot', className: 'dshph-foot' }, [
            h('span', { key: 'zone' }, zoneLine),
            h(
              'span',
              { key: 'beijing' },
              `${t('panel.beijing')} ${formatClock(snapshot.now, 'Asia/Shanghai', locale)}`,
            ),
          ]),
        ],
      )
    }

    function PeakPill(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const locale = browserLocale()
      const provider = useSelectedProvider(props)
      const direct = isDirectProvider(provider)
      const [open, setOpen] = React.useState(false)
      // A hidden badge still has to follow model switches, but it does not need
      // a per-second countdown for a window it is not allowed to report.
      const now = useNow(direct ? 1000 : 60_000)
      const zoneRef = React.useRef(null)
      if (zoneRef.current === null) zoneRef.current = detectZone()
      const snapshot = state(now, { zone: zoneRef.current, locale })
      const buttonRef = React.useRef(null)
      const onClose = React.useCallback(() => setOpen(false), [])

      // A panel left open must not reappear on its own when the model later
      // returns to a DeepSeek route.
      React.useEffect(() => {
        if (!direct) setOpen(false)
      }, [direct])

      // DeepSeek's half-price window prices DeepSeek's own routes only. With
      // another provider selected there is no truthful Off-peak (or Peak) claim
      // to make about this session, so the badge stays absent.
      if (!direct) return null

      const phaseLabel = snapshot.phase === 'peak' ? t('pill.peak') : t('pill.offPeak')
      const until = snapshot.phase === 'peak' ? t('until.offPeak') : t('until.peak')
      const time = formatShort(snapshot.remainingMs)
      const aria = t('pill.aria', { state: phaseLabel, time, until })

      return h('div', { className: 'dshph', 'data-phase': snapshot.phase }, [
        h('style', { key: 'styles' }, CSS),
        h(
          'button',
          {
            key: 'button',
            ref: buttonRef,
            type: 'button',
            className: 'dshph-pill',
            'aria-haspopup': 'dialog',
            'aria-expanded': open ? 'true' : 'false',
            'aria-label': aria,
            onClick: () => setOpen((value) => !value),
          },
          [
            h(Ring, { key: 'ring', progress: snapshot.progress }),
            h('span', { key: 'label', className: 'dshph-label' }, phaseLabel),
            h('span', { key: 'sep', className: 'dshph-sep', 'aria-hidden': true }),
            h('span', { key: 'time', className: 'dshph-time' }, time),
          ],
        ),
        open
          ? h(PeakPanel, {
              key: 'panel',
              state: snapshot,
              t,
              locale,
              onClose,
              anchorRef: buttonRef,
            })
          : null,
      ])
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Registration.
    // ═══════════════════════════════════════════════════════════════════════

    const inject = ['slots', 'locale', 'modelDirectories']

    /**
     * Hand the ambient model-directory service to the badge. The service is a
     * root singleton; binding it once at apply time keeps `PeakPill` free of
     * context lookups during render.
     *
     * @param {object} modelDirectories - the composer's shared directory service.
     * @returns {Function} a slot component with the service bound.
     */
    function withModelDirectories(modelDirectories) {
      return function PeakHoursPill(props) {
        return h(PeakPill, Object.assign({}, props, { modelDirectories }))
      }
    }

    /** @param {object} ctx - browser Cordis context. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'peak-hours: dictionaries')

      ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.right',
            id: 'plugin.peak-hours',
            order: 10,
            locale: NS,
          },
          withModelDirectories(ctx.modelDirectories),
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.NS = NS
    exports.__internals = {
      engine,
      dictionaries: { en, zh },
      CSS,
      PeakPill,
      PeakPanel,
      Ring,
      Dial,
      formatShort,
      formatLong,
      DIRECT_PROVIDERS,
      isDirectProvider,
      providerOf,
      useSelectedProvider,
    }
    return module.exports
  },
})
