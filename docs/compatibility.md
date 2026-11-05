# 存档兼容、坐标扫描与角色 TRANSFER 协议

## 证据、边界与隐私

- 本模块完全是纯 TypeScript：输入字符串/对象，输出字符串/对象；不访问磁盘、不发网络请求，不直接修改私人存档。所有示例和单测为人工合成数据，不包含私人角色、物品、世界路径或截图。
- 仅核实本地 `0.I-branch` 源码，不代表所有 CDDA 分支/模组。该源码 `savegame_version = 36`。
- 已检查本地游戏源码及相关输入目录，**未找到匹配 0.I-1 的游戏可执行文件，未进行游戏内模板导入、存档加载或模组运行验证**。构建工具的可执行文件不是游戏运行环境；结构性验证不等于游戏运行兼容。
- 此文档不是承诺“所有跨世界引用已安全消除”或“所有伤病已治愈”。未知字段保持原值并警告，可能包含尚未识别的世界引用。

### 源码定位（工作区相对路径）

| 协议点 | 本地证据 |
| --- | --- |
| 存档版本 36 | [savegame.cpp:72](../../0.I-branch/src/savegame.cpp#L72) |
| `.sav` JSON 的 `player` 与地图坐标元数据 | [savegame.cpp:95–133](../../0.I-branch/src/savegame.cpp#L95-L133) |
| `# version N` 写法 | [savegame.cpp:1120](../../0.I-branch/src/savegame.cpp#L1120) |
| TRANSFER 数值是 3 | [player_difficulty.h:15–19](../../0.I-branch/src/player_difficulty.h#L15-L19) |
| 原生模板数组 `[metadata, avatar.serialize()]` | [newcharacter.cpp:5026–5060](../../0.I-branch/src/newcharacter.cpp#L5026-L5060) |
| 模板读取、元数据默认、热量迁移 | [newcharacter.cpp:5064–5110](../../0.I-branch/src/newcharacter.cpp#L5064-L5110) |
| TRANSFER 跳过常规 `initialize()` | [newcharacter.cpp:830–872](../../0.I-branch/src/newcharacter.cpp#L830-L872) |
| avatar 序列化包含完整 Character、任务、追随者、抓取、配方等 | [savegame_json.cpp:1576–1655](../../0.I-branch/src/savegame_json.cpp#L1576-L1655) |
| 任务 -1 哨兵与抓取逻辑 | [savegame_json.cpp:1687–1707](../../0.I-branch/src/savegame_json.cpp#L1687-L1707)、[savegame_json.cpp:1734–1752](../../0.I-branch/src/savegame_json.cpp#L1734-L1752) |
| 模板无效 ID 留给新世界分配 | [savegame_json.cpp:1128–1133](../../0.I-branch/src/savegame_json.cpp#L1128-L1133)、[character_id.h:12–18](../../0.I-branch/src/character_id.h#L12-L18) |
| 旧活动/骑乘/目标引用的读取 | [savegame_json.cpp:740–745](../../0.I-branch/src/savegame_json.cpp#L740-L745)、[savegame_json.cpp:1047–1053](../../0.I-branch/src/savegame_json.cpp#L1047-L1053)、[savegame_json.cpp:1285–1309](../../0.I-branch/src/savegame_json.cpp#L1285-L1309) |
| Creature `location` 是绝对地图格坐标 | [creature.h:803](../../0.I-branch/src/creature.h#L803)、[savegame_json.cpp:3829–3835](../../0.I-branch/src/savegame_json.cpp#L3829-L3835) |
| 旧 `posx/y/z` 是 bubble 坐标 | [savegame_json.cpp:234–241](../../0.I-branch/src/savegame_json.cpp#L234-L241) |
| 12 格/子图、180 OMT/overmap | [map_scale_constants.h:16–17](../../0.I-branch/src/map_scale_constants.h#L16-L17)、[map_scale_constants.h:37–38](../../0.I-branch/src/map_scale_constants.h#L37-L38) |
| `.map` 根数组、子图绝对 `coordinates` | [mapbuffer.cpp:305–339](../../0.I-branch/src/mapbuffer.cpp#L305-L339) |
| `.map` 文件名是绝对 OMT 坐标 | [mapbuffer.cpp:50–52](../../0.I-branch/src/mapbuffer.cpp#L50-L52) |
| 子图 `vehicles` 数组与车辆局部 `posx/posy` | [savegame_json.cpp:5006–5013](../../0.I-branch/src/savegame_json.cpp#L5006-L5013)、[savegame_json.cpp:3568–3598](../../0.I-branch/src/savegame_json.cpp#L3568-L3598) |
| 当前 bodypart HP/治疗字段 | [bodypart.cpp:1203–1237](../../0.I-branch/src/bodypart.cpp#L1203-L1237) |
| `damage_over_time_map` 实为 vector（JSON 数组，不是对象） | [creature.h:1238](../../0.I-branch/src/creature.h#L1238) |
| 字符串键 map 序列化为对象 | [json.h:929–941](../../0.I-branch/src/json.h#L929-L941) |

## 对外接口

统一从 [index.ts](../src/domain/save/index.ts) 导入。

### Lossless JSON

```ts
parseLosslessJSON(text, { maxDepth?: 256, maxLength?: 134217728 }): JsonValue
stringifyLosslessJSON(value, space?: 2): string
cloneLosslessJSON(value): JsonValue
new LosslessNumber(rawNumberToken)
asSafeInteger(value): number | undefined
isJsonObject(value): value is JsonObject
```

- **禁止先用原生 `JSON.parse` 再传入**：此时超安全整数精度已经丢失。
- 常见、规范写法且安全的数字保留普通 `number`；超安全范围整数，以及 `-0`、指数、非规范小数字面量或会舍入的小数，以冻结的 `LosslessNumber { raw }` 包装。写回保留数字 token 的全部字符，绝不加引号，也不经过 `Number` 参与输出。
- 这保证数值 token 无损，**不保证文件字节级原样**：空白、缩进、转义方式与对象键顺序可能变化。
- `JSON.stringify(LosslessNumber)` 明确抛错，避免悄悄变成对象或字符串。跨 Worker/structuredClone **传 JSON 文本**，不要传这些包装实例；structuredClone 会丢失原型。
- 新增数字只能是有限数；拒绝不安全 JS 整数，需显式用 token。拒绝重复键（包括 Unicode 转义后同名键）、多余逗号、注释、非法数字、额外尾随数据、循环、稀疏数组、对象访问器和不支持的对象。
- JSON 对象解析为 null-prototype 字典，`__proto__` 仅作为普通数据键。解析上限是 UTF-16 code units，不是文件字节；文件字节限制/进度/取消由调用 Worker 处理。

### 存档头与校验

```ts
parseSave(text, options?): {
  root: JsonObject,
  header: { version: number, raw: string } | null,
  bom: boolean,
  warnings: CompatibilityWarning[]
}
stringifySave(parsed, space?): string
validateCharacterSave(root): { valid: boolean, issues: {path,message}[], warnings }
```

- 仅接受第一行的 `# version N`；兼容 `#version N` 但告警。不允许跳过正文注释或悄悄吞掉任意首行。
- BOM、原 header 换行可保留。header 和正文 `savegame_loading_version` 同时出现但不一致时拒绝读取/写出。
- 缺版本或不同于 36 时告警，不自动迁移。正常 `.template` **无存档 version 头**。
- 角色校验检查 `player`、名字、已有最大属性整数/符号范围、已知对象/数组字段类型和整树可无损写出。不冒充完整游戏 schema 校验；缺少原生核心字段发 `INCOMPLETE_AVATAR`，不替用户虚构技能/身体结构。

### 角色坐标与附近车辆（只读）

```ts
readPlayerCoordinates(root): {
  absolute: readonly [x,y,z],
  source: 'location' | 'legacy-bubble', warnings
}
scanNearbyVehicles(
  inputs: readonly { text: string, path?: string, id?: string }[],
  origin: readonly [x,y,z],
  { radius?: 60, sameZ?: true }?
): {
  vehicles: {
    inputId, submapIndex, vehicleIndex, name, type,
    absolute: [x,y,z], distance, partCount,
    snapshot: string // 无损的车辆子树 JSON，可安全跨 Worker
  }[],
  warnings, scannedSubmaps
}
parseMapFileCoordinates(path): readonly [omtX,omtY,z] | null
mayContainNearbyVehicle(path, origin, {
  radius?, sameZ?, trustFilenameZ?: false
}?): boolean
```

- 当前 `player.location` 为绝对格坐标，不叠加 `levx/om_x`。只有没有 `location` 时才读旧 `posx/y/z`，换算 `(om_x * 360 + levx) * 12 + posx`，Y 同理，Z 直接取旧 `posz`。畸形当前字段不会悄悄回退。
- 车辆锚点绝对坐标为 `[submap.x*12+vehicle.posx, submap.y*12+vehicle.posy, submap.z]`。**平面直线距离**为 `Math.hypot(dx,dy)`，半径包含边界，默认同 Z 层。不是到车身最近部件距离，也不是 Chebyshev/游戏寻路距离。
- 一次可只扫描一个文件，Worker 自行累计。输入格式错误返回结构化诊断，不把原始文件内容放进错误。单个坏车辆不会阻断其他车辆。扫描无文件写入、不移动、不重建车辆。
- `snapshot` 是文本；后续编辑请重新 `parseLosslessJSON(snapshot)`，并由车辆模块提供事务/快照/导出功能。
- 默认候选筛选恒不作 XY 排除：没有假设车辆局部坐标必在 `0..11`，故不因为远处文件名漏掉异常锚点。默认亦不信任 filename 的 Z；显式 `trustFilenameZ:true` 才可按符合源码的文件名排除异层。无法辨认文件名继续扫描。默认全量扫描应在 Worker 中限并发、可取消地执行。
- 暂不解包游戏 zip 存图容器，不做任意 JSON 递归车辆搜寻；仅扫描调用方提交的、源码 `.map` 子图结构，避免误识别其他 `vehicles` 字段。

### 原生 TRANSFER 模板

```ts
generateTransferTemplate(root, {
  cleanWorldReferences?: true,
  restoreHealth?: false,
  randomStartLocation?: true,
  startLocation?: string,
  outfitGender?: true
}?): {
  template: [metadata, avatar], text: string,
  warnings, changes: {path,action:'replace'|'remove',reason}[],
  validation,
  verification: 'source-reviewed-not-runtime-verified'
}
```

元数据严格遵循源码：`limit:3`，`random_start_location`，`outfit_gender`，非随机起点时才写 `start_location`（必须显式提供非空内容 ID）。不伪造“等级/点数”等非原生外壳。职业、场景、模组内容 ID 是否有效，仍需目标游戏完整数据加载后验证。

**原生行为与编辑器策略必须区分：**原生 `character_to_template` 原样序列化 avatar，**没有**清理旧世界引用或满血操作。本实现使用相同的原生模板外壳，但默认执行以下可审计的编辑器清理。可选 `cleanWorldReferences:false` 得到完全保留 avatar 字段的源码对应模式，并发出高风险警告。

| 默认清理 | 字段与动作 |
| --- | --- |
| 角色/任务 ID | `id=-1`、`active_mission=-1`；清空 active/completed/failed missions 与 followers |
| 抓取/乘车 | `controlling_vehicle=false`、`in_vehicle=false`、`grab_point=[0,0,0]`、`grab_type='OBJECT_NONE'`；移除 mounted_creature；仅移除完整已识别且显式非永久的 riding 实例，永久/未知 riding 保留并告警 |
| 旧地图记忆/路径 | 清空 known_traps、camps、omt_path、overmap_time；移除 location、旧 posx/y/z、destination_point |
| 活动/目标 | 清空 backlog、queued_effect_on_conditions；移除 activity、destination_activity、stashed_outbounds_activity、fetch_data、activity_vehicle_part_index、last_target/type/pos、ammo_location |
| 其他已核实可省略的世界句柄 | 移除 translocators、shadow_npc、may_activity_occupancy_after_end_items_loc，使用新建 avatar 的默认状态 |
| 已核实时间引用 | 省略 last_updated（loader 使用当前 calendar::turn）、last_sleep_check（构造默认 turn_zero）、lifespan_end（构造默认 nullopt），清空 faction_warnings（包含旧派系与 fac_warning_time）；不伪造新世界数值纪元 |

完整克隆原 avatar 后仅按明示策略操作；保留背包/穿戴/武器/技能/配方/义体/突变/专业/法术等原字段。未知和未审阅字段（包括嵌套数据）保留并告警，**不能承诺清理未知模组字段、物品所有者 ID、EOC 变量、物品位置句柄等所有世界引用**。`changes` 仅记录路径/动作/理由，不包含旧值，避免日志泄露。

#### 可选有限伤病重置

**安全限制与计划偏离：**当前默认 `restoreHealth:false`，并未默认完成计划中“默认恢复健康”的目标；只有明确 opt-in 才执行以下有限操作。保留永久/未知状态和未核实健康机制优先于冒险宣称完全治愈，不能把这些安全限制写成完全按默认达标。

`restoreHealth:true` 需要当前格式、非空的 `body` 对象，所有部位有正的 int32 `hp_max`；遇到旧顶层 hp_cur/hp_max 数组拒绝猜测性迁移，以免旧数组在加载时覆盖修复结果。

- 每部位 `hp_cur = hp_max`，零化 damage_bandaged、damage_disinfected、healed_total、frostbite_timer，保留未知部位字段。
- **绝不整体清空 effects**。仅删除两级 map 中完整、完全已识别的 effect 实例：恰为 eff_type/duration/bp/permanent/intensity/start_turn/source 七字段；显式 `permanent===false`；eff_type/bp 与外层键一致；duration/intensity/start_turn 为 int32；source 仅含已核实字段且类型正确。永久实例、缺 permanent、未知实例字段/来源字段、旧/异常容器形状全部原样保留并告警，避免抹掉永久突变/义体状态。
- 识别依据：[effect.cpp:1687–1711](../../0.I-branch/src/effect.cpp#L1687-L1711)、[savegame_json.cpp:529–548](../../0.I-branch/src/savegame_json.cpp#L529-L548)、[savegame_json.cpp:3839–3910](../../0.I-branch/src/savegame_json.cpp#L3839-L3910)。删除显式临时效果仍可能清除有益临时增益，会单独发 `TEMPORARY_EFFECTS_REMOVED` 警告。
- 清空 damage_over_time_map（数组），pain/radiation/hunger/thirst/sleepiness/sleep_deprivation/pkill/stim 置零。
- 不会臆测维生素、卡路里、体温、成瘾、血容量、义体、突变或模组特殊机制的健康标准；不调用游戏的 recalc_hp，不宣称全面复原。义体/突变原字段与保留的 effect 原实例均不改变。保留源码模板加载时 `stored_calories` 的原生迁移行为。
- 时间重置依据：[savegame_json.cpp:3966–3975](../../0.I-branch/src/savegame_json.cpp#L3966-L3975)、[character.h:4013](../../0.I-branch/src/character.h#L4013)、[creature.h:1226](../../0.I-branch/src/creature.h#L1226)、[savegame_json.cpp:1274–1282](../../0.I-branch/src/savegame_json.cpp#L1274-L1282)。仅重置明示已审计字段。保留效果的 start_turn/source、物品/CBM/法术/模组的未知嵌套时间引用不擅自改写，发 `NESTED_TIME_REFERENCES_PRESERVED` 等警告；跨世界状态并未全部归零。

## 验证与未完成项

- [save.test.ts](../tests/unit/save.test.ts)：合成 Vitest 测试覆盖整数无损、数字注入/原型键、严格解析、版本头、负坐标、圆形半径边界/对角排除、同层筛选、错误隔离、文本快照、未知字段保留、原生外壳、世界引用清理与可选有限健康操作。
- TypeScript 严格检查及生产构建通过；当前 `save.test.ts` **47 项通过**（含显式启用的真实只读回归）。测试覆盖永久 / 未知 effects 保留、时钟默认值与健康拒猜策略。完整发布验收记录见 [验收清单](acceptance.md)。
- 私档回归为显式 opt-in：本地设置 `CDDA_PRIVATE_SAVE_DIR` 指向私人世界目录，`CDDA_PRIVATE_EXPECTED_VEHICLES` 可设置期望的 60 格同层车辆数量（默认 2），再运行 `tests/unit/save.test.ts`。默认跳过；不提交私人样本。脚本读取全部相关 sav/map/mods.json，前后逐文件 SHA-256 对比，两个并发读取器全扫 `.map`，并验证模板生成不改变源 JSON；失败报告只显示数字/布尔量，不展开角色/车辆对象。
- **验证日期：2026-11-06（Asia/Shanghai）**。实际私档只读回归已通过（仅输出统计，不记录私人名称/路径/快照）：**4957 个文件前后 SHA-256 全部一致；4955 个 `.map`、19820 个子图；60 格平面半径同层找到 2 辆车；畸形条目 0；源 JSON 树不变；默认及有限健康重置模板均成功生成原生 limit=3 外壳**。私档 header 版本为 33，和核实源码版本 36 不同，故结果仅证明读入/扫描/无修改/外壳生成，不证明游戏内兼容。
- 未找到游戏 exe；模板在游戏内是否成功、模组内容 ID/动态迁移、所有字段默认值组合的运行行为尚未验证。交付到游戏目录前应保留原存档备份，在一次性世界中人工导入/检查，绝不覆盖私人原档做试验。
