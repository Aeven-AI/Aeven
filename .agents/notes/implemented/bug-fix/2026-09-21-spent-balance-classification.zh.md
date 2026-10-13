# Agent Note：一次没有被读出来的余额耗尽

Status: implemented

[English](2026-09-21-spent-balance-classification.md) | 中文

## Problem

一个正在运行某会话及其六个子代理的账户被拒绝了一次回合，而读者看到的提示是*「your Æven inference balance is used up; add credit or upgrade your plan to continue」*——可当时余额里还有 1.47 美元，同一账户的其他会话仍在被正常服务，各个代理也继续在工作。这里同时撞上了两个彼此独立的缺陷，而且只有其中一个出在网关身上。

**客户端读不懂自己网关发来的失败。** 面对一条无力承担的请求，网关返回 `{"error":{"message":…,"type":"insufficient_inference_balance","code":"AEVEN_INFERENCE_BALANCE_EXHAUSTED"}}` 与 402。`@aeven/llm-deepseek` 中的 `httpErrorCode` 处理非 2xx 的方式，是把 code、type 与 message 拼成一个字符串后交给 `isQuotaExceededError` 判断——而该识别器里的每一条模式都以 `\b` 为锚。单词边界在下划线连接的记号内部不会触发：`AEVEN_INFERENCE_BALANCE_EXHAUSTED` 中 `BALANCE` 之前的字符是 `_`，而 `_` 属于单词字符；`insufficient_inference_balance` 同理。网关所选的那句措辞「balance is used up」也不在任何模式之中。于是，这个唯一由网关亲口给出了补救办法的失败，落到了兜底分支上，成了 `HTTP_402`——一个下游没有任何东西会当作终态处理的未知代码。

**拒绝所陈述的金钱事实是错的。** `insufficient_balance` 覆盖两种不同的事实，而消息对两者一视同仁。当账户完全没有余额时它是这样；当余额存在、但已在飞行中的请求把余额全部占住时，它也是这样：一笔占用是该请求的最坏情况——提示词按未命中缓存的费率计价，再加上模型的全部输出额度——并且在请求运行期间一直占着。六个会话各占几分钱，就足以把一笔小额余额占满，于是第七个到达者被拒绝。而账户仍然拥有其中每一微美元。这是一次有明确补救办法的临时性拒绝，消息却在描述一个已经花光的账户。

## Decision

`isQuotaExceededError` 现在用 `(?:^|[^a-z0-9])` 作为边界来匹配资金耗尽的措辞，而不再用 `\b`；这样下划线连接的 `code` 或 `type`，会与同一事实的任何其他拼写一样被读出：`insufficient_inference_balance`、`AEVEN_INFERENCE_BALANCE_EXHAUSTED`、「your balance is used up」、「credits depleted」。这两条模式保持独立且各有其名——一条负责「insufficient」这一族措辞，一条负责被描述为已经消失的余额或额度——因为代码与句子存在于不同的字段里，而任何单独一个都必须足够。

拒绝现在携带那些能区分两种事实的数字。双口袋 Lua 脚本返回账户余额、在飞行中的占用已占住多少、以及留给本条请求多少；`ReservationService` 把它们转发出来，`QuotaService.admit` 把它们带进错误对象，`errorForRefusal` 则把它们陈述出来：*「insufficient balance: $1.27 of your $1.45 is already held by requests in flight, leaving $0.17 free for this one.」* 拒绝保留其代码、状态与终态含义——由「insufficient balance」这几个词领起——而数字让它变得可回答。完全没有占用的账户，则保持它一直以来的措辞，因为在那里那句话本来就是真的。

只有当确有占用时消息才会改变。在预留脚本之外产生的拒绝，没有任何在飞行中的占用可指名，而在那个位置写一个零，读起来会像「没有任何占用」，而不是像「没有人去数过」。

## Alternatives considered

**把在飞行中的占用命名为一个新的拒绝原因。** 一个独立的 `balance_committed` 原因，会在源头而不是在消息里区分这两种情况。拒绝：客户端本就在 `AEVEN_INFERENCE_BALANCE_EXHAUSTED` 上分支以渲染充值操作，而一个新代码会让那少数认识它的客户端悄悄走上未知代码那条路——正是本笔记所讨论的那种失败。两种情况的补救完全相同，不同的只是解释，而解释就是一句话加两个数字。

**把可动用余额作为 `availableBalance` 上报。** 这个成员已经存在，界面也在显示它；把它填成本条请求真正能动用的金额，会让拒绝的算术自洽。拒绝：在所有其他被读取之处，这个成员都表示账户余额。一个数字在某个界面上表示「你的钱」、在下一个界面上表示「你的钱减去其他请求所占」，比一句把两者都说清楚的消息更糟。

**不改分类，只改网关的措辞。** 如果消息从一开始就说「insufficient balance」，那条以 `\b` 为锚的模式本会匹配上。拒绝作为修复方案：它只修好了一种拼写，却让识别器仍旧读不出下划线连接的代码，而任何兼容网关的机器可读代码都正是这样拼写的——客户端下一次仍会对这类响应体视而不见。

## Consequences

余额耗尽如今在测试框架里是终态：它映射为 `QUOTA_EXCEEDED_CODE`，因此路由的重试策略永不重试它，客户端也能提供它所点名的补救办法。[retry.spec.ts](../../../../packages/llm/llm-retry/tests/retry.spec.ts) 固定了客户端这一半——以这种方式被拒绝的回合在失败上结束，没有重试事件，也没有被安排任何定时器——而 [adapter.spec.ts](../../../../packages/llm/llm-deepseek/tests/adapter.spec.ts) 固定了分类本身，其中包括：一个对资金只字未提的 402，仍然是 `HTTP_402`，而不是变成把每个 402 都称作余额耗尽的许可证。

同一事故的服务端在 `servers/node` 中被固定下来，因为钱在那里：针对一笔购买余额的并发突发请求，被服务的规模永远不得超过余额；被拒绝的请求永远不会抵达提供方；占用计数器在突发期间从不超过余额；而在同类占住资金时被拒绝的请求，在其一结清的那一刻即可被接受。这些都是跑在真实 Redis 与真实脚本之上的端到端测试，因为该不变量是 Redis 对那段脚本的单线程执行，而用一个替身只会是在测试替身本身。

这次事故**不是**超支。事发期间被服务的每一个请求，在被接受时都是有资金担保的；被拒绝的请求从未变成一次提供方调用；对账器也没有发现任何钱包未曾扣取的收费。账户从来不是没有钱；它是没有可*占用*的钱——那是另一种状态，需要另一句话来说。
