# Tampermonkey 脚本集合

个人使用的 Tampermonkey 用户脚本仓库，主要用于 `https://www.wanyiwan.top/*` 页面内的小游戏辅助、点击录制和变速测试。

## 安装方式

1. 安装浏览器扩展：[Tampermonkey](https://www.tampermonkey.net/)。
2. 打开 `scripts/` 目录中需要的脚本文件。
3. 复制脚本全部内容，在 Tampermonkey 中选择「添加新脚本」，粘贴并保存。

如果浏览器支持直接识别用户脚本，也可以打开脚本的 raw 地址，由 Tampermonkey 接管安装。

## 脚本列表

| 脚本 | 版本 | 用途 | 状态 |
| --- | --- | --- | --- |
| [`xjjd-auto-click-recorder.user.js`](scripts/xjjd-auto-click-recorder.user.js) | 2.1 | 自动点击录制器，支持录制、补充录制、循环回放、点位显示/编辑、导入导出 | 常用 |
| [`xjjd-ancient-ruins-bot.user.js`](scripts/xjjd-ancient-ruins-bot.user.js) | 4.3 | 小鸡舰队出击古代遗迹自动化，基于 Laya 场景节点识别 | 常用 |
| [`xjjd-admin-tools-toggle.user.js`](scripts/xjjd-admin-tools-toggle.user.js) | 1.0 | 扫描并开关 Laya 场景中疑似隐藏的管理/调试工具节点 | 实验 |
| [`xjjd-gm-tools-toggle.user.js`](scripts/xjjd-gm-tools-toggle.user.js) | 1.1 | 右上角小方块开关，显示/隐藏战斗场景内置 `btn_gm` 按钮 | 实验 |
| [`xjjd-jiasuqu-v4-debug.js`](scripts/xjjd-jiasuqu-v4-debug.js) | 4.0-debug | 变速调试面板，统计真实时间、页面时间、rAF FPS 和 Laya timer 数据 | 调试 |
| [`xjjd-jiasuqu-v3.js`](scripts/xjjd-jiasuqu-v3.js) | 3.0 | 变速实验版，通过 `Laya.timer.scale` 调整 Laya 引擎速度 | 实验 |
| [`xjjd-jiasuqu-v2.js`](scripts/xjjd-jiasuqu-v2.js) | 2.4 | 变速稳定版，通过虚拟 `Date` / `performance.now()` 影响时间流速 | 推荐对照 |
| [`xjjd-jiasuqu.js`](scripts/xjjd-jiasuqu.js) | 2.2 | 旧版变速脚本，重写 timer / rAF 并自行调度 | 归档 |

## 变速脚本怎么选

优先测试 `xjjd-jiasuqu-v3.js`。它只改 `Laya.timer.scale`，不劫持浏览器原生时间 API，理论上开销最低、影响范围最小。如果游戏逻辑完整跟随变速，这是最干净的方案。

如果 v3 只让部分动画变快，但倒计时、结算或战斗流程没有同步变化，再使用 `xjjd-jiasuqu-v2.js` 对照。v2 通过虚拟时间影响更多计时路径，兼容面更大，但对页面全局时间 API 的影响也更明显。

`xjjd-jiasuqu.js` 是旧版实现，保留用于回溯和对比，不建议优先使用。

需要分析加速效果时，可以临时启用 `xjjd-jiasuqu-v4-debug.js`。它不会主动加速，只显示真实时间、页面 `Date`、`performance.now()`、rAF FPS、`Laya.timer.currTimer`、`Laya.timer.currFrame` 等数据，方便判断当前脚本到底影响了哪些计时路径。

## 使用提示

- 这些脚本都匹配 `https://www.wanyiwan.top/*`，多数逻辑只在游戏 iframe 内运行。
- 自动点击录制器会把录制数据保存到浏览器本地 `localStorage`，清缓存或换浏览器会丢失本地数据；需要迁移时可使用导出/导入。
- 古代遗迹自动挂机依赖 Laya 场景节点名称，游戏更新后如果节点结构变化，可能需要重新适配。
- 变速脚本建议一次只启用一个版本，避免多个脚本同时改速度造成结果不可判断。

## 目录结构

```text
.
├── README.md
└── scripts/
    ├── xjjd-admin-tools-toggle.user.js
    ├── xjjd-ancient-ruins-bot.user.js
    ├── xjjd-auto-click-recorder.user.js
    ├── xjjd-gm-tools-toggle.user.js
    ├── xjjd-jiasuqu.js
    ├── xjjd-jiasuqu-v2.js
    ├── xjjd-jiasuqu-v3.js
    └── xjjd-jiasuqu-v4-debug.js
```

## 维护约定

- 新脚本统一放在 `scripts/` 目录下。
- 推荐使用 `xxx.user.js` 作为正式用户脚本文件名；实验或历史版本可以按当前项目习惯保留版本后缀。
- 新增或调整脚本后，同步更新本 README 的脚本列表和使用说明。
