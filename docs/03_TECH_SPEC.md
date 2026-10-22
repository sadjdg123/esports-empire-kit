# 技术规范 · P0

> 本文规定代码结构、模块边界、核心接口和比赛引擎设计。接口在 T01 完成后**冻结**，之后修改须走第 8 节的变更流程。

## 1. 技术栈

| 用途 | 选择 |
|---|---|
| 语言 | TypeScript，`strict: true` |
| 开发/打包 | Vite |
| 测试 | Vitest |
| 管理界面 | React（函数组件 + hooks，不引入状态管理库，除非汇报说明理由） |
| 比赛画面 | Phaser（最新稳定大版本，T00 时确认版本号记入 DECISIONS.md） |
| 命令行工具 | `tsx` 运行 TypeScript 脚本 |
| Node 版本 | 20 或更高 |

## 2. 目录结构

```
esports-empire/
├─ AGENTS.md / CLAUDE.md / README.md
├─ docs/                    文档
├─ src/
│  ├─ core/                 共享类型、随机数、配置读取（T01 后冻结）
│  │  ├─ types.ts
│  │  ├─ rng.ts
│  │  └─ config.ts
│  ├─ data/                 JSON 数据：heroes / players / clubs / economy / match
│  ├─ sim/                  比赛引擎（纯逻辑）
│  │  ├─ map.ts             节点图与最短路
│  │  ├─ units.ts           英雄单位、兵团、塔、基地
│  │  ├─ combat.ts          伤害、技能、死亡复活
│  │  ├─ ai.ts              角色决策
│  │  ├─ tactics.ts         战术对决策权重的影响
│  │  ├─ engine.ts          createMatch / step / runMatch
│  │  ├─ events.ts          事件日志
│  │  └─ report.ts          战报生成
│  ├─ game/                 经营逻辑（纯逻辑）：市场、签约、财务、赛程、AI 俱乐部
│  ├─ save/                 存档序列化、版本迁移、校验（纯逻辑，存储方式通过接口注入）
│  ├─ ui/                   React 管理界面
│  ├─ render/               Phaser 比赛画面
│  └─ main.tsx              网页入口
├─ tools/
│  └─ sim-cli.ts            批量模拟与平衡报告
└─ tests/                   与 src 结构对应的测试
```

### 依赖方向（硬性）
```
ui ──┐
     ├──> game ──> sim ──> core
render ┘      └──> save ──> core
```
- `core` 不依赖任何人。
- `sim`、`game`、`save` 只依赖 `core`（`game` 可调用 `sim`）。这四个目录禁止出现 DOM、React、Phaser、`window`、`localStorage`。
- `ui` 和 `render` 可以依赖所有逻辑模块，但逻辑模块不能反过来依赖它们。
- 建议在 T00 用 ESLint 规则（`no-restricted-imports`）自动检查。

## 3. 确定性规则

- 唯一随机来源：`src/core/rng.ts`，实现一个小型带种子的伪随机生成器（例如 mulberry32 或 sfc32，自己实现，不引入依赖）。
- 接口：
  ```ts
  export interface Rng {
    next(): number;                 // [0, 1)
    int(min: number, max: number): number; // 含两端
    pick<T>(arr: readonly T[]): T;
    chance(p: number): boolean;
    fork(label: string): Rng;       // 派生独立子随机流，避免一处多抽一次影响全局
    state(): number[];              // 用于存档
  }
  export function createRng(seed: number): Rng;
  ```
- 模拟中遍历对象时必须使用稳定顺序（数组或排序后的键），不依赖对象插入顺序以外的不确定行为。
- 浮点运算保持在同一实现内，不使用 `Math.random`、`Date`、`performance.now`。
- 每场比赛结束输出 `checksum`（对最终状态和事件日志做简单哈希），用于复现测试。

## 4. 核心类型（`src/core/types.ts`）

以下是 T01 必须实现的最小集合。字段可以增加，不能删除或改名（改动走变更流程）。

```ts
export type Role = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT';
export const ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

export type Tactic = 'EARLY_AGGRO' | 'STEADY_MACRO' | 'TEAMFIGHT_PUSH' | 'SPLIT_PUSH';
export type Archetype = 'TANK' | 'ASSASSIN' | 'MAGE' | 'MARKSMAN' | 'SUPPORT';
export type Side = 'BLUE' | 'RED';

export type PlayerId = string;
export type HeroId = string;
export type ClubId = string;

export interface PlayerAttributes {
  mechanics: number;  // 操作 1-100
  awareness: number;  // 意识 1-100
  teamwork: number;   // 团队配合 1-100
  mental: number;     // 心态 1-100
}

export interface Player {
  id: PlayerId;
  name: string;
  age: number;
  primaryRole: Role;
  secondaryRole?: Role;
  attrs: PlayerAttributes;
  heroMastery: Record<HeroId, number>; // 0-100，未列出视为 20
  form: number;                        // -10..+10
  salaryPerWeek: number;
  signingFee: number;
  clubId: ClubId | null;
  // P1+ 预留，P0 不使用：
  potential?: number;
  fatigue?: number;
  morale?: number;
  traits?: string[];
}

export interface SkillEffect {
  type: 'DAMAGE' | 'STUN' | 'SHIELD' | 'HEAL' | 'DASH' | 'SLOW';
  value: number;      // 含义随 type：伤害系数、秒数、护盾量系数等
}

export interface SkillDef {
  id: string;
  name: string;
  cooldown: number;   // 秒
  range: number;      // 地图单位
  target: 'ENEMY_SINGLE' | 'ENEMY_AREA' | 'ALLY_SINGLE' | 'ALLY_AREA' | 'SELF';
  areaRadius?: number;
  effects: SkillEffect[];
}

export interface HeroDef {
  id: HeroId;
  name: string;
  archetype: Archetype;
  preferredRoles: Role[];
  base: { hp: number; attack: number; armor: number; attackRange: number; attackInterval: number; moveSpeed: number };
  perLevel: { hp: number; attack: number; armor: number };
  skill: SkillDef;
}

export interface Pick { role: Role; playerId: PlayerId; heroId: HeroId }

export interface TeamLineup {
  clubId: ClubId;
  picks: Pick[];      // 恰好 5 个，role 各不相同
  tactic: Tactic;
}

export interface MatchInput {
  seed: number;
  blue: { lineup: TeamLineup; players: Player[] };
  red:  { lineup: TeamLineup; players: Player[] };
}

export type MatchEventType =
  | 'MATCH_START' | 'KILL' | 'ASSIST' | 'DEATH' | 'GANK'
  | 'TEAMFIGHT_START' | 'TEAMFIGHT_END'
  | 'TOWER_DESTROYED' | 'OBJECTIVE_TAKEN' | 'BASE_DAMAGED' | 'BASE_DESTROYED'
  | 'SKILL_KEY' | 'SPLIT_PUSH' | 'RECALL' | 'OVERTIME' | 'MATCH_END';

export interface MatchEvent {
  t: number;                    // 比赛内秒数
  type: MatchEventType;
  side?: Side;
  actors: PlayerId[];           // 主要参与者
  targets?: PlayerId[];
  nodeId?: string;
  detail?: Record<string, number | string>;
  reason?: string;              // 机器可读原因标签，如 'tactic:EARLY_AGGRO', 'mastery_high', 'offrole'
}

export interface PlayerMatchStats {
  playerId: PlayerId; heroId: HeroId; side: Side;
  kills: number; deaths: number; assists: number;
  gold: number; damageDealt: number; rating: number; // rating 1-10
}

export interface MatchResult {
  winner: Side;
  durationSec: number;
  players: PlayerMatchStats[];
  goldDiffTimeline: { t: number; diff: number }[]; // 每 30 秒一个点，blue - red
  towers: { BLUE: number; RED: number };            // 剩余塔数
  events: MatchEvent[];
  mvp: PlayerId;
  checksum: string;
}
```

## 5. 比赛引擎设计（`src/sim`）

### 5.1 对外接口（冻结）
```ts
export function createMatch(input: MatchInput, data: GameData): MatchState;
export function step(state: MatchState): void;        // 推进 1 tick
export function isOver(state: MatchState): boolean;
export function getSnapshot(state: MatchState): RenderSnapshot; // 给画面用的只读快照
export function finalize(state: MatchState): MatchResult;
export function runMatch(input: MatchInput, data: GameData): MatchResult; // = create + 循环 step + finalize
```
**关键要求**：画面层"看比赛"和"跳过"必须调用同一套 `createMatch/step`。跳过 = 一直调 `step` 到结束。因此两者结果必然一致。

### 5.2 时间
- 1 tick = 比赛内 1 秒（如需更细，可改为 0.5 秒，记入 DECISIONS）。
- 画面层在两个 tick 之间插值，让移动平滑。
- 1 倍速：1 tick 约对应 0.1–0.13 秒现实时间（即 1 分钟比赛 ≈ 6–8 秒），放在 `match.json` 里可调。

### 5.3 地图：节点图
- 坐标系：0–1000 × 0–1000，蓝方基地在左下，红方在右上。
- 节点类型：`BASE`、`TOWER`、`LANE`、`JUNGLE`、`RIVER`、`OBJECTIVE`。
- 推荐结构（可微调，但须在 `match.json` 中数据化）：
  - 每条路：蓝基地 → 蓝二塔 → 蓝一塔 → 路中点 → 红一塔 → 红二塔 → 红基地。
  - 双方野区各 3 个节点，与上中下路的己方一塔附近相连。
  - 河道 2 个资源点：上河道"守望者"、下河道"晶核"。
- 边带长度（= 两节点欧氏距离）。单位位置用 `{ from, to, progress }` 表示，渲染时插值成坐标。
- 路径：在这张小图上用 Dijkstra 求最短路，可预先计算全对全最短路表。
- 战斗范围判定使用插值后的坐标欧氏距离。

### 5.4 单位
- **英雄**：属性 = 英雄基础 + 等级成长 + 金币加成，再乘选手系数（见 5.6）。死亡后复活时间随等级增加（P0默认：6 + 等级×2 秒）。
- **兵团**：每 30 秒每路各出一队，用一个有血量和攻击的单位表示，沿兵路走向对方。英雄在附近时自动获得补刀金币（按操作能力分配）。
- **塔**：固定在节点，攻击范围内优先打兵团，其次打敌方英雄。一塔被拆后才能打二塔，二塔被拆后该路才能攻击基地。
- **基地**：任意一路二塔被拆即可被攻击；基地血量归零比赛结束。
- **中立资源**：第 5 分钟首次刷新，之后每 4 分钟刷新。击杀方全队获得 90 秒增益（攻击 +10% 或推塔速度 +30%，数据化）。

### 5.5 金币与等级
- 金币来源：补刀、击杀、助攻、拆塔、中立资源；另有每秒少量自然增长。
- 经验来源：附近兵团死亡、击杀、时间。等级 1–12。
- 无装备：每 300 金币 = 基础攻击和生命各 +X%（数据化）。

### 5.6 选手能力如何作用（P0 必须实现）
数值全部放在 `match.json`。下表是公式方向，具体系数由 T06 平衡调整：

| 能力 | 作用点 |
|---|---|
| 操作 mechanics | 伤害系数 `0.85 + 0.003×m`；技能命中率 `0.6 + 0.004×m`；补刀金币系数 |
| 意识 awareness | 撤退阈值更合理（低意识更晚撤退）；被埋伏时察觉概率；决策加的随机扰动越小 |
| 配合 teamwork | 团战集合时的到场时间差越小；集火同一目标的概率越高 |
| 熟练度 mastery | 技能效果系数 `0.8 + 0.004×mastery`；冷却缩减 `mastery×0.002` |
| 心态 mental | 本队金币落后 >2000 时，发挥系数下降 `(100-mental)×0.002` |
| 状态 form | 全属性系数 `1 + form×0.005` |
| 位置 | 主位置 ×1.0；副位置 ×0.93；其他位置 ×0.82 |

### 5.7 AI 决策
- 每名英雄每 1–2 秒（按意识，意识高更频繁）评估一次，从下列行为中选效用值最高的：
  `FARM_LANE`（对线发育）、`FARM_JUNGLE`（打野发育）、`GANK`（抓人）、`DEFEND`（回防塔）、`PUSH`（推塔）、`GROUP`（集合）、`CONTEST_OBJECTIVE`（争资源）、`SPLIT`（分带）、`RETREAT`（撤退）、`RECALL`（回城回血）。
- 效用值 = 基础权重 × 战术修正 × 时间段修正 + 局势项（血量、附近敌我人数、资源刷新时间、金币差） + 意识相关的随机扰动。
- 战术修正示例（放在 `match.json` 的 `tactics` 表里）：
  - EARLY_AGGRO：0–12 分钟 GANK、CONTEST_OBJECTIVE ×1.6；20 分钟后整体攻击性 ×0.85。
  - STEADY_MACRO：FARM ×1.4，RETREAT 阈值更高；25 分钟后 GROUP ×1.3。
  - TEAMFIGHT_PUSH：12 分钟后 GROUP、PUSH ×1.6，SPLIT ×0.3。
  - SPLIT_PUSH：指定上单或射手在 12 分钟后 SPLIT ×2.0，其余人 DEFEND ×1.4。
- 每次做出"值得写进战报"的决策（如开团、抓人、分带），写一条事件，`reason` 标明原因（例如 `tactic:EARLY_AGGRO`）。

### 5.8 防止比赛拖延
- 30 分钟起：兵团攻击和血量每分钟 +5%，写一条 `OVERTIME` 事件。
- 40 分钟起：基地失去护甲，塔伤害减半。
- 45 分钟仍未结束（理论上不应发生）：按剩余塔数和金币判胜负，事件 `reason: 'timeout'`，测试中统计次数，应为 0。

### 5.9 战报（`report.ts`）
```ts
export interface MatchReport {
  headline: string;              // 一句话结论（中文）
  keyReasons: { text: string; eventRefs: number[] }[]; // 3 条，eventRefs 指向 events 下标
  mvp: PlayerId;
  ratings: { playerId: PlayerId; rating: number }[];
}
export function buildReport(result: MatchResult, input: MatchInput, data: GameData): MatchReport;
```
- 基于规则生成，不调用外部 AI。
- 优先挑选能关联赛前决策的原因：战术带来的早期优势、高熟练度英雄的关键技能、非主位置选手的失误、资源控制、团战胜负。

## 6. 数据文件（`src/data`）

| 文件 | 内容 | P0 数量 |
|---|---|---|
| `heroes.json` | `HeroDef[]` | 10 个（五类各 2，原创命名） |
| `players.json` | `Player[]`，自由市场 | 30 名 |
| `clubs.json` | AI 俱乐部及其选手、风格 | 5 支，每支 5–6 人 |
| `economy.json` | 起始资金、赞助、奖金、违约金倍率、警告阈值 | — |
| `match.json` | 地图节点与连线、时间、兵团、塔、资源、能力系数、战术修正 | — |

所有 JSON 在加载时用手写校验函数（或 zod，若引入需说明）检查格式，出错给出清晰报错。

## 7. 存档（`src/save`）

```ts
export interface SaveFile {
  version: number;          // 从 1 开始
  createdAt: string;        // 由 UI 层传入，逻辑层不读时钟
  game: GameState;          // game 模块定义的完整经营状态
  rngState: number[];
}
export interface StorageAdapter {          // ui 层用 localStorage 实现，测试用内存实现
  read(key: string): string | null;
  write(key: string, value: string): void;
}
export function serialize(state: GameState, meta): string;
export function deserialize(text: string): { ok: true; save: SaveFile } | { ok: false; error: string };
export function migrate(save: unknown): SaveFile;   // 旧版本升级到当前版本
```
- 写入采用"先写临时键、校验成功后再替换正式键"，并保留上一份备份，防止写到一半损坏。
- 读取失败不清空原存档，提示玩家可导入备份。
- 导入/导出：导出为 `.json` 文件下载；导入时先校验再覆盖。

## 8. 接口变更流程

T01 完成后 `src/core/types.ts` 和 5.1 节接口冻结：
1. 需要改动的 Agent 在 `docs/DECISIONS.md` 新增一条"接口变更申请"，写清改什么、为什么、影响哪些模块。
2. 单 Agent 模式：可以直接改，但必须在任务汇报里明确列出。
3. 多 Agent 模式：只有"整合负责人"可以改 `core`；其他 Agent 提申请等确认。
