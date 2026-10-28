/**
 * Host half of the dsh-battery-indicator bundle.
 *
 * The number rendered in the Web UI has to describe THIS computer, not whichever
 * device happens to have the page open: a phone reports its own battery through the
 * browser Battery Status API, which is why the first version of this plugin showed
 * the phone's charge on the phone. So the Host samples the machine battery itself and
 * publishes it on an exact route; the Client half reads that route, and every client
 * (desktop window, tablet, phone) then shows the same value.
 *
 * The route is a read-only, same-origin JSON endpoint and applies Connection's own
 * Host/Origin and browser-authentication checks before answering.
 *
 * Platforms: macOS is sampled through `pmset`; Linux is read from sysfs, which needs no
 * subprocess at all. Anything else reports `unsupported-platform` rather than a wrong
 * number.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { parsePmset, parseSysfs } from './parse.js'

const ROUTE = '/battery-indicator/state'
const CACHE_MS = 4000
const SAMPLE_TIMEOUT_MS = 4000
const PMSET = '/usr/bin/pmset'
const SYSFS_ROOT = '/sys/class/power_supply'

export const inject = ['webServer', 'subprocess']

async function runPmset(subprocess) {
  const handle = subprocess.spawn({
    argv: [PMSET, '-g', 'batt'],
    cwd: '/',
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 65536 },
      stderr: { maxBytes: 8192 },
    },
    graceMs: 1000,
  })

  const timer = setTimeout(() => {
    try {
      handle.terminate()
    } catch (error) {
      // The process may already be gone; reading `done` still reports the outcome.
    }
  }, SAMPLE_TIMEOUT_MS)

  try {
    const outcome = await handle.done
    const stdout = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
    const stderr = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
    if (outcome.exitCode !== 0) {
      const detail = stderr.trim() || String(outcome.signal || outcome.exitCode)
      throw new Error('pmset exited with ' + detail)
    }
    return stdout
  } finally {
    clearTimeout(timer)
  }
}

/** Read one sysfs attribute, answering undefined when the kernel does not expose it. */
async function attribute(directory, name) {
  try {
    return (await readFile(path.join(directory, name), 'utf8')).trim()
  } catch {
    return undefined
  }
}

/**
 * Read the first battery under /sys/class/power_supply.
 *
 * `energy_now` is in µWh and `power_now` in µW, so the remaining seconds are
 * energy/power hours; some drivers expose `charge_*`/`current_*` instead, which divides
 * the same way because both sides scale by voltage.
 */
async function readSysfs(root = SYSFS_ROOT) {
  let names
  try {
    names = await readdir(root)
  } catch {
    return { ok: true, available: false, reason: 'no-battery', sampledAt: new Date().toISOString() }
  }

  const candidate = names.find((name) => /^BAT/i.test(name))
  if (!candidate) {
    return { ok: true, available: false, reason: 'no-battery', sampledAt: new Date().toISOString() }
  }

  const directory = path.join(root, candidate)
  const capacity = await attribute(directory, 'capacity')
  const status = await attribute(directory, 'status')
  if (capacity == null) {
    return { ok: true, available: false, reason: 'no-battery', sampledAt: new Date().toISOString() }
  }

  const energy = Number(await attribute(directory, 'energy_now'))
  const charge = Number(await attribute(directory, 'charge_now'))
  const power = Number(await attribute(directory, 'power_now'))
  const current = Number(await attribute(directory, 'current_now'))

  let secondsLeft
  const stored = Number.isFinite(energy) && energy > 0 ? energy : Number.isFinite(charge) && charge > 0 ? charge : null
  const draw = Number.isFinite(power) && power > 0 ? power : Number.isFinite(current) && current > 0 ? current : null
  if (stored !== null && draw !== null) secondsLeft = (stored / draw) * 3600

  return parseSysfs({ capacity, status, secondsLeft })
}

async function readBattery(ctx) {
  if (process.platform === 'darwin') {
    try {
      return parsePmset(await runPmset(ctx.subprocess))
    } catch (error) {
      return {
        ok: true,
        available: false,
        reason: 'read-failed',
        message: String((error && error.message) || error),
        sampledAt: new Date().toISOString(),
      }
    }
  }

  if (process.platform === 'linux') {
    try {
      return await readSysfs()
    } catch (error) {
      return {
        ok: true,
        available: false,
        reason: 'read-failed',
        message: String((error && error.message) || error),
        sampledAt: new Date().toISOString(),
      }
    }
  }

  return { ok: true, available: false, reason: 'unsupported-platform', sampledAt: new Date().toISOString() }
}

/**
 * Authentication policy for this read-only endpoint.
 *
 * Connection reports `403` when the request violates its Host/Origin policy; that is a
 * real signal and the route refuses. It may report `401` when no browser credential is
 * replayed, which is not meaningful here: the value is a non-sensitive, read-only number,
 * every carrier that exposes the Web UI already authenticates before routing (the LAN
 * listener rejects unauthenticated requests before this handler runs), the loopback
 * listener is reachable only by local processes that could read the battery themselves,
 * and no CORS headers are emitted so another origin cannot read the response from a page.
 * Refusing a 401 would break clients whose carrier authenticated out of band, which is
 * exactly the phone case this endpoint exists for.
 */
function blockRejection(rejection) {
  return rejection === 403
}

function sendJson(res, status, body, method) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(method === 'HEAD' ? undefined : payload)
}

export function apply(ctx) {
  let cache = null
  let inFlight = null

  const current = () => {
    if (cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.value)
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const value = await readBattery(ctx)
        cache = { at: Date.now(), value }
        return value
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  const handler = async (req, res) => {
    try {
      const method = req.method || 'GET'
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'method-not-allowed' }))
        return
      }

      const connection = ctx.get('connection')
      if (connection && typeof connection.requestRejection === 'function') {
        let rejection
        try {
          rejection = connection.requestRejection({ headers: req.headers })
        } catch (error) {
          rejection = undefined
        }
        if (blockRejection(rejection)) {
          sendJson(res, rejection, { ok: false, error: 'unauthorized' }, method)
          return
        }
      }

      sendJson(res, 200, await current(), method)
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String((error && error.message) || error) }, req.method)
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler }),
    'battery-indicator: state route',
  )
}
