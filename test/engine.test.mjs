import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Load the browser bundle the way the Web client module loader does. */
function loadPlugin(react = { createElement: () => null }) {
  let captured = null
  const fakeWindow = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec
      },
    },
  }
  // eslint-disable-next-line no-new-func
  new Function('window', SOURCE)(fakeWindow)
  assert.ok(captured !== null, 'the module registers itself with the loader')
  assert.equal(captured.id, 'dsh-peak-hours')

  const module = captured.factory((specifier) => {
    if (specifier === 'react') return react
    throw new Error(`unexpected browser module: ${specifier}`)
  })
  return module
}

const plugin = loadPlugin()
const engine = plugin.__internals.engine

/**
 * One-pass React stub: enough to execute the badge for a single render so the
 * gating decision can be asserted without a browser or a reconciler. Hooks
 * return their initial value and never schedule an update.
 */
function hookStub() {
  return {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useMemo: (compute) => compute(),
    useCallback: (callback) => callback,
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    useLayoutEffect: () => {},
    useSyncExternalStore: (_subscribe, read) => read(),
    useId: () => 'test',
  }
}

/** The model-directory service face the badge consumes. */
function directoryService(current) {
  const snapshot = { current }
  return {
    directoryFor() {
      return {
        store: { getSnapshot: () => snapshot, subscribe: () => () => {} },
      }
    },
  }
}

const AT = (iso) => Date.parse(iso)
const JERUSALEM = { zone: 'Asia/Jerusalem', locale: 'en-GB' }

function state(iso, options = JERUSALEM) {
  return engine.state(AT(iso), options)
}

function hhmm(ms, zone = 'Asia/Jerusalem') {
  return engine.formatClock(ms, zone, 'en-GB')
}

test('the bundle exposes the host contract', () => {
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, ['slots', 'locale', 'modelDirectories'])
  assert.equal(plugin.NS, 'plugin.peakHours')
})

test('the widget registers into the composer bar, left of the model selector', () => {
  const registered = []
  let dictionary = null
  const modelDirectories = { directoryFor: () => null }

  const ctx = {
    effect(fn) {
      return fn()
    },
    locale: {
      register(namespace, dictionaries) {
        dictionary = { namespace, dictionaries }
        return () => {}
      },
    },
    modelDirectories,
    slots: {
      inject(key, callback) {
        assert.equal(key, 'conversation.input.right')
        callback()
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
  }

  plugin.apply(ctx)

  assert.equal(dictionary.namespace, 'plugin.peakHours')
  assert.ok(dictionary.dictionaries.en['pill.peak'])
  assert.ok(dictionary.dictionaries.zh['pill.peak'])

  assert.equal(registered.length, 1)
  const [{ options, component }] = registered
  assert.equal(options.name, 'conversation.input.right')
  assert.equal(options.id, 'plugin.peak-hours')
  assert.equal(options.locale, 'plugin.peakHours')
  assert.equal(typeof component, 'function')
})

test('only DeepSeek direct routes are eligible for the badge', () => {
  const { isDirectProvider, DIRECT_PROVIDERS } = plugin.__internals
  assert.deepEqual(DIRECT_PROVIDERS, ['deepseek-official', 'deepseek-account'])

  assert.equal(isDirectProvider('deepseek-official'), true)
  assert.equal(isDirectProvider('deepseek-account'), true)

  // Third-party providers that merely host a DeepSeek model bill on their own
  // terms; so does a hand-declared gateway under a custom provider id.
  for (const provider of ['kimi-coding', 'openrouter', 'deepseek', 'zai', 'anthropic', '']) {
    assert.equal(isDirectProvider(provider), false, `${provider || '(empty)'} is not direct`)
  }
  assert.equal(isDirectProvider(undefined), false)
  assert.equal(isDirectProvider(null), false)
})

test('a directory snapshot yields its selected provider or nothing', () => {
  const { providerOf } = plugin.__internals
  assert.equal(providerOf({ current: { provider: 'deepseek-official', model: 'deepseek-flash' } }), 'deepseek-official')
  assert.equal(providerOf({ current: { provider: 'deepseek-account', model: 'deepseek-v4-pro' } }), 'deepseek-account')
  assert.equal(providerOf({ current: null }), null)
  assert.equal(providerOf({ current: {} }), null)
  assert.equal(providerOf({}), null)
  assert.equal(providerOf(null), null)
  assert.equal(providerOf(undefined), null)
})

test('the badge is absent while a third-party provider is selected', () => {
  const { PeakPill } = loadPlugin(hookStub()).__internals
  const render = (provider) =>
    PeakPill({
      t: (key) => key,
      sessionId: 'session-1',
      modelDirectories: directoryService({ provider, model: 'some-model' }),
      useProjection: () => ({ next: { provider, model: 'some-model' } }),
    })

  for (const provider of ['kimi-coding', 'openrouter', 'zai', 'deepseek', 'anthropic']) {
    assert.equal(render(provider), null, `${provider} must not claim DeepSeek pricing`)
  }
})

test('the badge is present for both DeepSeek direct routes', () => {
  const { PeakPill } = loadPlugin(hookStub()).__internals
  const render = (provider) =>
    PeakPill({
      t: (key) => key,
      sessionId: 'session-1',
      modelDirectories: directoryService({ provider, model: 'deepseek-flash' }),
      useProjection: () => ({ next: { provider, model: 'deepseek-flash' } }),
    })

  const apiKeyRoute = render('deepseek-official')
  assert.ok(apiKeyRoute !== null)
  assert.equal(apiKeyRoute.type, 'div')
  assert.ok(render('deepseek-account') !== null)
})

test('an idle directory falls back to the durable selection', () => {
  const { PeakPill } = loadPlugin(hookStub()).__internals
  const base = { t: (key) => key, sessionId: 'session-1' }

  // The catalog has not loaded yet, but the Session remembers a direct route.
  const direct = PeakPill({
    ...base,
    modelDirectories: directoryService(null),
    useProjection: () => ({ next: { provider: 'deepseek-official', model: 'deepseek-flash' } }),
  })
  assert.ok(direct !== null)

  // Remembered third-party route: still absent.
  const thirdParty = PeakPill({
    ...base,
    modelDirectories: directoryService(null),
    useProjection: () => ({ next: { provider: 'kimi-coding', model: 'k3' } }),
  })
  assert.equal(thirdParty, null)

  // Nothing known at all: absent rather than an unproven Off-peak.
  assert.equal(PeakPill({ ...base, modelDirectories: directoryService(null) }), null)
  assert.equal(PeakPill({ ...base, modelDirectories: null }), null)
  assert.equal(
    PeakPill({
      ...base,
      modelDirectories: { directoryFor() { throw new Error('no binding') } },
      useProjection: () => undefined,
    }),
    null,
  )
})

test('a weekend is off-peak until the next Beijing weekday opens', () => {
  const current = state('2026-10-17T14:35:57Z')
  assert.equal(current.phase, 'off-peak')
  assert.equal(current.reason, 'weekend')
  assert.equal(new Date(current.periodEnd).toISOString(), '2026-10-19T01:00:00.000Z')
  assert.equal(engine.formatShort(current.remainingMs), '1d 10h')
})

test('peak window boundaries are exact', () => {
  const before = state('2026-10-19T00:59:59Z')
  assert.equal(before.phase, 'off-peak')
  assert.equal(new Date(before.periodEnd).toISOString(), '2026-10-19T01:00:00.000Z')

  const open = state('2026-10-19T01:00:00Z')
  assert.equal(open.phase, 'peak')
  assert.equal(new Date(open.periodEnd).toISOString(), '2026-10-19T04:00:00.000Z')

  const close = state('2026-10-19T03:59:59Z')
  assert.equal(close.phase, 'peak')

  const between = state('2026-10-19T04:00:00Z')
  assert.equal(between.phase, 'off-peak')
  assert.equal(new Date(between.periodEnd).toISOString(), '2026-10-19T06:00:00.000Z')

  const second = state('2026-10-19T06:00:00Z')
  assert.equal(second.phase, 'peak')
  assert.equal(new Date(second.periodEnd).toISOString(), '2026-10-19T10:00:00.000Z')

  const after = state('2026-10-19T10:00:00Z')
  assert.equal(after.phase, 'off-peak')
  assert.equal(new Date(after.periodEnd).toISOString(), '2026-10-20T01:00:00.000Z')
})

test('Friday evening carries over the whole weekend', () => {
  const friday = state('2026-10-16T10:00:00Z')
  assert.equal(friday.phase, 'off-peak')
  assert.equal(friday.reason, 'weekday')
  assert.equal(new Date(friday.periodEnd).toISOString(), '2026-10-19T01:00:00.000Z')
})

test('progress tracks the current window', () => {
  const peak = state('2026-10-19T02:00:00Z')
  assert.equal(peak.periodMs, 3 * 3600 * 1000)
  assert.ok(Math.abs(peak.progress - 1 / 3) < 1e-9)

  const off = state('2026-10-19T05:00:00Z')
  assert.equal(off.periodMs, 2 * 3600 * 1000)
  assert.ok(Math.abs(off.progress - 0.5) < 1e-9)
})

test('Chinese public holidays suspend peak pricing for the whole day', () => {
  const nationalDay = state('2026-10-01T02:00:00Z')
  assert.equal(nationalDay.phase, 'off-peak')
  assert.equal(nationalDay.reason, 'holiday')
  assert.equal(nationalDay.holidayKey, 'nationalDay')
  assert.equal(new Date(nationalDay.periodEnd).toISOString(), '2026-10-08T01:00:00.000Z')

  const springFestival = state('2026-02-16T02:00:00Z')
  assert.equal(springFestival.phase, 'off-peak')
  assert.equal(springFestival.reason, 'holiday')
  assert.equal(springFestival.holidayKey, 'springFestival')
  assert.equal(new Date(springFestival.periodEnd).toISOString(), '2026-02-24T01:00:00.000Z')

  const lastHolidayDay = state('2026-10-07T09:00:00Z')
  assert.equal(lastHolidayDay.phase, 'off-peak')
  assert.equal(lastHolidayDay.reason, 'holiday')

  const backToWork = state('2026-10-08T01:00:00Z')
  assert.equal(backToWork.phase, 'peak')
})

test('the holiday table matches the 2026 State Council notice', () => {
  // 元旦 3 + 春节 9 + 清明 3 + 劳动节 5 + 端午 3 + 中秋 3 + 国庆 7 = 33 days.
  assert.equal(Object.keys(engine.HOLIDAYS).length, 33)
  assert.equal(engine.HOLIDAYS['2026-01-01'], 'newYear')
  assert.equal(engine.HOLIDAYS['2026-02-23'], 'springFestival')
  assert.equal(engine.HOLIDAYS['2026-09-27'], 'midAutumn')
  assert.equal(engine.HOLIDAYS['2026-10-07'], 'nationalDay')
  assert.equal(engine.HOLIDAYS['2026-10-08'], undefined)
  // Make-up weekend workdays are still weekends for a Mon–Fri policy.
  assert.equal(engine.HOLIDAYS['2026-10-10'], undefined)
})

test('the canonical schedule converts into the viewer zone', () => {
  const pairs = (options) => {
    const current = engine.state(AT('2026-10-19T12:00:00Z'), options)
    return current.schedule.map(
      (window) => `${engine.formatClock(window.start, options.zone, 'en-GB')}-${engine.formatClock(window.end, options.zone, 'en-GB')}`,
    )
  }

  assert.deepEqual(pairs({ zone: 'Asia/Jerusalem' }), ['04:00-07:00', '09:00-13:00'])
  assert.deepEqual(pairs({ zone: 'Asia/Shanghai' }), ['09:00-12:00', '14:00-18:00'])
  assert.deepEqual(pairs({ zone: 'Asia/Kolkata' }), ['06:30-09:30', '11:30-15:30'])
  assert.deepEqual(pairs({ zone: 'America/Los_Angeles' }), ['18:00-21:00', '23:00-03:00'])
})

test('an unknown zone falls back to Beijing time', () => {
  const current = engine.state(AT('2026-10-19T02:00:00Z'), { zone: 'Mars/Olympus' })
  assert.equal(current.zone, 'Asia/Shanghai')
  assert.equal(current.fallback, true)

  const missing = engine.state(AT('2026-10-19T02:00:00Z'), {})
  assert.equal(missing.zone, 'Asia/Shanghai')
  assert.equal(missing.fallback, true)
})

test('the local day survives 25-hour DST days', () => {
  const la = engine.localDay(AT('2026-11-01T12:00:00Z'), 'America/Los_Angeles')
  assert.equal(la.end - la.start, 25 * 3600 * 1000)

  const israel = engine.localDay(AT('2026-10-25T12:00:00Z'), 'Asia/Jerusalem')
  assert.equal(israel.end - israel.start, 25 * 3600 * 1000)
})

test('the 24-hour face clips windows to the local day', () => {
  const la = engine.state(AT('2026-10-19T12:00:00Z'), {
    zone: 'America/Los_Angeles',
    locale: 'en-GB',
  })
  assert.ok(la.todayPeaks.length >= 1)
  for (const window of la.todayPeaks) {
    assert.ok(window.start >= la.localDay.start)
    assert.ok(window.end <= la.localDay.end)
  }
  // The 23:00–03:00 window crosses local midnight and is clipped at 24:00.
  const late = la.todayPeaks.find((window) => hhmm(window.start, 'America/Los_Angeles') === '23:00')
  assert.ok(late !== undefined)
  assert.equal(late.end, la.localDay.end)
})

test('duration formatting stays legible at every scale', () => {
  assert.equal(engine.formatShort(2 * 3600 * 1000), '2h')
  assert.equal(engine.formatShort((2 * 3600 + 14 * 60) * 1000), '2h 14m')
  assert.equal(engine.formatShort(43 * 60 * 1000), '43m')
  assert.equal(engine.formatShort(12 * 1000), '12s')
  assert.equal(engine.formatShort(34 * 3600 * 1000 + 24 * 60 * 1000), '1d 10h')
  assert.equal(engine.formatShort(48 * 3600 * 1000), '2d')
  assert.equal(engine.formatLong((2 * 3600 + 14 * 60 + 8) * 1000), '2h 14m')
  assert.equal(engine.formatLong((43 * 60 + 12) * 1000), '43m 12s')
  assert.equal(engine.formatLong(48 * 1000), '48s')
  assert.equal(engine.formatLong(34 * 3600 * 1000 + 24 * 60 * 1000), '1d 10h')
  assert.equal(engine.formatLong(48 * 3600 * 1000), '2d')
})
