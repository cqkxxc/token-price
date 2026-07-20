# stability.json — 供应商稳定性数据

> 每个 (供应商, 模型) 一对一的稳定性指标，用于比价页面展示每个中转站对特定模型的可用性。

## 路径

`frontend/site/src/data/stability.json`

## 数据结构

```json
{
  "updated_at": "2026-07-16T08:00:00Z",
  "stability": [
    {
      "supplier_slug": "dadao",
      "supplier_name": "刀刀中转API",
      "canonical_id": "openai-gpt-5.6-sol",
      "model_slug": "gpt-5.6-sol",
      "route": "default",
      "uptime_7d": 99.7,
      "avg_latency_ms": 280,
      "samples_7d": 336,
      "last_checked_at": "2026-07-16T08:00:00Z",
      "status": "online",
      "last_response_time_ms": 310,
      "last_http_status": 200,
      "last_error": null
    }
  ]
}
```

## 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `updated_at` | string(ISO) | 数据更新时间 |
| `stability` | array | 稳定性记录数组 |
| `stability[].supplier_slug` | string | 供应商 slug，关联 suppliers.json |
| `stability[].supplier_name` | string | 供应商展示名 |
| `stability[].canonical_id` | string | 模型 canonical_id，关联 models.json 和 prices.json |
| `stability[].model_slug` | string | 模型 slug，前端路由用 |
| `stability[].route` | string | 线路标识，default/hk/jp/us |
| `stability[].uptime_7d` | number | 7 天可用率百分比 (0-100)，基于 samples_7d 次探测计算 |
| `stability[].avg_latency_ms` | int | 7 天平均响应延迟（毫秒） |
| `stability[].samples_7d` | int | 7 天内探测次数（每 30 分钟一次 = 48*7 = 336） |
| `stability[].last_checked_at` | string(ISO) | 最后一次探测时间 |
| `stability[].status` | string | 当前状态：online/degraded/offline/unknown |
| `stability[].last_response_time_ms` | int | 最后一次探测的响应延迟 |
| `stability[].last_http_status` | int | 最后一次探测的 HTTP 状态码 |
| `stability[].last_error` | string\|null | 最后一次探测的错误信息，成功为 null |

## 前端使用方式

### 比价列表页

在模型表格中展示"该模型有多少个稳定在线的供应商"：

```ts
// 读取 stability.json
const stability = await fetch('data/stability.json').then(r => r.json());

// 对每个模型，查找其稳定性记录
function modelStability(modelSlug) {
  return stability.stability.filter(s => s.model_slug === modelSlug);
}

// 统计在线供应商数
function onlineCount(modelSlug) {
  return modelStability(modelSlug).filter(s => s.status === 'online').length;
}
```

### 比价抽屉

在每个供应商报价行显示该供应商对该模型的稳定性：

```ts
function getStability(supplierSlug, canonicalId) {
  return stability.stability.find(
    s => s.supplier_slug === supplierSlug && s.canonical_id === canonicalId
  );
}
// → { uptime_7d: 99.7, avg_latency_ms: 280, status: "online" }
```

## 与 suppliers.json 的区别

| | suppliers.json | stability.json |
|------|:---:|:---:|
| 粒度 | 供应商级别 | (供应商, 模型) 级别 |
| uptime_7d | 供应商整体可用率 | 该供应商对该特定模型的可用率 |
| 用途 | 监控页卡片 | 比价页表格 + 抽屉 |
