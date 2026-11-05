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
('dataset-pipeline','实现版本化数据流水线','completed','["compatibility-contracts","app-shell"]','12真实交付包、28外部目录审计、逐类型继承与诊断；data测试12通过（含真实摩托车21部件回归）。未适配语义显式标记。','2026-11-06'),
('vehicle-domain','实现载具领域与输出格式','completed','["dataset-pipeline"]','模型/支撑规则/保守统计/ZIP/无损项目；不可识别容量保留原值并警告。','2026-11-06'),
('vehicle-ui','实现载具编辑界面','completed','["vehicle-domain"]','部件检索/筛选/字符网格/图层/检查/撤销重做/草稿；生产版导入编辑导出回读E2E通过。','2026-11-06'),
('save-migration','实现存档读取与附近载具迁移','completed','["vehicle-domain"]','只读目录Worker；2并发受控全扫；4955地图/19820子图/2车；4957输入哈希不变。','2026-11-06'),
('character-export','实现角色转移预设','in_progress','["dataset-pipeline","compatibility-contracts","app-shell"]','原生TRANSFER/成长装备保留/清理审计已实现；save测试47通过，永久和未知效果保护已复验。有限健康默认关闭是安全偏离，完整健康与游戏内验证仍未完成。','2026-11-06'),
('offline-delivery','完成离线缓存与发布','completed','["dataset-pipeline","app-shell"]','全资源hash校验、版本隔离、失败保留旧缓存；offline测试7通过；生产断网关闭重开、切换模组、项目和模板导出E2E通过。','2026-11-06'),
('acceptance','执行完整验收并编写使用文档','in_progress','["vehicle-ui","save-migration","character-export","offline-delivery"]','类型检查/构建通过；98单测（含真实只读回归）通过；3生产E2E通过；依赖审计0漏洞。文档及SQL已同步。未发现匹配游戏程序，真实游戏导入验收仍未完成，见acceptance.md。','2026-11-06');
COMMIT;
