# 数据包：来源、接口与支持边界

## 重现提取

在 editor 目录安装依赖后运行：

```powershell
npm run extract
npm test -- tests/unit/data.test.ts
```

`extract` 使用 Node TypeScript 工具 `tsx tools/extract-data/index.ts`，不调用 Python 或游戏引擎。默认只读访问同级的 `0.I-branch`、`mod_repo`；通过 `CDDA_SOURCE` / `CDDA_MOD_REPO` 可指定只读来源。写入仅限 `editor/public/datasets`。不读取或发布个人存档目录。

适配器强制校验实际 Git 提交 `7b2efa5cea38e4d4d97dd0e63b28b9148623da59`，发布版本只有 **0.I-1**。不将其他提交虚称为同版兼容。重复提取无时间戳，输出顺序稳定；内容变更会改变 SHA-256。

## 发布结构

- `public/datasets/manifest.json`：版本、提交、包审计结果、全部离线资源路径。
- `0.I-1/<id>.json`：独立核心/可选包，不把所有模组合成全局定义。
- `0.I-1/<id>.zh_CN.json`：实际 PO 提取的独立翻译目录。
- `0.I-1/diagnostics.json`：每个可发布包与核心组合的真实诊断，而非游戏加载成功证明。
- `0.I-1/sources.json`：原始来源文件 SHA-256；每条定义另有来源文件/数组下标与规范化内容哈希。
- `0.I-1/colors.json`：源码基础 RGB 与默认主题原始数据。
- `0.I-1/ATTRIBUTION.md`、`LICENSE.txt`、`translation-credits.txt` 以及第三方明确许可证：署名与许可。

清单的 `assets` 是相对 `/datasets/` 的路径，列出核心、所有可选包、翻译与辅助文件。Service Worker 应额外缓存清单自身，逐资源成功后才能宣称全部离线就绪。清单中的包 `file/hash`、`translationFile/translationHash` 校验**文件实际 UTF-8 字节**，定义 `hash` 校验 `JSON.stringify(data)`；两者不可混用。个人存档不属于缓存资源。

```ts
interface PackageEntry {
  id: string;
  name: string;
  file: string | null;
  hash: string | null;
  dependencies: string[];
  distributable: boolean;
  reasons: string[];
  license: string | null;
  source: string;
  definitionCount: number;
  obsolete?: boolean;
  conflicts?: string[];
  translationFile?: string;
  translationHash?: string;
}
interface DataPackage {
  formatVersion?: number;
  id: string;
  name: string;
  definitions: Array<{
    data: Record<string, unknown>;
    source: string;
    hash?: string;
  }>;
  dependencies?: string[];
  conflicts?: string[];
  obsolete?: boolean;
  gameVersion?: string;
  commit?: string;
}
```

## 收录和许可审计

核心和指定内置模组：Magiclysm、Aftershock、Mind Over Matter、Xedra Evolved、Bombastic Perks、DinoMod、No Hope、Disable NPC Needs、Portal Storms Ignore NPCs、Extra Mutated Scenarios，按真实 ID 及必要依赖收录。**Aftershock 的该源码版本自己声明 obsolete**，清单和组合诊断保留警告。

扫描第三方 `mod_repo` 全部 **28** 个目录的 modinfo、JSON 语法、声明依赖/冲突/obsolete 与许可证文件。当前仅 **blazemod** 有可确认的显式 CC BY-SA 3.0 许可证；其余 27 个包仅发布最小审计元数据/计数，不发布原定义或翻译。不能因为 JSON 可解析或依赖核心就推定第三方许可。已发布不代表引擎语义、版本或组合完全兼容。

依赖存在但未在本版发布、依赖不存在、声明过期等分别记录在 `reasons`。`No_Fungi` 不等同缺失 ID `no_fungal_growth`；不伪造 StatsThroughSkills、speedydex、stats_through_kills 等缺失包。许可不明包的 `file`、`hash` 为 null，不允许点击下载它们的原内容。

提取选择物品、物品分类/口袋/弹药类型、部件、载具原型、迁移规则、旗标、材料、需求与角色展示所需的技能、熟练度、特质/变异、身体部位、effects、义体、法术、武术、职业、场景等；不复制地图、地图生成、图块或整个引擎。0.I-1 真实物品大量采用 **`type: 'ITEM', subtypes: [...]`**，同时兼容第三方旧式 `GENERIC` / `GUN` / `ENGINE` 等类型，不能只判断旧 type。

## 共享组合解析

构建提取与浏览器共同导入 `src/domain/data/index.ts` 的解析器：

```ts
const result = compose(packages, enabledIds);
// result.parts / items / vehicles 是以 ID 为键的 Record，不是 Map。
// result.byType 保留各类型索引（可能含 abstract，仅用于继承/诊断）。
// result.diagnostics, result.enabledIds
```

原定义在包内按来源目录递归字典序及 JSON 数组顺序保留。`compose` 在核心存在时将 dda 放在最前，其余包**只按 enabledIds 顺序**应用，不把所有已安装包自动启用，也不擅自拓扑重排。缺包、缺依赖、错误依赖顺序和启用冲突会诊断。用户配置的顺序是语义的一部分。

同 ID 覆盖、同 ID `copy-from` 使用当时可见父定义；缺父定义加入有序重试队列，全部定义后反复尝试，无法消除的循环/缺父定义报 `unresolved-parent`，不制造成功结果。数组 ID 分别建立索引，abstract 可继承但不出现在具体 `parts/items/vehicles`。原包不会被组合器修改。

解析结果保留原字段以便领域适配器读取，附 `_source`、`_package`、`_abstract`、`_incomplete`、`_incompleteFields`、`_generated`。`_incompleteFields` 精确记录未实现规则影响的字段名；`'*'` 表示整个定义不确定。旧版 `_incomplete: true` 且没有字段列表也应保守视为 `'*'`。不能因为未实现 melee_damage 就丢弃显式 weight：例如真实 item.frame 的 to_hit/melee_damage 仍有诊断，但质量明确为 20,000 g。未知/未实现规则保留原包信息并产生诊断，不静默假称与游戏完全等价。

### 已支持的有限规则

- 显式类型白名单的顶层继承/替换；物品类型共享物品工厂命名空间。
- vehicle 原型按 `veh_type.cpp:1287–1395` 对 parts/items/zones 三种向量追加父内容，保留输入顺序及重复项；仅在显式 copy-from 时继承。`generic_factory.h:338–350` 每条定义从新对象开始，因此同 ID、无 copy-from 的定义仍是全量替换；同 ID 显式 copy-from 自身才在原内容上追加。name 可继承/替换；blueprint 源码只读取后忽略。其他 vehicle 字段保留为 preview，并标记对应 `_incompleteFields`，不假装实现。真实 motorcycle 继承后为 9 个坐标组、21 个部件（含 engine_vtwin 和新增 kickstand），不是只有 1 个零件。
- vehicle_part.requirements 按 `veh_type.cpp:175–216` 精确处理 install/removal/repair：未出现操作整体继承；已出现操作继承未指定 time、缺失或空 skills，但替换 using 或内联 components/qualities/tools，不深合并旧材料需求。真实 vehicle_part.frame 因此不再误标为不完整。
- 对物品/vehicle_part 独立字段白名单实现标量 relative / proportional；relative 优先级参照 `src/assign.h`。
- 显式单位表支持质量 mg/g/kg、体积 ml/L、长度 mm/cm/m、功率 W/kW、能量 J/kJ、价格 USD/cent，以及同维度复合单位。不会对任意带数字字符串进行猜测。
- 物品/部件的指定集合字段支持 extend/delete，显式去重或删除，不把所有数组都视为同一种语义。
- 炮塔按 `veh_type.cpp:473–635` 的实际 GUN/GUNMOD、禁用旗标过滤、`turret_` ID、基础物品/描述/颜色、液体/电池关联、外观、估算安装需求生成；不是只扫描静态 vehicle_part。
- APPLIANCE 位置强制 structure；按 `veh_type.cpp:669–710` 提供 z_order/list_order。
- 变体默认 ID、variants_bases 的笛卡尔展开和空变体问号回退按 `veh_type.cpp:734–759`；名称缺失时回退基础物品真实名称。

### 明确未完成的规则

**禁止通用深合并。** 除上述精确适配的 vehicle_part.requirements 外，嵌套对象（如 damage、armor_data、其他类型 requirements、复杂口袋等）的特殊继承不能冒充整个游戏加载器；当前发生嵌套覆盖时会提示其只是预览。非白名单类型/字段的 relative、proportional、extend、delete 不应用，并报 `unsupported-rule`。复杂整数取整/未明确实现的默认值、其他单位、特殊集合、物品 slot finalize、口袋默认推导、迁移/黑名单对炮塔安装可见性的影响及其他引擎 finalize 均不承诺完整。动态炮塔统一标为 `_incomplete`。

原始定义完整保留，因此后续可精确实现类型规则，无需重新发明或逆向一个通用合并后的假数据。质量/功率等下游统计必须尊重诊断和缺失值，不能把未知当作 0。

`compositionKey(packages, enabledIds)` 包含顺序、游戏版本、提交和包内容哈希；应用缓存前应把清单哈希附给已加载包，避免版本/顺序串用。

## 本次实际提取与管理界面

已实际运行提取，当前清单共发布 12 包、30,704 条有序原定义；核心 20,776 条（其中源码扫描统计为 10,102 条 ITEM，包含 abstract），不是演示数据。可选包定义数：Magiclysm 2,800、Aftershock 1,677、Mind Over Matter 1,310、Xedra Evolved 3,118、Bombastic Perks 173、DinoMod 326、No Hope 58、Disable NPC Needs 2、Portal Storms Ignore NPCs 2、Extra Mutated Scenarios 56、blazemod 406。具体部件/物品数量由组合解析后去除 abstract 得出，不等于定义条数。

`parseGameColors` 读取已提取的实际 colordef RGB。`resolveGameColor` 支持基本游戏名、c_/h_/i_ 前缀及已知前景/背景组合；白色/黄色背景遵照 ncurses 非加粗色使用 GRAY/BROWN。Grid 只使用共享解析器生成的 z_order，不自行猜测位置层级，负 z_order 不画自己的字符。缺省部件颜色取 `veh_type.h:382–383` 的 light_gray。终端 blink 动画、用户自定义配色映射、完整车辆装甲覆色/旋转朝向显示尚未复现，不宣称是游戏终端的逐像素截图。

数据管理页从真实清单显示这些包。勾选与顺序修改先进入草案，点击“应用组合”才影响当前部件库；当前诊断与未应用草案警告明确分开。核心固定第一位，上/下移动保留用户顺序；“补齐依赖并排序”是需要显式点击的动作，不在组合时偷偷改变顺序。可发布并已交付不等于已启用，更不等于离线缓存已经完成。许可不明的审计包禁止勾选。诊断按 100 条增量展示，完整报告保留在数据资产中。

数据单元测试包含组合隔离/顺序、同 ID copy-from、延迟父定义、abstract/数组 ID、白名单与深合并禁用、生成炮塔与变体、gettext 上下文/复数/fuzzy、安全回退，以及真实 manifest/包 SHA-256/核心内容验证。

## gettext 与安全文本

`src/i18n/gettext.ts` 的 PO 解析保留 `msgctxt`、`msgid_plural`、`msgstr[n]`、fuzzy 及 Plural-Forms。核心与内置包只使用真实源码全局 zh_CN.po 中出现的译文；第三方仅使用其自己的翻译资源，不借用其他模组域。按提取字符串过滤目录，但不丢上下文/复数/fuzzy。

`gettext(catalog, msgid, { context, n, plural, locale })` 和 `translationText(value, catalog, locale, n)` 均在 fuzzy/空译文/缺译文时回退原文；支持真实 zh_CN 单复数规则。不执行 PO 里的 Plural-Forms 表达式或任何脚本。WeakMap 索引避免部件库逐项扫描整份目录。

英文模式保留真正英文源文；原文就是中文的第三方内容保持中文，不伪造英文翻译。颜色标记/名称/描述始终作为文本交给 UI，不可用 innerHTML 渲染。缺失描述返回空值让 UI 显示缺失状态，不生成描述。
