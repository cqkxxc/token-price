# PRD 图标资源

本目录按 `PRD.md` 的首批官方厂商和附录 D 首批模型清单整理。

- `vendors/`：官方厂商或产品站图标。
- `models/`：模型系列图标。多数 SKU 没有单独官方图标，因此按系列复用所属厂商或产品线图标。
- `manifest.json`：图标来源、PRD 映射和复用说明。

补充说明：

- SVG 优先来自 Simple Icons CDN；没有可用 SVG 的条目使用官网 favicon。
- xAI 官方 docs favicon 当前网络不可达，`xai.svg`/`grok.svg` 复用 Simple Icons 的 X 图标。
- ByteDance Volcano / Doubao、Baidu Qianfan / ERNIE、Tencent Hunyuan 分别复用 ByteDance、Baidu、Tencent 图标。
- PRD 中首批中转站 `Krill`、`CCGUI` 未找到稳定公开 logo 来源，本次未生成供应商图标。
