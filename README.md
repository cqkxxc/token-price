# AI 模型比价与监控信息平台

<p align="center">
  <strong>面向开发者、产品经理和技术负责人的 AI 模型价格对比与供应商可用性监控平台。</strong>
</p>

<p align="center">
  展示市面主流 AI 模型的官方公开价格和第三方中转站报价，支持按厂商、模型名和能力筛选排序，并提供供应商 API 可用性监控。
</p>

## 功能特性

### 比价列表
- 展示 16+ 官方厂商、50+ 模型的公开定价目录
- 统一以人民币（CNY）/ 百万 tokens 计价
- 支持按厂商、模型系列、能力、价格单位筛选
- 支持搜索和多种排序（综合价、输入价、输出价、模型名）
- 响应式设计，桌面端与移动端均适配

### 比价详情
- 点击任意模型查看多供应方（官方 + 中转站）报价对比
- 每条报价标注供应方类型、线路、折扣和来源链接
- 桌面端抽屉 / 移动端底部弹层交互
- 独立 SEO 模型详情页 `/models/[slug]`

### 监控探活
- 每 30 分钟探测各供应商 API 可用性与延迟
- 监控总览页展示所有供应商在线状态、可用模型数、7 天可用率
- 供应商详情页查看单个供应商所有模型的可用记录

## 阶段规划

| 阶段 | 目标 | 时间 |
|------|------|:----:|
| **阶段一（当前）** | 信息平台：比价 + 监控 + SEO，跑通流量模型 | 1-2 个月 |
| **阶段二** | 交易层 MVP：统一 API + 按量付费 | 3-4 个月 |
| **阶段三** | 完整闭环：企业版 + 海外模型 | 6+ 个月 |

### MVP 不包含
- API 调用网关 / 用户 Key 管理
- 用户账号（登录、收藏、团队协作）
- 购买闭环（下单、充值、支付）
- 模型质量评测与速度测试
- 中转站可信度评分
- 运行时的价格实时查询接口

## 技术架构

### 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                    GitHub Actions                             │
│                   (定时触发 · 免费额度)                         │
│                                                              │
│  ┌──────────┐    ┌──────────────┐                            │
│  │ 爬虫脚本  │    │ 监控探测脚本  │                            │
│  │ Python   │    │ Python       │                            │
│  │          │    │ HTTP 探测    │                            │
│  │ 抓取官方 │    │ 各供应商 API │                            │
│  │ 定价 +   │    │ 记录延迟/状态 │                            │
│  │ 供应商报价│    │              │                            │
│  └────┬─────┘    └──────┬───────┘                            │
│       │                 │                                    │
│       ▼                 ▼                                    │
│  ┌──────────────────────────────────────┐                    │
│  │  public/data/ (JSON)                  │                    │
│  │  models.json  suppliers.json          │                    │
│  │  prices.json  monitor.json            │                    │
│  └────────────────┬─────────────────────┘                    │
│                   │                                          │
│                   ▼                                          │
│  ┌──────────────────────────────────────┐                    │
│  │  Astro 构建 (npm run build)           │                    │
│  │  读取 JSON → 组件渲染 → 静态 HTML     │                    │
│  └────────────────┬─────────────────────┘                    │
│                   │                                          │
└───────────────────┼──────────────────────────────────────────┘
                    │ git commit & push
                    ▼
┌──────────────────────────────────────────────────────────────┐
│                   Git 仓库 (GitHub)                            │
│  /crawler/        → 爬虫脚本                                  │
│  /site/           → Astro 项目源码                             │
│  /site/public/data/ → 爬虫产出的 JSON                          │
│  /site/dist/      → 构建产物                                   │
└──────────────────────────────┬───────────────────────────────┘
                               │ rsync
                               ▼
┌──────────────────────────────────────────────────────────────┐
│               腾讯云轻量应用服务器 (1C1G 3Mbps)                 │
│                                                              │
│  Nginx                                                       │
│  ├── /            → dist/index.html     (比价列表)            │
│  ├── /models/*    → dist/models/*.html  (模型详情)            │
│  ├── /monitor     → dist/monitor.html    (监控总览)           │
│  ├── /monitor/*   → dist/monitor/*.html  (供应商详情)         │
│  ├── /admin       → dist/admin.html      (管理后台 SPA)       │
│  └── /data/*      → dist/data/*.json     (前端数据)           │
└──────────────────────────────────────────────────────────────┘
```

### 技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| **框架** | Astro 4 | 内容站专精，SSG/SSR 一键切换，极小的构建产物 |
| **UI 组件** | React 18 + TypeScript | 交互组件（表格/筛选/搜索） |
| **样式** | Tailwind CSS | 与 Astro 搭配构建产物更轻 |
| **数据获取** | `src/lib/data.ts` 统一封装 | 阶段一 import JSON，阶段二改为 fetch API |
| **构建产物** | 纯静态 HTML + CSS + 少量 JS | Nginx 直接托管 |
| **爬虫** | Python (requests + lxml/bs4) | 生态成熟，采集高效 |

### 核心设计原则

- **数据即静态文件** — 所有数据以 JSON 文件形式存在，不依赖运行时数据库
- **爬虫生产数据，前端消费数据** — 爬虫是唯一的数据写入者，前端是唯一的展示者
- **构建时渲染，运行时零服务端** — 阶段一 Nginx 返回纯静态文件，不跑 Node.js
- **搜索引擎原住民** — 每个模型独立 HTML 页面，内容在源码中完全可见
- **极低成本** — 最低配服务器仅用于备案 + Nginx 静态托管，月度成本控制在 20 元以内

## 项目结构

```
project-root/
├── crawler/                       # 爬虫（Python）
│   ├── fetch_official.py          # 官方定价抓取
│   ├── fetch_suppliers.py         # 供应商报价抓取
│   ├── probe_monitor.py           # 监控探测
│   ├── merge.py                   # normalize + validate
│   ├── run.sh                     # 一键执行
│   └── requirements.txt
├── site/                          # Astro 前端项目
│   ├── astro.config.mjs
│   ├── package.json
│   ├── tailwind.config.mjs
│   ├── public/
│   │   ├── data/                  # 爬虫产出的 JSON
│   │   │   ├── models.json
│   │   │   ├── prices.json
│   │   │   ├── suppliers.json
│   │   │   ├── monitor.json
│   │   │   └── meta.json
│   │   └── img/logos/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── index.astro
│   │   │   ├── models/[slug].astro
│   │   │   ├── vendors/[vendorId].astro
│   │   │   ├── capabilities/[capability].astro
│   │   │   ├── monitor.astro
│   │   │   ├── monitor/[slug].astro
│   │   │   └── admin.astro
│   │   ├── components/
│   │   │   ├── Layout.astro
│   │   │   ├── PriceTable.tsx
│   │   │   ├── FilterBar.tsx
│   │   │   ├── SearchBar.tsx
│   │   │   ├── ModelCard.tsx
│   │   │   ├── SupplierPriceRow.tsx
│   │   │   ├── SupplierStatusCard.tsx
│   │   │   ├── MonitorSummary.tsx
│   │   │   ├── CompareDrawer.tsx
│   │   │   └── CompareTable.tsx
│   │   ├── lib/
│   │   │   └── data.ts            # 数据获取层
│   │   └── styles/
│   │       └── global.css
│   └── dist/                      # 构建产物 → 部署到 Nginx
├── server/                        # 管理后台 API
│   ├── api.py                     # FastAPI 单文件
│   └── requirements.txt
├── .github/workflows/
│   └── crawl.yml                  # 定时爬虫 + 部署
└── nginx.conf                     # Nginx 配置
```

## 数据管道

### 采集流程

```
官方定价页面 ──┐
供应商 API ────┤
供应商网站 ────┼──→ scrape → normalize → validate → JSON → Astro 构建 → HTML
```

1. **scrape** — 各 adapter 采集原始报价
2. **normalize** — 映射到 `canonicalModelId`，统一字段，统一为 CNY 计价
3. **validate** — 阻止坏数据进入构建，失败时保留上一版有效价格

### 首批数据源

| 来源 | 类型 | 采集频率 |
|------|------|:--------:|
| OpenAI / Anthropic / DeepSeek 等官网 | 官方定价 | 每天 |
| Krill / CCGUI 等中转站 | 第三方报价 | 每天 |
| 各供应商 `/v1/models` | 监控探测 | 每 30 分钟 |

### 数据校验

- 采集失败时保留上一版有效价格，不用空数据覆盖
- 校验失败 → 停止构建部署，保留线上上一版页面
- CI 日志中输出失败 provider 和失败原因

## 开始使用

### 环境要求

- Node.js 22+
- Python 3.11+
- npm

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/cqkxxc/token-price.git
cd token-price/site

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 构建

```bash
cd site
npm run build
# 构建产物在 site/dist/
```

### 运行爬虫

```bash
cd crawler
pip install -r requirements.txt
bash run.sh
```

## 部署

### 服务器配置

推荐腾讯云轻量应用服务器（1C1G 3Mbps），Nginx 静态托管：

```bash
# 服务器初始化
apt update && apt install nginx certbot python3-certbot-nginx -y

# 拉取站点
cd /var/www
git clone <repo-url> site

# 配置 Nginx（项目提供 nginx.conf）
cp nginx.conf /etc/nginx/sites-available/default
nginx -t && systemctl reload nginx

# SSL
certbot --nginx -d your-domain.com
```

### 自动化部署

GitHub Actions 定时执行爬虫并自动 rsync 部署到服务器。

### 阶段一部署拓扑

```
阶段一                       阶段二
Nginx :80                     Nginx :80
├── / → dist/index.html       ├── / → proxy_pass http://127.0.0.1:4321
├── /models/*.html             ├── /api/* → proxy_pass http://127.0.0.1:3001
├── /monitor.html              ├── /data/* → dist/data/*.json
├── /data/*.json               └── /admin → dist/admin.html
(纯静态，无 Node 进程)          (加 proxy_pass + Node 进程)
```

## 首批收录厂商

| 厂商 | vendorId | 覆盖模型 |
|------|----------|----------|
| OpenAI | `openai` | GPT 系列 |
| Anthropic | `anthropic` | Claude 系列 |
| Google | `google` | Gemini 系列 |
| DeepSeek | `deepseek` | DeepSeek Chat / Reasoner |
| xAI | `xai` | Grok 系列 |
| Mistral AI | `mistral` | Mistral / Codestral / Pixtral |
| Alibaba (Qwen) | `qwen` | Qwen / Wan / Embedding / Rerank |
| Moonshot (Kimi) | `kimi` | Kimi 系列 |
| Zhipu AI (GLM) | `zhipu` | GLM 系列 |
| MiniMax | `minimax` | 文本 / 语音 / 视频 |
| ByteDance (Doubao) | `doubao` | Doubao 系列 |
| Baidu (ERNIE) | `baidu` | ERNIE / Embedding |
| Tencent (Hunyuan) | `hunyuan` | Hunyuan 系列 |
| Cohere | `cohere` | Command / Embed / Rerank |
| Voyage AI | `voyage` | Embedding / Rerank |
| Xiaomi (MiMo) | `xiaomi` | MiMo 系列 |

## 视觉风格

面向国内用户的工具型价格站，风格关键词：**简单、自然、舒服、自信**。

- 白色或极浅灰背景，内容以表格和价格信息为中心
- 价格数字使用等宽数字字体（`font-variant-numeric: tabular-nums`）
- 最低价使用绿色小徽标
- 官方供应方使用中性色标签，中转站使用浅蓝标签
- 首屏突出筛选和价格表，不做营销式排版
- 不采用大面积蓝紫渐变、装饰性光斑、多层卡片嵌套

## 数据格式

所有价格数据统一以人民币（CNY）/ 百万 tokens 计价，无运行时汇率换算。

### models.json

```json
{
  "slug": "gpt-5.5",
  "display_name": "GPT-5.5",
  "company": { "slug": "openai", "name": "OpenAI" },
  "series": "GPT",
  "capabilities": ["对话", "长文本处理", "多模态融合"],
  "pricing_method": "per_token",
  "official_input_price": 33.9725,
  "official_output_price": 203.835
}
```

### prices.json

```json
{
  "model_slug": "gpt-5.5",
  "supplier_slug": "linkapi",
  "supplier_type": "relay",
  "input_price": 0.08,
  "output_price": 0.50,
  "combined_price": 0.58,
  "source_url": "https://linkapi.ai/pricing"
}
```

## 页面路由

| 路由 | 页面 | SEO |
|------|------|:---:|
| `/` | 比价列表首页 | ✅ SSG |
| `/models/[slug]` | 模型详情（多供应商比价） | ✅ SSG |
| `/vendors/[vendorId]/` | 某官方厂商模型目录 | ✅ SSG |
| `/capabilities/[capability]/` | 某能力分类下的模型 | ✅ SSG |
| `/monitor` | 监控状态总览 | ✅ SSG |
| `/monitor/[slug]` | 供应商详情 | ✅ SSG |
| `/admin` | 数据管理后台 | ❌ CSR |

## License

MIT
