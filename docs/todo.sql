-- Implementation status; executable with SQLite. Updated 2026-11-06 Asia/Shanghai.
CREATE TABLE IF NOT EXISTS todo (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','in_progress','completed')),
  dependencies TEXT NOT NULL DEFAULT '[]',
  evidence TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
BEGIN;
INSERT OR REPLACE INTO todo VALUES
('compatibility-contracts','核实兼容协议与数据来源','completed','[]','固定0.I-1源码commit；v33样本/v36来源边界；许可与字段策略见compatibility.md/datasets.md。','2026-11-06'),
('app-shell','创建前端应用骨架','completed','[]','React/TypeScript/Vite；双语、错误边界、Worker；生产构建通过。','2026-11-06'),
('dataset-pipeline','实现版本化数据流水线','completed','["compatibility-contracts","app-shell"]','12真实交付包、28外部目录审计、逐类型继承与诊断；data测试17通过（含真实摩托车21部件、工具能力上下文翻译与槽位继承回归）。未适配语义显式标记。','2026-11-06'),
('vehicle-domain','实现载具领域与输出格式','completed','["dataset-pipeline"]','模型/支撑规则/保守统计/ZIP/无损项目；不可识别容量保留原值并警告。','2026-11-06'),
('vehicle-ui','实现载具编辑界面','completed','["vehicle-domain"]','部件检索/筛选/字符网格/图层/检查/撤销重做/草稿；生产版导入编辑导出回读E2E通过。','2026-11-06'),
('save-migration','实现存档读取与附近载具迁移','completed','["vehicle-domain"]','只读目录Worker；2并发受控全扫；4955地图/19820子图/2车；4957输入哈希不变。','2026-11-06'),
('character-export','实现角色转移预设','in_progress','["dataset-pipeline","compatibility-contracts","app-shell"]','原生TRANSFER/成长装备保留/清理审计已实现；save测试46通过、1私档opt-in按设计跳过，永久和未知效果保护已复验。有限健康默认关闭是安全偏离，完整健康与游戏内验证仍未完成。','2026-11-06'),
('offline-delivery','完成离线缓存与发布','completed','["dataset-pipeline","app-shell"]','全资源hash校验、版本隔离、失败保留旧缓存；offline测试7通过；生产断网关闭重开、切换模组、项目和模板导出E2E通过。','2026-11-06'),
('acceptance','执行完整验收并编写使用文档','in_progress','["vehicle-ui","save-migration","character-export","offline-delivery"]','0.3.0类型检查/构建通过；206单测通过、1私档opt-in跳过；8生产E2E通过（含用途排序/A-B/多屏/离线）；依赖审计0漏洞。首版私档哈希验证为历史证据，本次未重扫。文档及SQL已同步。未发现匹配游戏程序/无Docker CLI，真实游戏与容器运行验收未完成，见acceptance.md。','2026-11-06'),
('part-details','展示双语部件额定详情与独立实例状态','completed','["dataset-pipeline","vehicle-ui"]','0.2.0：简介/重量/功率与机械负载/容量/工具等级与500kg每级起重/轮组防护舒适/高级来源；额定与实例分离、缺失不补零。49领域+2UI+2功率单测；含真实blazemod裸整数kW回归、双语/离线/390px浏览器验证。非物理模拟，未知字段保留。','2026-11-06'),
('part-layout-comparison','按用途优先展示详情并提供独立双列对照','completed','["part-details","vehicle-ui"]','0.3.0：16用途（含兜底）优先级/复合用途去重/未知兜底；电器耗电-功能-容量优先，物理参数折叠；可靠简介与底层兜底。独立部件库A/实例或固定B，数据变更按ID重解，缺失与恢复提示；比较不进入项目或撤销。43布局+10UI单测；8生产E2E含1920/1440/1280/1024/390、独立滚动与键盘切换。详见part-layout.md与acceptance.md。','2026-11-06');
COMMIT;
