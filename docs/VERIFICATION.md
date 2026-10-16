# 验证记录与重建说明

2026-10-16。源文件曾因执行环境替换丢失，现从保留内容恢复并重新检查。历史结果不得自动视为当前代码验证。

## 当前重建版本

- npm run typecheck / npm run build：重新执行通过。
- 28/28测试重新执行通过（24项核心与4项React界面集成），覆盖完整单局、恢复待执行AI回合、损坏存档，以及刷新后重开普通战报仍保持普通难度。
- 新64种子正式预算冒烟结果见 src/ai/reconstructed-benchmark-64.json：Normal44.48平均攻击，HuntTarget49.89，Easy62.42；Normal对Easy79.69%，对HuntTarget75.00%；10,293次决策无降级/超时。
- 新1,000种子正式验收完成，原始记录见 [ai-acceptance-reconstructed-1000.json](ai-acceptance-reconstructed-1000.json)，汇总见 [ai-acceptance-current-results.txt](ai-acceptance-current-results.txt)。种子300000–300999，交换先手每组2,000局；其中2种子曾用于合并管线冒烟，未随后调参，998种子此前未用。
- 当前Normal对Easy胜率83.50%（95%区间81.15–85.70），对HuntTarget72.90%（70.20–75.45）；平均攻击45.821/51.423/61.382/95.373（Normal/HuntTarget/Easy/Random）。159,255次Normal决策无降级或内部超时，CLI P90 12.17ms，最大340.95ms。达到65% HuntTarget目标，尚未达到90% Easy目标。
- GitHub Actions首次生产子路径验证通过：[运行38913014529](https://github.com/Kamisato-Yuna/Tidal-Command/actions/runs/38913014529)。包含类型、核心/React测试、构建及4项真实Chromium E2E（完整胜局、普通Worker与续局、窄屏开火、设置）。该运行对应第一次同步版本；随后修复的普通战报重开难度由新增回归测试覆盖，后续CI复验。

## 历史结果（不是重建版本验收）

原环境曾执行27项测试和1,000种子验收。实际保留的汇总为：Normal45.768平均攻击，HuntTarget51.330，Easy61.632，Random95.314；交换先手Normal对Easy82.65%（95%区间80.40–84.85），对HuntTarget75.20%（72.50–77.80）。158,890次Normal决策中2次降级、47次内部时间保护，平均10.25ms、P9021.82ms。原始每种子JSON未持久化，已丢失，不能伪造恢复；新的验收报告单独生成。

## 浏览器与硬件边界

早先系统Chromium被容器socket权限阻止。官方Playwright Headless Shell在原有环境约束下正常启动成功，正在独立补充WebGL视觉与交互检查。GitHub托管Chromium已通过真实E2E。Sites为私有站点，未登录浏览器会看到登录门；不把本地或CI验证冒充已登录生产站点测试。

M4 Pro、iMac Pro、RTX3080/Windows、真实Safari和真人试玩尚未测试；云CPU的CLI延迟不代表这些硬件的FPS。源资产原创程序化，静态产物约1.18MB原始 /328KB gzip，无外部模型、字体或音频请求。
