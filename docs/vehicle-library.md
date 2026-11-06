# 载具部件库重建

## 新目录取代旧的工作台内联列表

[目录构建器](../src/domain/vehicle/library.ts)在每次数据组合完成后，从 `composition.parts` **重新生成**可新增安装的部件目录。旧的工作台内联筛选、分类和搜索列表已移除；[独立部件库界面](../src/features/vehicle-editor/VehiclePartLibrary.tsx)只消费新目录。目录不是背包物品列表，也不是家电部署菜单。

数据流：

```text
完整公开数据包 → compose（模组顺序、继承、生成炮塔、finalize）
                    ├─ 完整 parts/items 索引 → 导入、检查、校验、导出
                    └─ buildVehicleLibrary → 载具部件库 → 新增安装入口
```

### 准入规则

| 定义 / 有效标志 | 是否进入部件库 | 说明 |
| --- | --- | --- |
| 具体 `vehicle_part` | 是 | 使用解析继承及模组覆盖后的定义 |
| `ITEM` / `GENERIC` / `TOOL` 等物品 | 否 | 同名也不属于载具部件命名空间 |
| 抽象定义 | 否 | 不可作为具体部件安装 |
| `APPLIANCE` | 否 | 独立家电，不属于普通载具安装菜单 |
| `NO_INSTALL_HIDDEN` | 否 | 游戏普通安装菜单隐藏 |
| `NO_INSTALL_PLAYER` | 是，提示限制 | 编辑器用于预设设计；游戏禁止玩家手动安装 |
| 裸 `NO_INSTALL` | 不据此排除 | 该 0.I 源码没有对应的安装限制实现 |

目录按部件 ID 保持独立：一个物品关联多个部件时不能合并，不按 `ap_` 前缀、名称或物品的 `use_action` 猜测或改写 ID。界面按当前语言排序并显示名称和部件 ID；关联物品在详情中单独说明。来源和分类也从新目录生成。默认只渲染前160项，结果总数为完整匹配数，搜索可定位未在首屏渲染的部件。

`chest_minifreezer` 的车载部件关联同名物品，安装在 `center`，可以与 `structure` 的车架同格。`ap_chest_minifreezer` 关联同一物品，但其 `APPLIANCE` 使最终位置变为 `structure`；它不进入新增目录，不能通过放宽位置冲突把它强行装到车架上。[详细源码依据](../src/domain/vehicle/README.md#vehicle-construction-library-and-item-identity)列出了物品部署与载具安装两条不同路径。

## 可重复生成与审计

```powershell
npm run rebuild:library
npm run check:library
```

[重建工具](../tools/rebuild-vehicle-library.ts)只读取已交付、获准分发的数据包，先验证 manifest 中的 SHA-256，再用和运行时相同的 `compose` 与目录构建器重建。它不读取私人世界、不修改参考游戏源码、不需要重新提取或裁剪原始数据包。

产出：[部件库审计清单](generated/vehicle-library.json)。固定 0.I-1 数据本次结果为 **701 个解析后的核心部件 → 574 个目录部件 + 127 个排除项**，包含数据解析器生成的具体炮塔。清单记录核心部件 ID、关联物品、位置、来源、玩家安装限制、排除原因及12个已交付包各自带依赖的组合相对核心的新增/移除情况。组合摘要保留解析诊断数量，不把有限静态解析冒充游戏加载验收。

该清单**仅用于审计**，不是运行时静态 ID 白名单，也不代表所有模组任意组合。用户启停或调整模组时，界面始终根据当前组合重建。修改规则或公开数据后运行重建命令；`--check` 在清单过期时失败，且不改写清单。

## 导入与缓存边界

完整的部件和物品索引不能裁剪：已有家电、特殊部件及未知字段仍需读取、检查和无损保留。新目录仅限制“新增安装”，不改写导入 ID、不改变项目/存档格式、不清空草稿，不把菜单隐藏标志变成已有载具的结构错误。

目录不写入 IndexedDB 的 composition 缓存；旧缓存的完整解析结果也会经过新构建器，因此无需删除整站存储。新代码需正常构建和部署；已准备离线使用的旧版本需更新离线资源后重新打开，而不是靠清除草稿解决。推送 GitHub 代码不等于已部署网页。

回归覆盖见[部件库测试](../tests/unit/vehicle-library.test.ts)、[真实数据与冷柜同格测试](../tests/unit/vehicle.test.ts)、[浏览器检查面板测试](../tests/e2e/inspector.spec.ts)。实际测试结果见[验收记录](acceptance.md)。
