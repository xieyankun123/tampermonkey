# 油猴脚本集合

个人使用的 Tampermonkey / Greasemonkey 用户脚本仓库。

## 安装

1. 安装浏览器扩展：[Tampermonkey](https://www.tampermonkey.net/)
2. 打开对应脚本的 `.user.js` 文件，复制全部内容
3. 在 Tampermonkey 中「添加新脚本」，粘贴并保存

或直接点击仓库中的脚本文件，Tampermonkey 会提示安装。

## 脚本列表

| 脚本 | 说明 | 匹配站点 |
|------|------|----------|
| [xjjd-auto-click-recorder.user.js](scripts/xjjd-auto-click-recorder.user.js) | 极简自动点击录制器：录制点击序列，支持单次回放与循环回放 | https://www.wanyiwan.top/* |

## 目录结构

```
.
├── scripts/           # 所有 .user.js 脚本
│   └── xxx.user.js
└── README.md
```

## 新增脚本

新脚本请放在 `scripts/` 下，文件名建议使用 `xxx.user.js`，并在本 README 的「脚本列表」中补充一行说明。
