# 潮汐指挥官 · Tidal Command

精致低多边形 3D 单人海战棋。React + TypeScript + Three.js / React Three Fiber + Vite，纯静态运行，无后端、账号或外部 AI API。支持 Sites 与 GitHub Pages。

## 开发

需要 Node.js22+、npm 和 Git LFS。

```sh
git lfs install
git clone https://github.com/Kamisato-Yuna/Tidal-Command.git
cd Tidal-Command
git lfs pull
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

受限环境可直接运行 `npx vite --host 127.0.0.1 --port 4173`。生产文件位于 dist。默认相对资源 URL 支持根站点、Sites 和项目子目录；如需显式 Pages 路径，使用 `VITE_BASE_PATH=/Tidal-Command/ npm run build`。

## 完整玩法

双方各有10×10棋盘，五舰长度5/4/3/3/2，合计17格。横竖连续、不能重叠，采用本项目约定的经典变体：不同舰船不能相邻（含斜角），每艘船与地图外边界接触的单元边总数最多1。角落不可放置，长舰不能沿外边平行摆放，端点垂直接触一条边合法。玩家先手，双方每回合炮弹数可设1–5，开战后固定，整轮结算后交换回合。普通命中不公开舰型或朝向；击沉后才公开占格与长度。敌舰未击沉时不会进入3D渲染器。

包括首页、难度选择、手动/随机部署、对战、结算、完整布局和攻击记录。舰船可从清单拖到棋盘；点击已部署舰船重新选中，点击空格移动，使用舰旁按钮或 R 原位旋转。非法移动/旋转保留原舰位。坐标始终面向屏幕。默认单发点击选中、再次点击取消，再确认开火；主动勾选「无需确认」后，单发点击即开火且无法取消。多发先选满目标再齐射，双方AI与玩家都必须在本轮反馈前锁定全部目标。方向键移动焦点，空格勾选多发目标，Enter确认。支持音量/静音、海浪环境音、快速模式、三档画质、减少动态效果和版本化本地续局。

所有舰船、海面、岛屿、粒子和声音均为原创程序化生成，不下载外部模型、字体或录音。五类舰船有独立舰体、舰桥、炮塔或飞行甲板等轮廓。

## 公平 AI

- 简单：随机搜索与有限追击，追击选择约65%。
- 普通：完整剩余舰队约束采样、多线索追击、近似等价目标随机混合；目标640完整样本、48,000节点、420ms内部时间预算。
- 普通布阵：开战前从24个符合当前放置规则的程序化候选中，以8组独立随机/追击/简单基线评价抽选。完全不读取玩家布局。
- Worker仅接收公开观察（含本局放置规则）、本轮炮弹数、独立决策随机状态、难度和对局/回合编号。1秒保护后只使用公开约束降级，并记录诊断。

这是近似约束采样，并非精确后验或数学最优。纯客户端的本地存档可被玩家自己查看，不声称服务端保密。历史及当前基准在 docs 和 src/ai/README.md 中明确区分，不将目标数值冒充实测。

## 自动化测试

```sh
npm test
npm run test:e2e
npm run benchmark -- --placement=classic --seeds=1000 --seed-start=400000 --out=/tmp/tidal-classic-acceptance.json
```

核心测试覆盖经典间距/边界、旧局相邻语义、原子齐射配额与胜利截断、不可重复攻击、结束后拒绝动作、隐藏状态不干扰性、完整候选合法性、存档事件重放及Worker取消/过期保护。React集成测试使用隔离渲染器和公开观察模拟Worker覆盖完整对局、续局和损坏存档；不等于真实WebGL验收。

Playwright使用已安装Chromium；如果系统没有浏览器，先 `npx playwright install chromium`。可用 `CHROMIUM_PATH=/path/to/chromium` 指定，或用 `TEST_BASE_URL=https://host/Tidal-Command/ npm run test:e2e` 检查已部署项目。CI在生产子路径运行完整对局及续局测试。

## 版本2更新与验证

- 新游戏采用上述经典变体、对称1–5发原子齐射、屏幕正向坐标、棋盘内编辑与公开舰队清单。
- 旧version1存档经过事件重放校验后迁移为version2，明确保留单发/允许相邻的原规则，界面标注「旧局相邻规则」。不把旧舰队偷偷套入新规则。
- 版本1的33项测试、5项生产E2E和1,000种子AI成绩保留为历史验证；83.50%/72.90%胜率仅适用于旧规则单发，不能视为新规则或多发成绩。
- 版本2独立复验见[迭代验证记录](docs/ITERATION-2.md)。新经典规则单发1,000种子中，普通对简单胜率99.15%、对固定追击基线98.65%；基线未利用全部新规则推理，不能外推为真人或多发成绩。目标GPU与真人试玩仍需实测。

历史版本环境、原始报告链接见[原验证记录](docs/VERIFICATION.md)。

## Git LFS

`.gitattributes` 将大型二进制源素材配置为LFS（模型、纹理、音频等）。当前素材全部程序化，因此实际LFS对象为零；规则已配置，不把未发生的对象上传描述为已验证。

- 克隆后执行 `git lfs install`、`git lfs pull`。
- 用 `git lfs ls-files` 查看已追踪对象。
- 新二进制源素材正常 `git add`、`git commit`、`git push`；Git LFS负责对象上传。
- 二进制源素材应保留在仓库，dist、node_modules和本地测试产物不提交。
- GitHub Actions checkout启用 `lfs: true`。

参考：[GitHub LFS配置](https://docs.github.com/en/repositories/working-with-files/managing-large-files/configuring-git-large-file-storage)、[安装](https://docs.github.com/en/repositories/working-with-files/managing-large-files/installing-git-large-file-storage)。

## 发布与许可

Sites部署构建后的dist目录；站点项目清单在部署工作区单独配置，不包含在此公开仓库中。GitHub Actions验证main/PR，可手动选择部署Pages。项目保留仓库原有MIT LICENSE；依赖各自许可及自制资产说明见ATTRIBUTIONS.md与THIRD_PARTY_NOTICES.md。

M4 Pro、iMac Pro、RTX3080/Windows、真实Safari和真人试玩仍需目标环境验证；容器基准不能代表这些硬件的FPS或人类胜率。
