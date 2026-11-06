# 开发指南

本指南针对 `editor/` 项目的贡献者。应用是 React + TypeScript 静态站点；普通开发不需要运行 CDDA，也不需要游戏源码。架构说明见[项目结构与数据流](architecture.md)，源码依据见[功能与 CDDA 源码映射](source-map.md)。

## 环境要求

- Node.js 22 系列（README 当前要求 22.16+）与 npm 10+。
- 本仓库提交了 `package-lock.json`；标准安装为 `npm ci --legacy-peer-deps`。
- 单元测试使用 Vitest。浏览器 E2E 使用 Playwright 配置的已安装 Chrome 通道，需本机可用 Chrome。没有 Chrome 时，应按团队环境调整 Playwright 配置/浏览器安装后再运行，不能将未运行的浏览器测试描述为通过。
- 重提取数据时另需同级的指定 CDDA 源码及模组目录；普通运行/构建使用已经交付的 `public/datasets`，不需要源码 checkout。

## 本地启动

在 `editor/` 目录执行：

```powershell
npm ci --legacy-peer-deps
npm run dev -- --host 127.0.0.1
```

用终端输出的 localhost 地址打开浏览器。不要用 `file://` 直接打开 `index.html`。目录选择和 Service Worker/PWA 能力受浏览器安全上下文约束，通常需要 localhost 或 HTTPS；开发模式本身不注册生产离线 Worker。

## 日常检查与测试

```powershell
npm run check
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
npm run test:e2e
```

- `npm run check`：运行 TypeScript project build/check（`tsc -b`）。
- `npm test`：运行 Vitest 单元与集成测试；默认不读取私人存档。私档回归必须遵循[兼容报告](compatibility.md)中的显式 opt-in 和隐私注意事项，不要把个人存档加入公开 fixture。
- `npm run build`：先生成 `public/THIRD-PARTY-NOTICES.txt`，再执行 TypeScript 检查和 Vite 生产构建到 `dist/`。所以它不只是纯类型检查，也会写入 notices 文件及生产产物。
- `npm run preview`：本地服务 `dist/` 生产构建，用于检查生产行为；构建后再预览。
- `npm run test:e2e`：Playwright 配置会启动/复用 `http://127.0.0.1:4173` 上的 Vite preview（`CI` 环境不复用已存在服务），使用 Chrome、单 worker 顺序执行 `tests/e2e/`。它测试生产构建而不是 Vite 开发服务。先运行 `npm run build`；若预览端口已被不相关进程占用，先妥善处理冲突。

检查结果应同时报告命令、环境、通过/跳过情况。单元和浏览器测试不能替代实际游戏导入验收；现有实测基线和待验证事项以[验收清单](acceptance.md)为准。文档更新不要求触发构建或发布命令：`npm run build` 会改写 `public/THIRD-PARTY-NOTICES.txt` 并生成 `dist/`，应确认这是预期后再运行。

## 重建载具部件库

修改部件库规则或已交付数据后运行：

```powershell
npm run rebuild:library
npm run check:library
```

该命令验证公开数据包哈希，复用运行时组合器与目录规则，重新生成[部件库审计清单](generated/vehicle-library.json)，覆盖核心和12个已交付包各自带依赖的组合。`--check` 只检查完整清单是否过期，不写文件。运行时目录仍按用户当前模组组合动态重建，不读取静态清单。无需删除完整物品/家电定义、清空本地草稿或重新提取游戏数据。规则和边界见[部件库重建](vehicle-library.md)。

## 何时重新提取游戏数据

只在更新或重现游戏/模组数据时运行：

```powershell
npm run extract
npm test -- tests/unit/data.test.ts
npm run build
```

提取器默认读项目父目录下的 `0.I-branch/` 和 `mod_repo/`，并强制校验已核实的 0.I-1 Git commit；也可由 `CDDA_SOURCE`、`CDDA_MOD_REPO` 指定只读来源。提取输出写入 `public/datasets/`。不要在不审查差异、版本、模组依赖和分发许可的情况下更新公开数据。提取结果不是游戏引擎加载验收；细节见[数据报告](datasets.md)。

## 常见问题

- **端口 4173 已占用**：E2E 使用 `--strictPort`，不会静默切换到其他端口。确认冲突进程后再释放端口或调整配置。
- **Playwright 找不到 Chrome**：按项目配置安装/指定受支持的浏览器，或在受控开发环境改 `playwright.config.ts`；不能将浏览器测试标记为已通过而跳过。
- **开发版没有离线缓存**：这是预期行为；离线 Service Worker 只在 production build 注册。请用 `npm run build` 后的预览测试。
- **数据包/翻译校验失败**：检查 `public/datasets/manifest.json` 的路径和哈希、数据提取输入提交及文件是否完整，不要手工伪造 manifest 哈希。
- **模板/蓝图可以构建但游戏里行为未知**：项目没有据此保证实际游戏加载。按[验收清单](acceptance.md)在相同版本、模组组合、已备份的测试世界中验证。

## 修改边界

- 纯领域模块尽量保持确定性、不可变和可单元测试；浏览器文件权限、Worker 生命周期与 IndexedDB 留在对应边界。
- 未知或不完整数据应明确标注，不把未知容量/状态默认为零或完整。
- 更新源码引用时同步核对[源码映射文档](source-map.md)的版本、路径和行号。
- 不将私人存档、用户文件、未授权模组原始数据或生成的私密导出加入仓库。