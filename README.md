# dsh-battery-indicator

**English** · [简体中文](README.zh-CN.md)

Shows the **host computer's** battery in the composer dock — the row directly below the message
composer — in the DeepSeek Harness Web UI.

```bash
plugin_manager → install_bundle → target: <this directory>
```

- Percentage remaining, with a battery glyph whose fill follows the level.
- Charging state: `Charging`, `Finishing charge`, `Fully charged`, `Plugged in`, or `On battery`.
- While running on battery it also shows the estimated time left.
- Below 20% on battery the readout switches to the error color.
- Text comes from the Client locale service (`en`, `zh`), so it follows the app language.

Open the same Web UI on a phone or tablet and it still reports the computer's battery, because the
reading is taken on the Host — see below.

## Why the Host reads the battery

The value must describe the computer running Harness, not the device showing the page. The browser
Battery Status API reports the *viewing* device, so a phone that opens the same Web UI would show
its own charge. Version 1.1.0 therefore moved the reading to the Host:

1. `index.js` samples the machine battery, caches the result for 4 s, and serves it as JSON at
   `GET /battery-indicator/state`. The route applies Connection's Host/Origin and
   browser-authentication checks before answering.
2. `client.js` polls that route (20 s, plus `visibilitychange` and `focus`), tries the
   document-relative URL before the origin-root URL so a mounted deployment still resolves, and
   keeps the last good reading through a transient failure.

The Client never calls `navigator.getBattery()`; on a phone that would report the phone. When the
Host has no battery, or the sample cannot be parsed, the row says so instead of guessing.

## Platforms

| Platform | Source | Notes |
| --- | --- | --- |
| macOS | `/usr/bin/pmset -g batt` via `ctx.subprocess` | Charge state and time remaining |
| Linux | `/sys/class/power_supply/BAT*/` | `capacity`, `status`, and a countdown from `energy_now`/`power_now` |
| Windows | — | Reports `unsupported-platform`; the row says the battery is unavailable |

Both sample paths return the same JSON shape, so the Client does not know which platform it is on:

```json
{ "ok": true, "available": true, "level": 82, "state": "charging",
  "charging": true, "secondsLeft": null, "powerSource": "AC Power",
  "sampledAt": "2026-10-28T06:10:58.570Z" }
```

`state` is one of `charging`, `finishing`, `charged`, `discharging`, `idle`, `unknown` — a small
closed vocabulary the Client translates, so a new platform only has to map onto it.

## Files

| File | Role |
|---|---|
| `package.json` | Bundle manifest: patch, `dsh.client`, exports, `files` |
| `cordis.patch.yml` | Inserts the `battery-indicator` row |
| `index.js` | Host half: samples `pmset` or sysfs, serves `/battery-indicator/state` |
| `parse.js` | Pure parsers for both platforms, so the shapes can be tested anywhere |
| `client.js` | Slot registration in `conversation.composer.dock` and the readout component |
| `locale/en.json`, `locale/zh.json` | Plugin Manager / Settings title and description |
| `icon.svg` | Plugin icon |

## Test

```bash
node test/parse.test.mjs   # 58 checks over real pmset output and sysfs readings
```

The parsers are pure, so the suite runs on any machine — including CI boxes with no battery.

## Changelog

- **1.2.0** — Linux support through sysfs; parsers extracted to `parse.js` with a test suite;
  fixed `discharging` being classified as `charging` (the check for `charging` ran before
  `discharging`, and the latter contains the former).
- **1.1.0** — Moved the reading to the Host so every device shows the computer's battery.
- **1.0.0** — First version, using the browser Battery Status API.

## License

MIT
