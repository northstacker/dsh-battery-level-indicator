/**
 * Platform parsing for the battery-indicator Host half.
 *
 * Everything here is pure: it turns text a platform gave us into the small JSON shape
 * the Client renders. Keeping it pure means the shapes can be tested on any machine,
 * including CI boxes that have no battery at all.
 *
 * The shared result shape is:
 *   { ok: true, available: true, level, state, charging, secondsLeft, powerSource, sampledAt }
 * or, when the machine simply has no battery to report:
 *   { ok: true, available: false, reason, sampledAt }
 */

const ACCEPTED = new Set(['charging', 'finishing', 'charged', 'discharging', 'idle', 'unknown'])

/** Map a platform's free-text state cell onto a small closed vocabulary the Client can translate. */
export function classify(stateText) {
  const text = String(stateText || '').toLowerCase()
  // Order matters: "discharging" contains "charging", so it has to be answered first.
  if (/finishing/.test(text)) return 'finishing'
  if (/not charging/.test(text)) return 'idle'
  if (/discharging/.test(text)) return 'discharging'
  if (/charged|full/.test(text)) return 'charged'
  if (/charging/.test(text)) return 'charging'
  return 'unknown'
}

/** Charging states are the ones where a "time remaining" would be meaningless. */
export function isCharging(state) {
  return state === 'charging' || state === 'finishing' || state === 'charged'
}

function clampLevel(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(0, Math.min(100, Math.round(number)))
}

function unavailable(reason) {
  return { ok: true, available: false, reason, sampledAt: new Date().toISOString() }
}

/**
 * Parse `pmset -g batt` (macOS), for example:
 *   Now drawing from 'AC Power'
 *    -InternalBattery-0 (id=23003235)	82%; charging; 3:04 remaining present: true
 */
export function parsePmset(text) {
  const raw = String(text || '')
  const sourceMatch = /drawing from '([^']+)'/.exec(raw)
  const line = raw.split('\n').find((row) => row.includes('%') && /battery/i.test(row))
  if (!line) return unavailable('no-battery')

  const percentMatch = /(\d+)%/.exec(line)
  if (!percentMatch) return unavailable('parse-failed')

  const level = clampLevel(percentMatch[1])
  if (level === null) return unavailable('parse-failed')

  const cells = line.split(';').map((cell) => cell.trim())
  const stateText = cells
    .slice(1)
    .filter((cell) => cell && !/remaining|present|estimate|calculating/i.test(cell))
    .join(' ')

  const state = classify(stateText)
  const charging = isCharging(state)

  let secondsLeft = null
  if (!charging) {
    const remaining = /(\d+):(\d{2})/.exec(line)
    if (remaining) {
      const seconds = Number(remaining[1]) * 3600 + Number(remaining[2]) * 60
      if (seconds > 0) secondsLeft = seconds
    }
  }

  return {
    ok: true,
    available: true,
    level,
    state,
    charging,
    secondsLeft,
    powerSource: sourceMatch ? sourceMatch[1] : null,
    sampledAt: new Date().toISOString(),
  }
}

/**
 * Build the same shape from Linux sysfs readings, which the Host reads from
 * /sys/class/power_supply/BAT*: `capacity` is a percentage, `status` is one of
 * Charging / Discharging / Full / Not charging / Unknown.
 */
export function parseSysfs(readings) {
  const input = readings || {}
  const level = clampLevel(input.capacity)
  if (level === null) return unavailable('no-battery')

  const state = classify(input.status)
  const charging = isCharging(state)

  let secondsLeft = null
  if (!charging && input.secondsLeft != null) {
    const seconds = Number(input.secondsLeft)
    if (Number.isFinite(seconds) && seconds > 0) secondsLeft = Math.round(seconds)
  }

  return {
    ok: true,
    available: true,
    level,
    state,
    charging,
    secondsLeft,
    powerSource: charging ? 'AC Power' : 'Battery Power',
    sampledAt: new Date().toISOString(),
  }
}

/** Defensive guard used by tests: the vocabulary the Client knows how to translate. */
export function isKnownState(state) {
  return ACCEPTED.has(state)
}
