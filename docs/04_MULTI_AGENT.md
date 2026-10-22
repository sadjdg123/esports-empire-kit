# 多 Agent 协作说明

> 先说结论：**推荐方案 A**。方案 B 能更快，但需要 git 合并，出问题时门哥很难自己处理。

## 方案 A（推荐）：一个开发 + 一个审查

| 角色 | 建议工具 | 职责 |
|---|---|---|
| 主开发 | Claude Code（或 Codex） | 按顺序做 T00–T11 |
| 代码审查 | Codex（或 Claude Code，只要和主开发不是同一个） | 每个任务完成后审查，只提问题不改代码 |
| 策划审查（可选） | Grok Bot 或任意聊天 AI | 看汇报、战报、平衡报告，从"好不好玩、数值合不合理"角度提意见 |

### 流程
1. 主开发完成任务 Txx，写汇报，停下。
2. 门哥把审查提示词（见 README）发给审查 Agent。
3. 审查 Agent 输出"必须修 / 建议修"清单。
4. 门哥把清单原样转给主开发："请处理审查意见中'必须修'的部分，'建议修'你判断后说明处理与否。"
5. 主开发修完再汇报，门哥回复"继续"进入下一个任务。

### 审查 Agent 的规则
- 只读，不改代码，不提交。
- 必须真的运行 `npm test` 和 `npm run lint`，报告实际结果。
- 对照 `02_P0_TASKS.md` 中该任务的"验收"逐条检查。
- 检查是否越界修改了范围外的文件、是否违反 AGENTS.md 的硬性规则（尤其确定性和模块分离）。

### 策划审查 Agent 的提示词（可直接复制）
```
你是电竞经营游戏的策划顾问。下面是游戏设计文档、当前任务汇报和比赛战报/平衡报告。
请从玩家体验角度回答：①战报看得懂吗，能不能看出赛前选择的影响 ②数值有没有明显不合理
③有没有会让玩家觉得无聊或不公平的地方。每条意见说明原因，按"重要/一般"分类，不超过 10 条。
```
然后把 `docs/01_GDD.md`、最新汇报、`docs/reports/` 里的报告一起发给它。

---

## 方案 B：三个开发 Agent 并行

只有在以下条件都满足时才用：
- 门哥愿意学几条 git 命令，或者有一个 Agent 专门负责合并。
- T00 和 T01 已经由同一个 Agent 完成并提交（接口已冻结）。

### 分工

| Agent | 代号 | 负责任务 | 只能修改的目录 |
|---|---|---|---|
| 整合负责人（建议 Claude Code） | LEAD | T00、T01、T11，合并其他人的成果，唯一可改 `src/core` | 全部（整合时） |
| 模拟 Agent | A | T02–T06 | `src/sim/`、`tools/`、`src/data/match.json`、`src/data/heroes.json`、`tests/sim/`、`docs/reports/` |
| 经营 Agent | B | T07、T08 | `src/game/`、`src/save/`、`src/data/economy.json`、`src/data/players.json`、`src/data/clubs.json`、`tests/game/`、`tests/save/` |
| 界面 Agent | C | T09、T10 | `src/ui/`、`src/render/`、`src/main.tsx`、`public/`、`tests/ui/` |

LEAD 可以同时兼任 A。

### 并行时间线
```
LEAD: T00 → T01 ─┬────────────────────────────── 合并 ── T11
A   :            └→ T02 → T03 → T04 → T05 → T06 ┐
B   :            └→ T07 → T08 ──────────────────┤
C   :            └→ T09（假数据）→ T10（假快照）┘
```
- GATE-1 仍然有效：A 完成 T06 后，门哥确认平衡报告。B 和 C 可以在此期间先做，但 C 的 T10 要等 A 的 T05 合并后才能接真实引擎。
- C 在等待期间，用 `src/core/types.ts` 中的类型自己造假数据（放在 `src/ui/mocks/`、`src/render/mocks/`，整合时删除或保留为开发工具）。

### git 规则
- 每个 Agent 在自己的分支工作：`agent-a/sim`、`agent-b/game`、`agent-c/ui`。
- 只修改自己的目录。需要改别人目录或 `src/core` 时，在 `docs/DECISIONS.md` 写申请，由 LEAD 处理。
- 每完成一个任务提交一次，并更新 `docs/PROGRESS.md` 中**自己那一行**（避免互相冲突）。
- 合并由 LEAD 完成：合并后必须 `npm test`、`npm run lint`、`npm run build` 全部通过。

### 每个 Agent 的启动提示词

**LEAD**
```
你是本项目的整合负责人（LEAD）。请完整阅读 AGENTS.md 和 docs 下全部文件，特别是 docs/04_MULTI_AGENT.md 方案 B。
你负责 T00、T01，之后负责合并其他 Agent 的分支和 T11。只有你可以修改 src/core。
读完先用中文复述你的职责和第一步计划，等我回复"开始"。
```

**Agent A（模拟）**
```
你是本项目的模拟 Agent（A）。请完整阅读 AGENTS.md 和 docs 下全部文件，特别是 docs/04_MULTI_AGENT.md 方案 B。
你负责 T02–T06，只能修改该文档为你列出的目录，在分支 agent-a/sim 上工作。
需要修改 src/core 时在 docs/DECISIONS.md 写申请并停下。
读完先用中文复述你的职责和第一步计划，等我回复"开始"。
```

**Agent B（经营）**
```
你是本项目的经营 Agent（B）。请完整阅读 AGENTS.md 和 docs 下全部文件，特别是 docs/04_MULTI_AGENT.md 方案 B。
你负责 T07、T08，只能修改该文档为你列出的目录，在分支 agent-b/game 上工作。
T07 需要调用比赛引擎时，如果 A 还没完成，先用一个返回固定结果的假 runMatch 做测试，并在汇报中说明。
读完先用中文复述你的职责和第一步计划，等我回复"开始"。
```

**Agent C（界面）**
```
你是本项目的界面 Agent（C）。请完整阅读 AGENTS.md 和 docs 下全部文件，特别是 docs/04_MULTI_AGENT.md 方案 B。
你负责 T09、T10，只能修改该文档为你列出的目录，在分支 agent-c/ui 上工作。
经营逻辑或比赛引擎还没完成时，用 src/core/types.ts 的类型自己造假数据。
读完先用中文复述你的职责和第一步计划，等我回复"开始"。
```

### 关于 Grok Bot
如果你的 Grok Bot 能在服务器上读写项目文件夹并运行命令，可以担任 A、B、C 中的任意一个；如果它只能聊天，请让它做"策划审查"，不要让它写代码——它看不到项目文件，写出来的代码无法验证。
