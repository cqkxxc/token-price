"""
AI 模型比价爬虫 — 配置常量
canonical_id 映射、公司信息、供应商列表
"""
import os

# ── 路径 ──
CRAWLER_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(CRAWLER_DIR)
FRONTEND_DATA_DIR = os.path.join(PROJECT_DIR, "frontend", "site", "src", "data")

# ── 公司信息 ──
COMPANIES = {
    "openai":     {"slug": "openai",     "name": "OpenAI",      "name_zh": "OpenAI",     "logo_color": "#10a37f"},
    "anthropic":  {"slug": "anthropic",  "name": "Anthropic",   "name_zh": "Anthropic",  "logo_color": "#d97757"},
    "google":     {"slug": "google",     "name": "Google",      "name_zh": "Google",     "logo_color": "#4285f4"},
    "deepseek":   {"slug": "deepseek",   "name": "DeepSeek",    "name_zh": "DeepSeek",   "logo_color": "#4d6bfe"},
    "xai":        {"slug": "xai",        "name": "xAI",         "name_zh": "xAI",        "logo_color": "#0f172a"},
    "mistral":    {"slug": "mistral",    "name": "Mistral AI",  "name_zh": "Mistral AI", "logo_color": "#f97316"},
    "alibaba":    {"slug": "alibaba",    "name": "Alibaba",     "name_zh": "阿里云",       "logo_color": "#ff6a00"},
    "moonshot":   {"slug": "moonshot",   "name": "Moonshot",    "name_zh": "月之暗面",     "logo_color": "#7c3aed"},
    "zhipu":      {"slug": "zhipu",      "name": "Zhipu AI",    "name_zh": "智谱",        "logo_color": "#2563eb"},
    "minimax":    {"slug": "minimax",    "name": "MiniMax",     "name_zh": "MiniMax",    "logo_color": "#ec4899"},
    "bytedance":  {"slug": "bytedance",  "name": "ByteDance",   "name_zh": "字节跳动",     "logo_color": "#0f172a"},
    "baidu":      {"slug": "baidu",      "name": "Baidu",       "name_zh": "百度",        "logo_color": "#2932e1"},
    "tencent":    {"slug": "tencent",    "name": "Tencent",     "name_zh": "腾讯",        "logo_color": "#07c160"},
    "cohere":     {"slug": "cohere",     "name": "Cohere",      "name_zh": "Cohere",     "logo_color": "#39594d"},
    "voyage":     {"slug": "voyage",     "name": "Voyage AI",   "name_zh": "Voyage AI",  "logo_color": "#6366f1"},
    "xiaomi":     {"slug": "xiaomi",     "name": "Xiaomi",      "name_zh": "小米",        "logo_color": "#ff6900"},
}

# ── canonical_id → series 映射 ──
SERIES_RULES = [
    ("openai-gpt", "GPT"),
    ("anthropic-claude", "Claude"),
    ("google-gemini", "Gemini"),
    ("deepseek", "DeepSeek"),
    ("alibaba-qwen", "Qwen"),
    ("moonshot-kimi", "Kimi"),
    ("moonshot-moonshot", "Kimi"),
    ("zhipu-glm", "GLM"),
    ("minimax", "MiniMax"),
    ("bytedance-doubao", "Doubao"),
    ("xai-grok", "Grok"),
    ("mistral", "Mistral"),
    ("baidu-ernie", "ERNIE"),
    ("tencent-hunyuan", "Hunyuan"),
    ("cohere-command", "Command"),
    ("cohere-embed", "Command"),
    ("cohere-rerank", "Command"),
    ("voyage", "Voyage"),
    ("xiaomi-mimo", "MiMo"),
]

def guess_series(canonical_id: str) -> str:
    for prefix, series in SERIES_RULES:
        if canonical_id.startswith(prefix):
            return series
    return "Other"

# ── 公司名 → slug 映射 ──
def company_key(name: str) -> str:
    name_lower = name.lower().replace(" ", "").replace("-", "")
    mapping = {
        "openai": "openai", "anthropic": "anthropic", "google": "google",
        "deepseek": "deepseek", "xai": "xai", "mistralai": "mistral",
        "alibaba": "alibaba", "moonshot": "moonshot", "moonshotai": "moonshot",
        "zhipuai": "zhipu", "zhipu": "zhipu", "minimax": "minimax",
        "bytedance": "bytedance", "baidu": "baidu", "tencent": "tencent",
        "cohere": "cohere", "voyageai": "voyage", "xiaomi": "xiaomi",
    }
    return mapping.get(name_lower, name_lower)
