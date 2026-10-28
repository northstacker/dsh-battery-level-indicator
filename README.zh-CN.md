# dsh-battery-indicator

[English](README.md) · **简体中文**

在 DeepSeek Harness Web UI 的输入框下方那一行里，显示**这台电脑**的电池状态。

```bash
plugin_manager → install_bundle → target: <本目录>
```

- 剩余电量百分比，电池图标会按电量填充。
- 充电状态：`充电中`、`即将充满`、`已充满`、`电源已连接`、`使用电池`。
- 用电池供电时还会显示预计剩余时间。
- 用电池且电量低于 20% 时，读数变成错误色。
- 文案来自客户端 locale 服务（`en`、`zh`），跟随界面语言。

在手机或平板上打开同一个 Web UI，显示的仍然是这台电脑的电量——因为读数是在 Host 上取的，
见下文。

## 为什么由 Host 读电池

这个数字必须描述运行 Harness 的那台电脑，而不是正在看页面的设备。浏览器的 Battery Status
API 报告的是**当前查看设备**的电量，所以手机打开同一个界面会显示手机自己的电量。
1.1.0 因此把读数搬到了 Host：

1. `index.js` 采样本机电池，缓存 4 秒，通过 `GET /battery-indicator/state` 以 JSON 返回。
   该路由在应答前会走 Connection 的 Host/Origin 与浏览器凭据校验。
2. `client.js` 轮询该路由（20 秒一次，外加 `visibilitychange` 和 `focus`），先试相对文档的
   URL 再试站点根 URL（这样挂载在子路径下也能用），并保留上一次成功读数以熬过瞬时失败。

客户端从不调用 `navigator.getBattery()`——在手机上那样只会报告手机自己。Host 没有电池、或
样本解析失败时，这一行会直说读不到，而不是猜一个数字。

## 平台支持

| 平台 | 数据来源 | 说明 |
| --- | --- | --- |
| macOS | `/usr/bin/pmset -g batt`（经 `ctx.subprocess`） | 充电状态与剩余时间 |
| Linux | `/sys/class/power_supply/BAT*/` | `capacity`、`status`，并用 `energy_now`/`power_now` 算倒计时 |
| Windows | — | 返回 `unsupported-platform`，界面显示读不到电池 |

两条采样路径返回同一个 JSON 形状，所以客户端不需要知道自己在哪个平台：

```json
{ "ok": true, "available": true, "level": 82, "state": "charging",
  "charging": true, "secondsLeft": null, "powerSource": "AC Power",
  "sampledAt": "2026-10-28T06:10:58.570Z" }
```

`state` 只会是 `charging`、`finishing`、`charged`、`discharging`、`idle`、`unknown` 之一——
一个客户端能翻译的小词表，新平台只要往这里映射即可。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 清单：patch、`dsh.client`、exports、`files` |
| `cordis.patch.yml` | 插入 `battery-indicator` 这一行 |
| `index.js` | Host 半边：采样 `pmset` 或 sysfs，提供 `/battery-indicator/state` |
| `parse.js` | 两个平台的纯解析函数，所以形状可以在任何机器上测 |
| `client.js` | 在 `conversation.composer.dock` 注册，以及读数组件 |
| `locale/en.json`、`locale/zh.json` | 插件管理器 / 设置里的标题与说明 |
| `icon.svg` | 插件图标 |

## 测试

```bash
node test/parse.test.mjs   # 58 项检查，覆盖真实 pmset 输出与 sysfs 读数
```

解析函数是纯的，所以这套测试在任何机器上都能跑——包括没有电池的 CI。

## 变更记录

- **1.2.0** — 通过 sysfs 支持 Linux；解析逻辑抽到 `parse.js` 并配上测试；
  修复 `discharging` 被判定成 `charging` 的问题（原先先匹配 `charging` 再匹配 `discharging`，
  而后者包含前者）。
- **1.1.0** — 读数搬到 Host，让每台设备都显示电脑的电量。
- **1.0.0** — 第一版，使用浏览器 Battery Status API。

## 许可证

MIT
