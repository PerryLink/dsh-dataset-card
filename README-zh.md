# dsh-dataset-card

**发布数据集时附上一份 Datasheet——并在发布前搞清楚个人数据在哪里。**

*在行数上限内对 CSV/TSV/JSON/JSONL 做画像，按列名和脱敏后的值模式标记疑似 PII 的列，拒绝把原始行存为证据，并导出带缺失章节警告的 Datasheet 风格卡片。*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24.9-brightgreen.svg)]()

[English](README.md) · 简体中文

---

## 它做什么

- **`dataset_inspect`** — 有界读取 `.csv`/`.tsv`/`.json`/`.jsonl`：列名、推断类型、缺失情况、抽样基数，以及基于列名和值模式的 PII 发现（email、电话、身份证号、IPv4、姓名/地址/出生日期/IP 列）。许可证与伦理声明是输入项；缺失会变成一个问题项。
- **`dataset_pii`** — 按种类和风险对脱敏后的发现分组，并给出下一步动作（去标识化、限制访问、记录同意）。
- **`dataset_card`** — Datasheet 风格卡片：Motivation、Composition（列表格）、Collection、Preprocessing、Uses、Distribution、Maintenance；缺失的章节会被列出，并转为 SARIF 警告。

## 隐私设计（有意为之）

- **原始值绝不进入输出。** PII 证据在模式层面脱敏（`***@***.***`、`1**********`、`*****************`）。
- **原始行绝不进入证据库。** REP 证据是*分析 JSON*；数据集只以一个 sha256 artifact 表示。
- **扫描是抽样，不是审计。** 扫描干净不等于证明已匿名；k-匿名、关联和自由文本字段不在范围内。

## 它不做什么

- **不做再识别或关联测试。**
- **不支持图像/PDF/文本语料数据集**——仅表格数据。
- **不支持 Excel/Parquet。** 请先转换为 CSV。
- **不做统计披露控制**（泛化、加噪、k-匿名）。
- **不强制执行许可证。** 只记录你声明的内容。

## 检查项

| 代码 | 严重级别 | 含义 |
|---|---|---|
| `no_license` | warning | 未声明许可证 |
| `pii_without_ethics` | error | 存在疑似 PII 列，但没有伦理/知情同意声明 |
| `duplicate_columns` | warning | 表头名称重复 |
| `scan_truncated` | info | 达到行数上限（画像结果是抽样） |
| `no_rows` | warning | 有表头但没有数据行 |
| `no_columns` | error | 未解析出任何内容 |

## 工具

### `dataset_inspect`

`{ path, label?, license?, ethics?, persist? }` → `{ ok, inspection, evidenceId?, recordPath? }`.

### `dataset_pii`

`{ inspection }` → `{ ok, summary: { risk, byKind, findings, recommendations } }`.

### `dataset_card`

`{ inspection, title?, description?, creators?, license?, ethics?, doi?, motivation?, composition?, collection?, preprocessing?, uses?, distribution?, maintenance? }` → `{ ok, card, markdown, sarif }`.

### 错误码

`INVALID_INPUT` · `NOT_FOUND` · `PATH_ESCAPE` · `NOT_A_FILE` · `TOO_LARGE` · `UNSUPPORTED_FORMAT` · `PARSE_ERROR` · `STORE_ERROR`

## 兼容性与安装

| | |
|---|---|
| DeepSeek Harness | **`dsh-v0.2.1-rc.5`**（2026-11-08 实测）；peer `>=0.2.1-0 <0.3.0 \|\| >=0.2.2-0 <0.3.0` |
| Node | `^22.19.0 \|\| >=24.9.0`（实测 `24.22.1`），仅 ESM |
| Peer 依赖 | `@perrylink/dsh-research-core ^0.1.0`、`@deepseek-ai/cordis ^4.0.5-alpha.1`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery ^3.18.5-alpha.1` |
| 运行时依赖 | **零** |

```sh
dsh plugin --profile <name> add @perrylink/dsh-research-core dsh-dataset-card
dsh --profile <name> --dump-config | grep dsh-dataset-card
```

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | `false` 时不挂载任何内容 |
| `root` | `.dataset-card` | 存储/记录根目录 |
| `workspaceRoot` | `process.cwd()` | 数据集路径必须解析到该目录内 |
| `maxBytes` | `20971520` | 文件上限（超限即失败，绝不截断） |
| `maxRows` | `10000` | 用于画像的扫描行数 |
| `persist` | `true` | 把分析结果（而非原始行）存为 REP 证据 |

## 安全边界

- 对数据集只读；只在 `root` 下写入。
- `realpath` 包含性校验；不支持的扩展名在读取前就被拒绝。
- 证据快照是分析 JSON；有测试断言记录文本不包含 fixture 中的 PII。
- 值只用于模式匹配，绝不写入日志。

## 评测

**13 个测试**：带引号的 CSV 解析（内嵌逗号、转义引号、换行）、类型推断、列画像与缺失情况、按列名和值模式检测 PII 并断言不泄漏、缺许可证与有 PII 却无伦理声明的问题、JSON/TSV 解析、行数上限截断、运行时（记录有效性、仅含分析结果的证据、sha256 数据 artifact）、路径穿越/不支持的格式/超大文件/解析错误/形状不符的拒绝、畸形 inspection 的工具防护、工具 schema、inspect→pii→card 端到端、失败分支、包契约。

不宣称任何基准成绩：这是基于规则的画像工具；其正确性在于脱敏和检查项，二者都由 fixture 固定。

## 已知限制（v0.1）

- PII 检测基于模式；自由文本列中的姓名、没有关键词的地址，以及可关联的准标识符都可能漏检。
- 基数是在扫描窗口内抽样得到的，不是整个数据集。
- CSV 解析假定只有一行表头，且没有类型元数据。
- 卡片从不核验你写进去的声明。

## 许可

Apache-2.0。运行时零第三方代码。
