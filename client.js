window.__ModuleLoader__.load({
  id: 'dsh-battery-level-indicator',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'battery'
    const DICT = {
      en: {
        title: 'Battery',
        hostLabel: 'Computer battery',
        charging: 'Charging',
        finishing: 'Finishing charge',
        charged: 'Fully charged',
        idle: 'Plugged in',
        onBattery: 'On battery',
        timeLeft: '~{time} left',
        hours: '{h} h {m} min',
        minutes: '{m} min',
        unavailable: 'Computer battery unavailable',
        noBattery: 'No battery on this computer',
        readout: 'Battery {level}%, {status}',
      },
      zh: {
        title: '电池',
        hostLabel: '电脑电池',
        charging: '充电中',
        finishing: '即将充满',
        charged: '已充满',
        idle: '电源已连接',
        onBattery: '使用电池',
        timeLeft: '约剩 {time}',
        hours: '{h} 小时 {m} 分钟',
        minutes: '{m} 分钟',
        unavailable: '读不到电脑电池',
        noBattery: '这台电脑没有电池',
        readout: '电量 {level}%，{status}',
      },
    }

    const ENDPOINT = 'battery-indicator/state'
    const POLL_MS = 20000
    const LOW_LEVEL = 20
    const STATUS_KEY = {
      charging: 'charging',
      finishing: 'finishing',
      charged: 'charged',
      idle: 'idle',
      discharging: 'onBattery',
    }

    const CSS = `
.dsh-battery { display:inline-flex; align-items:center; gap:6px; box-sizing:border-box; height:26px; padding:0 9px; border-radius:999px; color:var(--dsw-alias-label-secondary); font-family:inherit; font-size:12px; line-height:1; white-space:nowrap; user-select:none; -webkit-user-select:none; }
.dsh-battery svg { display:block; flex:none; }
.dsh-battery-level { color:var(--dsw-alias-label-primary); font-weight:600; font-variant-numeric:tabular-nums; font-feature-settings:"tnum" 1; }
.dsh-battery-sep { opacity:.4; }
.dsh-battery.is-low .dsh-battery-level { color:var(--dsw-alias-state-error-primary); }
.dsh-battery-time { font-variant-numeric:tabular-nums; }
.dsh-battery.is-unavailable { opacity:.7; }
`

    const BOLT = 'M23.8 1.2 19.2 7.6h2.9l-1.5 5.2 5.3-6.4h-3Z'

    function glyph(props) {
      const ratio = Math.max(0, Math.min(1, props.level / 100))
      const fill = props.charging
        ? 'var(--dsw-alias-state-success-primary)'
        : props.low ? 'var(--dsw-alias-state-error-primary)' : 'currentColor'
      return h('svg', { viewBox: '0 0 28 14', width: 22, height: 11, 'aria-hidden': true, focusable: false },
        h('rect', {
          x: 0.6, y: 1.6, width: 16.8, height: 10.8, rx: 3.4,
          fill: 'none', stroke: 'currentColor', strokeOpacity: 0.45, strokeWidth: 1.2,
        }),
        ratio > 0 && h('rect', {
          x: 2.2, y: 3.2, width: Math.max(1.4, 13.6 * ratio), height: 7.6, rx: 1.9, fill,
        }),
        props.charging
          ? h('path', { d: BOLT, fill: 'var(--dsw-alias-state-success-primary)' })
          : h('rect', {
            x: 18.1, y: 5, width: 1.6, height: 4, rx: 0.8,
            fill: 'currentColor', fillOpacity: 0.45,
          }))
    }

    function duration(t, seconds) {
      const total = Math.max(0, Math.round(seconds / 60))
      const hours = Math.floor(total / 60)
      const minutes = total % 60
      return hours > 0 ? text(t, 'hours', { h: hours, m: minutes }) : text(t, 'minutes', { m: minutes })
    }

    function text(t, key, values) {
      let value
      try {
        value = t(key)
      } catch (error) {
        value = undefined
      }
      if (typeof value !== 'string' || value === key) value = DICT.en[key] || key
      if (!values) return value
      return value.replace(/\{(\w+)\}/g, (match, name) => (
        values[name] === undefined ? match : String(values[name])
      ))
    }

    /**
     * Candidate URLs for the Host route. A remote carrier may mount the application
     * under a path prefix, so try the document-relative form first and the origin-root
     * form second instead of assuming where the server is mounted.
     */
    function endpointCandidates() {
      const urls = []
      try {
        urls.push(new URL(ENDPOINT, document.baseURI).href)
      } catch (error) {
        // A malformed baseURI falls through to the origin-relative form.
      }
      const rooted = location.origin + '/' + ENDPOINT
      if (!urls.includes(rooted)) urls.push(rooted)
      return urls
    }

    async function readHostBattery() {
      let lastError = null
      for (const url of endpointCandidates()) {
        try {
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'application/json' },
          })
          if (!response.ok) {
            lastError = new Error('HTTP ' + response.status)
            continue
          }
          const data = await response.json()
          if (!data || data.ok !== true) {
            lastError = new Error('malformed payload')
            continue
          }
          if (data.available !== true) {
            return { status: data.reason === 'no-battery' || data.reason === 'unsupported-platform' ? 'no-battery' : 'unavailable' }
          }
          const level = Number(data.level)
          return {
            status: 'ready',
            level: Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : 0,
            charging: data.charging === true,
            state: typeof data.state === 'string' ? data.state : 'unknown',
            secondsLeft: typeof data.secondsLeft === 'number' && data.secondsLeft > 0 ? data.secondsLeft : null,
          }
        } catch (error) {
          lastError = error
        }
      }
      throw lastError || new Error('unreachable')
    }

    /**
     * Polls the Host route. Deliberately does not consult navigator.getBattery():
     * on a phone that reports the phone's own charge, which is exactly the behaviour
     * this plugin must not have.
     */
    function useHostBattery() {
      const [state, setState] = React.useState({ status: 'loading' })

      React.useEffect(() => {
        let alive = true

        const refresh = () => {
          if (!alive) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          readHostBattery().then(
            (next) => {
              if (alive) setState(next)
            },
            () => {
              // Keep the last good reading through a transient network hiccup.
              if (alive) setState((previous) => (previous.status === 'ready' ? previous : { status: 'unavailable' }))
            },
          )
        }

        refresh()
        const timer = window.setInterval(refresh, POLL_MS)
        const onVisible = () => {
          if (document.visibilityState === 'visible') refresh()
        }
        const onFocus = () => refresh()
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onFocus)

        return () => {
          alive = false
          window.clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onFocus)
        }
      }, [])

      return state
    }

    function createViews(ctx, t) {
      function useLocaleTick() {
        const [, bump] = React.useReducer((value) => value + 1, 0)
        React.useEffect(() => {
          const locale = ctx.get('locale')
          if (!locale || typeof locale.subscribe !== 'function') return undefined
          return locale.subscribe(() => bump())
        }, [])
      }

      function BatteryIndicator() {
        useLocaleTick()
        const battery = useHostBattery()

        if (battery.status === 'loading') return null

        if (battery.status === 'unavailable' || battery.status === 'no-battery') {
          const message = text(t, battery.status === 'no-battery' ? 'noBattery' : 'unavailable')
          return h('div', {
            className: 'dsh-battery is-unavailable',
            role: 'status',
            title: message,
            'aria-label': message,
          },
          h('style', null, CSS),
          glyph({ level: 0, charging: false, low: false }),
          h('span', null, message))
        }

        const low = !battery.charging && battery.level <= LOW_LEVEL
        const statusKey = STATUS_KEY[battery.state] || (battery.charging ? 'charging' : 'onBattery')
        const status = text(t, statusKey)
        const remaining = battery.secondsLeft === null ? null : duration(t, battery.secondsLeft)
        const readout = text(t, 'readout', { level: battery.level, status })
        const label = remaining === null
          ? readout
          : readout + ' · ' + text(t, 'timeLeft', { time: remaining })
        const hint = text(t, 'hostLabel') + ' · ' + label

        return h('div', {
          className: 'dsh-battery' + (low ? ' is-low' : ''),
          role: 'status',
          title: hint,
          'aria-label': hint,
        },
        h('style', null, CSS),
        glyph({ level: battery.level, charging: battery.charging, low }),
        h('span', { className: 'dsh-battery-level' }, battery.level + '%'),
        h('span', { className: 'dsh-battery-sep', 'aria-hidden': true }, '·'),
        h('span', null, status),
        remaining !== null && h('span', { className: 'dsh-battery-sep', 'aria-hidden': true }, '·'),
        remaining !== null && h('span', { className: 'dsh-battery-time' }, text(t, 'timeLeft', { time: remaining })))
      }

      return { BatteryIndicator }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const disposers = []
          for (const locale of Object.keys(DICT)) {
            try {
              disposers.push(ctx.locale.register(NS, locale, DICT[locale]))
            } catch (error) {
              console.warn('[battery-indicator] locale registration skipped for ' + locale, error)
            }
          }
          return () => {
            for (const dispose of disposers) dispose()
          }
        }, 'battery-indicator: dictionaries')

        const t = ctx.locale.bind(NS)
        const { BatteryIndicator } = createViews(ctx, t)

        ctx.effect(() => {
          const dispose = ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
            name: 'conversation.composer.dock',
            id: 'battery-indicator',
            order: 5,
            label: () => t('title'),
          }, BatteryIndicator))
          return () => dispose()
        }, 'battery-indicator: composer dock placement')
      },
    }
  },
})
