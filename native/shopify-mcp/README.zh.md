# shopify-mcp

[English](README.md) | 中文

Aeven 的 Shopify 连接器服务。连接器为每个已连接的店铺启动一个 stdio MCP 进程，因此模型在某个店铺中工作时，可通过 Shopify Admin GraphQL API 读取并修改它，而无需在任何工具调用中指定店铺。

## 每个店铺一个进程

连接器通过环境变量传入店铺及一个短期 Admin API 访问令牌。令牌来自 Aeven API，由其持有店铺的授权并负责刷新；令牌刷新后，进程会以新令牌重启。stdout 只承载 MCP 流。

## 环境变量

| 变量 | 含义 |
|---|---|
| `SHOPIFY_SHOP` | 店铺的 `<store>.myshopify.com` 域名；其他主机一律拒绝，因此令牌绝不会发往别处 |
| `SHOPIFY_ACCESS_TOKEN` | 该店铺的 Admin API 访问令牌 |
| `SHOPIFY_API_VERSION` | Admin API 版本，例如 `2026-10` |
| `SHOPIFY_MAX_RESULT_BYTES` | 单次调用返回的最大结果文本，至少 1024；更长的结果会在字符边界处截断并加以说明 |
| `SHOPIFY_REQUEST_TIMEOUT_MS` | 单次 Admin API 调用的网络时限 |

## 工具

| 工具 | `readOnlyHint` | 作用 |
|---|---|---|
| `get_shop` | true | 店铺名称、域名、货币、套餐及时区 |
| `describe_type` | true | 某个 Admin GraphQL 类型的字段、参数、输入字段及枚举值，便于模型编写有效文档 |
| `graphql_query` | true | 运行查询文档；定义了变更或订阅的文档在发出任何请求前即被拒绝 |
| `graphql_mutation` | false | 运行恰好定义一个变更的文档 |

连接器无需批准即可运行标注为 `readOnlyHint: true` 的工具，其他工具一律先征求批准。读取工具的拒绝机制保证了这一点：`aeven/graphql.ts` 中的分类器读取文档的每个顶层定义——跳过字符串、块字符串和注释——而不只看第一个词，因此能发现查询之后的变更。两个工具都会拒绝无法读取的文档。

结果包含 GraphQL 的 `data`、`errors` 和 `extensions`（含 Shopify 的查询开销）。令牌被拒、速率限制、HTTP 错误或没有 `data` 的结果都会作为失败调用返回。

## 构建与测试

`pnpm --dir native/shopify-mcp run build` 将 `aeven/` 编译为连接器启动的 `dist/main.js`；根目录的 `build:connectors` 步骤会运行它。`tests/` 下的测试随仓库单元测试运行，通过内存 MCP 客户端针对模拟的 Admin API 驱动这些工具。

## 已知限制与延后工作

- 分类器是针对 GraphQL 顶层结构的词法分析器，而非完整解析器，以免为一项判断引入 GraphQL 依赖；无法分类的文档一律拒绝，绝不运行。
- 批量操作和分段上传与其他变更一样经由 `graphql_mutation`；服务不提供轮询或上传辅助功能。
