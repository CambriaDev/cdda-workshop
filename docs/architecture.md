# 项目结构与数据流

本文面向开发者，概述 CDDA Workshop 的代码边界。项目是独立的静态 React + TypeScript 应用，不是 CDDA 引擎的一部分。细节见[开发指南](development.md)、[打包与部署](packaging.md)、[功能与 CDDA 源码映射](source-map.md)。

## 目录结构

```text
editor/
├─ public/
│  ├─ datasets/                 # 固定版本的数据包、翻译、清单、诊断、许可与来源
│  ├─ THIRD-PARTY-NOTICES.txt   # 构建时生成的浏览器依赖许可
│  ├─ manifest.webmanifest      # PWA 元数据
│  ├─ icon.svg / icon-192.png / icon-512.png
│  └─ index.html                # Vite HTML 入口
├─ index.html                  # Vite 页面入口
├─ vite.config.ts              # React/Vite、构建后离线资源清单
├─ playwright.config.ts        # 生产预览 E2E 配置
├─ package.json / package-lock.json
├─ Dockerfile / compose.yaml
├─ src/
│  ├─ app/                      # 应用入口、全局状态/上下文、顶层 UI 与样式
│  ├─ features/
│  │  ├─ vehicle-editor/        # 载具工作台、网格、部件检查与系统报告
│  │  ├─ character-export/      # 存档工作台、附近车辆查询与角色模板导出
│  │  └─ datasets/              # 数据包选择、依赖顺序和诊断 UI
│  ├─ domain/
│  │  ├─ data/                  # 数据类型、包组合、静态定义解析和颜色
│  │  ├─ vehicle/               # 载具编辑、校验、统计、项目和蓝图领域逻辑
│  │  └─ save/                  # 无损 JSON、存档协议、地图扫描与 TRANSFER 生成
│  ├─ workers/                  # 数据包解析 Worker 与存档/地图扫描 Worker
│  ├─ storage/                 # IndexedDB 本地键值数据、离线 Worker 注册/通信
│  ├─ i18n/                    # gettext/PO 翻译读取
│  └─ main.tsx                 # React 浏览器入口
├─ tools/
│  ├─ extract-data/             # 从只读游戏/模组源码提取可分发数据
│  ├─ offline-worker.js         # 离线 Service Worker 模板
│  ├─ package-release.mjs       # 静态发布 ZIP 与 SHA-256
│  └─ third-party-notices.mjs   # 构建浏览器依赖许可清单
├─ docker/                     # Docker 部署用 Nginx 配置
├─ tests/
│  ├─ unit/                     # 领域、存储、Worker、UI 等单元回归
│  ├─ e2e/                      # 生产构建的浏览器端到端测试
│  └─ fixtures/                 # 明确注明用途的人工/匿名测试夹具
└─ docs/                        # 架构、开发、打包、兼容、数据、验收与源码映射文档
```

文件树是职责概览而不是所有文件清单；具体公开 API 和复杂规则以代码、测试和对应专项文档为准。

## 主要数据流

### 游戏数据到浏览器定义

```text
本地只读 CDDA 0.I-1 / 获准分发的模组
  └─ npm run extract
       └─ public/datasets/（JSON 定义、翻译、manifest、诊断、来源/许可）
            └─ App 加载 manifest + Data Worker 校验文件哈希
                 └─ domain/data/compose.ts 按用户启用与排序组合
                      └─ 数据页 / 载具工坊读取本次组合
```

提取器默认从项目同级 `0.I-branch` 和 `mod_repo` 只读读取，并只写入 `public/datasets/`；需匹配已核实提交。`public/datasets/` 是游戏 JSON/PO 等提取后的静态资源，不是应用 UI 翻译的同一机制：应用 UI 使用 `src/app/context.tsx` 中显式双语字符串，游戏定义名称可从分包 PO 翻译读取。数据组合器实现的是编辑器需要的**有限静态预览**，不是通用 JSON loader，也不完整实现游戏所有继承、finalize、模组交互和校验语义。诊断或 `_incomplete` 标记表示不确定性，不应当解释成游戏加载成功。第三方内容是否打包还受许可审计约束。

### 载具编辑与导出

```text
数据组合 + 用户创建/导入的载具快照
  └─ features/vehicle-editor/（工作台、画布、部件检查）
       └─ domain/vehicle/（不可变编辑、局部规则校验、统计和迁移预览）
            ├─ IndexedDB：载具编辑器项目自动保存到本浏览器
            ├─ 项目 JSON：显式导入/导出格式，保留原快照/未知字段
            └─ 蓝图 ZIP：原生原型/模组文件 + 明确的损失报告
```

项目 JSON 不等于游戏存档，不能注入游戏；蓝图 ZIP 是有损的原型导出，不包含完整车辆实例状态。安装规则、额定值和蓝图结构都只覆盖已实现的静态子集，不能代替游戏内验证。撤销历史仅在当前会话内保存。

### 存档读取、附近车辆与角色模板

```text
用户选择世界目录（只读句柄）或单个 .sav 文件
  └─ save.worker.ts：有界递归枚举、受限并发读取、来源变化检查与进度报告
       ├─ domain/save：存档头/JSON 解析、角色字段校验
       ├─ domain/save：目录模式下枚举到的 .map 文件中的附近车辆快照提取
       └─ domain/save：按原生 TRANSFER 外壳生成 .template 文本
            └─ 浏览器下载（不写回 .sav / 世界目录）
```

普通单文件导入只接收 `.sav`；附近地图扫描要求只读目录选择。当前 Worker 对目录递归深度最多 32、目录项最多 250,000，并限制并发/文件大小。目录句柄只用于读取，没有写入、删除或创建方法；每个文件限制 128 MiB，扫描并发为两个 reader。来源稳定性通过文件大小和最后修改时间指纹检查，并非内容哈希或操作系统原子快照。地图扫描处理枚举到的未压缩 `.map` JSON，而不是游戏加载地图或索引整个世界的实现；受限于文件格式版本、扫描目录、地图文件实际存在情况及坐标锚点规则。角色模板依照本地源码审阅的原生结构生成，但部分字段清理/有限健康处理属于编辑器策略，不表示已经在游戏中导入运行。

### 离线缓存与本地持久化

- IndexedDB 保存 UI 语言、启用的公开数据包 ID 和载具编辑器项目（以 800 ms 延迟写入并在启动时尝试恢复）；浏览器配额、清理或访问失败可能导致草稿不可用，应另行导出备份。IndexedDB 数据不是游戏存档、备份服务或跨设备同步。
- 生产版 Service Worker 由构建步骤写出包含资源路径和 SHA-256 的发布清单；用户主动选择“准备离线使用”后才校验并缓存应用及公开数据资源。首次访问页面不意味着已完整离线就绪。
- 离线缓存只缓存构建清单列出的应用及发布数据资源，不包含用户的私人存档、个人目录句柄中的文件或导出的私密数据。浏览器清站点数据可能删除草稿/缓存。
- 开发模式不注册生产 Service Worker；离线行为需针对生产构建验证。

## 领域边界

纯领域代码尽可能不访问文件系统、不写游戏存档。浏览器 IO 留在 UI、Worker、存储和下载层。CDDA 源码映射及每类功能的已知局限见[功能与 CDDA 源码映射](source-map.md)；版本、许可、解析边界见[数据报告](datasets.md)和[兼容报告](compatibility.md)。