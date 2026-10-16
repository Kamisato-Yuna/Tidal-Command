# 验证记录与重建说明

2026-10-16。源文件曾因执行环境替换丢失，现从保留内容恢复并重新检查。历史结果不得自动视为当前代码验证。

## 当前重建版本

- npm run typecheck / npm run build：重新执行通过。
- 27/27测试重新执行通过（24项核心与3项React界面集成），覆盖完整单局、恢复待执行AI回合、损坏存档等。
- 新64种子正式预算冒烟结果见 src/ai/reconstructed-benchmark-64.json：Normal44.48平均攻击，HuntTarget49.89，Easy62.42；Normal对Easy79.69%，对HuntTarget75.00%；10,293次决策无降级/超时。
- 新1,000种子正式验收正在运行，报告完成后写入 docs/ai-acceptance-reconstructed-1000.json。

## 历史结果（不是重建版本验收）

原环境曾执行27项测试和1,000种子验收。实际保留的汇总为：Normal45.768平均攻击，HuntTarget51.330，Easy61.632，Random95.314；交换先手Normal对Easy82.65%（95%区间80.40–84.85），对HuntTarget75.20%（72.50–77.80）。158,890次Normal决策中2次降级、47次内部时间保护，平均10.25ms、P9021.82ms。原始每种子JSON未持久化，已丢失，不能伪造恢复；新的验收报告单独生成。

## 浏览器与硬件边界

早先本地Chromium被容器socket权限阻止，环境外启动也未成功；没有把jsdom或构建当作浏览器验收。待真实Sites页面完成部署后补充云浏览器验证与截图。

M4 Pro、iMac Pro、RTX3080/Windows、真实Safari和真人试玩尚未测试；云CPU的CLI延迟不代表这些硬件的FPS。源资产原创程序化，静态产物约1.18MB原始 /328KB gzip，无外部模型、字体或音频请求。
