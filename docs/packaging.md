# 打包与部署

本项目交付的是静态 Web 应用，没有应用后端、存档上传服务或存档写回服务。当前提供本地生产构建、静态 ZIP 发布、Docker Compose（Nginx 静态站）和普通静态托管四种使用方式。

## 生产构建

```powershell
npm ci --legacy-peer-deps
npm run build
```

`npm run build` 会先从已安装依赖的许可证文件生成 `public/THIRD-PARTY-NOTICES.txt`，然后执行 `tsc -b` 和 `vite build`，构建结果在 `dist/`。Vite 在 `dist/sw.js` 中生成本次发布的资源列表、SHA-256 与发布标识。完整构建和代码检查见[开发指南](development.md)。

## 静态发布 ZIP

```powershell
npm run release
```

该命令先运行完整 `npm run build`，随后 `tools/package-release.mjs` 将 `dist/` 内容、自动生成的 `DEPLOYMENT.txt`，以及脚本明确列出的 README、验收/兼容/数据说明和 `docs/todo.sql` 打入 `release/cdda-workshop-<package.json 版本>-static.zip`，并写出同名 `.sha256` 文件。脚本拒绝符号链接，并检查发布目录至少含 `index.html`、`sw.js`、`THIRD-PARTY-NOTICES.txt`。目前脚本没有把本次新增的 architecture、development、packaging、source-map 文档列入归档，开发源码链接也不会在静态 ZIP 中解析。

归档包括静态应用、随站点交付的数据和许可/部署材料；不包括源代码、`node_modules`、私人存档。部署说明建议完整解压至一个静态站点目录，以 HTTPS 或 localhost 提供服务；不能直接从文件系统双击 HTML。打包过程不会执行 Docker 构建、浏览器 E2E、游戏数据重提取或游戏内导入验收。

检查 ZIP 与哈希后，将**完整目录**部署到静态服务器。应把 `index.html` 和 `sw.js` 设为 `Cache-Control: no-cache`，哈希命名的 `assets/` 可使用长缓存。支持子路径部署；保持生成的相对资源路径和目录层级。

## Docker Compose

已安装 Docker Compose 的环境可运行：

```sh
docker compose up --build -d
```

浏览 `http://localhost:8080`；停止服务：

```sh
docker compose down
```

`Dockerfile` 使用 `node:22-alpine` 构建阶段安装依赖并执行 `npm run build`，之后将 `dist/` 复制到 `nginx:alpine` 镜像。Compose 将容器 80 端口绑定到宿主机 `127.0.0.1:8080`，仅本机访问。Nginx 对 `index.html`、`sw.js` 和一般路由采用不缓存策略，对哈希 `assets/` 设置一年 immutable 缓存；没有业务后端。

## 数据与许可更新

只有明确要更新静态定义/翻译时才运行：

```powershell
npm run extract
npm test -- tests/unit/data.test.ts
npm run build
```

提取器只写 `public/datasets/`，需要匹配锁定的 CDDA 0.I-1 源码版本，并按许可过滤第三方内容。审查数据差异、来源、依赖、诊断和许可证文件；构建会生成浏览器依赖 notices，游戏数据自身署名/许可证在 datasets 下另行交付。不得将未经许可的第三方数据放入发布包。具体提取结构与规则见[数据报告](datasets.md)。

## 发布检查清单

1. 核对 `package.json` 版本与本次变更范围；不要仅为改文档而改版本。
2. 运行 `npm run check`、`npm test`、`npm run build`；有界面/离线改动时按[验收清单](acceptance.md)运行生产浏览器回归。
3. 若改了游戏数据，确认源 commit、提取差异、manifest 哈希、包依赖与分发许可，再重新构建。
4. 需要静态归档时执行 `npm run release`，核对 ZIP 内容和 SHA-256；需要 Docker 时单独 build/run 验证。两种路径互不替代。
5. 将完整新发布目录原子切换到目标位置，保留已知可回滚的旧目录。不要先替换一部分数据、再更新 HTML 或 Service Worker；失败时恢复整份旧发布。
6. 部署后在 HTTPS/localhost 打开，按需手动准备离线资源，并等待明确的“已校验并就绪”状态；页面首次加载并不等于已可离线使用。
7. 游戏蓝图/TRANSFER 如要对游戏兼容作结论，必须在匹配版本和模组、已备份的临时世界中实际验收。浏览器测试、静态 schema 检查与 ZIP 成功均不构成游戏验收。

## 不在本项目打包范围内

当前脚本不生成桌面安装器、移动应用包、游戏内可直接注入的存档、不执行自动线上发布，也不上传用户数据。发布物是静态 Web 文件及相应说明/许可材料。