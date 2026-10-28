/**
 * Unit tests for the pure parsers. They need no battery, no subprocess and no platform:
 * every case is real `pmset` text or a real sysfs reading, checked against the exact
 * JSON shape the Client renders.
 */

import { classify, isCharging, isKnownState, parsePmset, parseSysfs } from '../parse.js'

let passed = 0
const failures = []

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    return
  }
  failures.push(name + (detail === undefined ? '' : ' -> ' + JSON.stringify(detail)))
}

const AC_CHARGING = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=23003235)\t82%; charging; 3:04 remaining present: true
`

const BATTERY_DISCHARGING = `Now drawing from 'Battery Power'
 -InternalBattery-0 (id=23003235)\t61%; discharging; 2:15 remaining present: true
`

const CHARGED = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=23003235)\t100%; charged; 0:00 remaining present: true
`

const IDLE = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=23003235)\t95%; not charging
`

const FINISHING = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=23003235)\t99%; finishing charge; 0:10 remaining present: true
`

const NO_BATTERY = `Now drawing from 'AC Power'
`

const UNREADABLE = `Now drawing from 'Battery Power'
 -InternalBattery-0 (id=1)\t--%; unknown
`

/* --------------------------------------------------------------- macOS `pmset` --- */

const charging = parsePmset(AC_CHARGING)
check('pmset charging: available', charging.available === true, charging)
check('pmset charging: level 82', charging.level === 82, charging.level)
check('pmset charging: state', charging.state === 'charging', charging.state)
check('pmset charging: reports charging', charging.charging === true, charging.charging)
check('pmset charging: no countdown', charging.secondsLeft === null, charging.secondsLeft)
check('pmset charging: power source', charging.powerSource === 'AC Power', charging.powerSource)
check('pmset charging: sampledAt is ISO', /^\d{4}-\d{2}-\d{2}T/.test(charging.sampledAt), charging.sampledAt)
check('pmset charging: ok flag', charging.ok === true, charging)

const discharging = parsePmset(BATTERY_DISCHARGING)
check('pmset discharging: level 61', discharging.level === 61, discharging.level)
check('pmset discharging: state', discharging.state === 'discharging', discharging.state)
check('pmset discharging: not charging', discharging.charging === false, discharging.charging)
check('pmset discharging: 2h15m left', discharging.secondsLeft === 8100, discharging.secondsLeft)
check('pmset discharging: power source', discharging.powerSource === 'Battery Power', discharging.powerSource)

const charged = parsePmset(CHARGED)
check('pmset charged: state', charged.state === 'charged', charged.state)
check('pmset charged: counts as charging', charged.charging === true, charged.charging)
check('pmset charged: no countdown', charged.secondsLeft === null, charged.secondsLeft)

const idle = parsePmset(IDLE)
check('pmset idle: state', idle.state === 'idle', idle.state)
check('pmset idle: not charging', idle.charging === false, idle.charging)
check('pmset idle: no countdown', idle.secondsLeft === null, idle.secondsLeft)

const finishing = parsePmset(FINISHING)
check('pmset finishing: state', finishing.state === 'finishing', finishing.state)
check('pmset finishing: counts as charging', finishing.charging === true, finishing.charging)

const noBattery = parsePmset(NO_BATTERY)
check('pmset without battery: unavailable', noBattery.available === false, noBattery)
check('pmset without battery: reason', noBattery.reason === 'no-battery', noBattery.reason)
check('pmset without battery: still ok', noBattery.ok === true, noBattery.ok)

const unreadable = parsePmset(UNREADABLE)
check('pmset unreadable: unavailable', unreadable.available === false, unreadable)
check('pmset unreadable: reason', unreadable.reason === 'parse-failed', unreadable.reason)

check('pmset empty input', parsePmset('').available === false)

/* ------------------------------------------------------------------ Linux sysfs --- */

const linuxBattery = parseSysfs({ capacity: '87', status: 'Discharging', secondsLeft: 5400 })
check('sysfs discharging: level 87', linuxBattery.level === 87, linuxBattery.level)
check('sysfs discharging: state', linuxBattery.state === 'discharging', linuxBattery.state)
check('sysfs discharging: countdown', linuxBattery.secondsLeft === 5400, linuxBattery.secondsLeft)
check('sysfs discharging: power source', linuxBattery.powerSource === 'Battery Power', linuxBattery.powerSource)

const linuxFull = parseSysfs({ capacity: 100, status: 'Full' })
check('sysfs full: state charged', linuxFull.state === 'charged', linuxFull.state)
check('sysfs full: counts as charging', linuxFull.charging === true, linuxFull.charging)
check('sysfs full: AC power', linuxFull.powerSource === 'AC Power', linuxFull.powerSource)

const linuxUnknown = parseSysfs({ capacity: '50', status: 'Unknown', secondsLeft: 1200 })
check('sysfs unknown: state', linuxUnknown.state === 'unknown', linuxUnknown.state)
check('sysfs unknown: no countdown', linuxUnknown.secondsLeft === 1200, linuxUnknown.secondsLeft)

const linuxMissing = parseSysfs({})
check('sysfs without capacity: unavailable', linuxMissing.available === false, linuxMissing)
check('sysfs without capacity: reason', linuxMissing.reason === 'no-battery', linuxMissing.reason)

check('sysfs clamps above 100', parseSysfs({ capacity: '140', status: 'Full' }).level === 100)
check('sysfs clamps below 0', parseSysfs({ capacity: '-5', status: 'Discharging' }).level === 0)
check('sysfs rejects non-numeric', parseSysfs({ capacity: 'n/a', status: 'Full' }).available === false)
check('sysfs ignores a zero countdown', parseSysfs({ capacity: '50', status: 'Discharging', secondsLeft: 0 }).secondsLeft === null)

/* -------------------------------------------------------------- small vocabulary --- */

check('classify: finishing charge', classify('finishing charge') === 'finishing')
check('classify: not charging beats charging', classify('not charging') === 'idle')
check('classify: charged', classify('charged') === 'charged')
check('classify: full is charged', classify('Full') === 'charged')
check('classify: charging', classify('charging') === 'charging')
check('classify: discharging', classify('discharging') === 'discharging')
check('classify: unknown text', classify('calibrating') === 'unknown')
check('classify: empty', classify('') === 'unknown')

check('isCharging: charging', isCharging('charging') === true)
check('isCharging: finishing', isCharging('finishing') === true)
check('isCharging: charged', isCharging('charged') === true)
check('isCharging: discharging', isCharging('discharging') === false)
check('isCharging: idle', isCharging('idle') === false)

check('isKnownState: accepted', isKnownState('discharging') === true)
check('isKnownState: rejected', isKnownState('melting') === false)
check('every parsed state is known', [charging, discharging, charged, idle, finishing, linuxBattery, linuxFull, linuxUnknown]
  .every((entry) => isKnownState(entry.state)))

/* ------------------------------------------------------------------------ report --- */

if (failures.length) {
  console.error(failures.length + ' failed:')
  for (const failure of failures) console.error('  - ' + failure)
  process.exitCode = 1
} else {
  console.log(passed + '/' + passed + ' checks passed')
}
