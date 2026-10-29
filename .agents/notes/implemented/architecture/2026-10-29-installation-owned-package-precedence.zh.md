# Agent Note: 让本体自有的包名优先于 profile 副本

Status: implemented

[English](2026-10-29-installation-owned-package-precedence.md) | 中文

## Problem

Desktop 安装在 `resources/app.asar.unpacked/dsh/node_modules` 下携带 Harness 包与 Cordis 运行时。早期 release 写出的 profile 仍可能在自身 `node_modules` 中留有同名物理副本：在[清理移除](../simplification/2026-09-19-remove-desktop-profile-core-cleanup.zh.md)之前，release 会把 dsh 的 peer 装在那里，而升级会替换安装、把 profile 留在磁盘上。Node 的祖先查找先到达更近的 profile 副本，于是同一个进程运行了同一包的两个版本。

[查找顺序 Note](2026-09-19-profile-resolution-lookup-order.zh.md)让 installation 条目占据 `$DSH_HOME/profiles/node_modules` 上的包名位置，但 ① 或 ② 层的 profile 副本仍然胜出，而且对 profile 直接声明的包，`routeLocalPackage` 完全跳过拦截。一次从 0.2.1-rc.3 到 0.2.2-alpha.2 的 Desktop 升级把 `@deepseek-ai/dsh-session-projection@0.2.1-rc.3` 留在 profile 中；兼容性预检用它对比 0.2.2 的 Host，禁用该插件，39 个插件一直挂起，直到启动失败并报出 `dsh: startup failed: 1 required plugin did not activate`。启动从不运行 pnpm，也不改动已安装的用户包，下游没有任何环节能修复这种混用。

## Decision

### 本体自有包名集合

[resolver.ts](../../../../packages/boot/app-boot/src/profile-resolution/resolver.ts) 中的 `installationOwnedName()` 列出这样的包：其模块实例携带 Host 与每个 Loader 插件都必须共享的服务注册或共享状态。集合包括 `@deepseek-ai/dsh-*`、`@deepseek-ai/cordis`、`@deepseek-ai/cordis-*`、`@deepseek-ai/cosmokit` 与 `@deepseek-ai/schemastery`。规则按包名匹配而不是按版本：只要安装为该包名提供了条目，profile 中的同名副本永不被选中，无论该副本更旧、相同还是更新。

安装不提供的包名保留 profile 副本。安装闭包不包含 profile 自行安装的可选 Harness 插件，例如 `@deepseek-ai/dsh-subagent-claude-code` 与 `@deepseek-ai/dsh-subagent-codex`，因此它们继续在 ② 层从 profile 解析。

### 优先级生效的位置

对本体自有包名，router 在遍历物理搜索路径之前，就用 installation 范围的条目在拦截路由上作答。`routeScoped` 在自引用检查与 linked 层分支之后立即返回该路由，因此 ESM import、CommonJS require、`require.resolve` 与 `packageDir` 元数据都指向安装副本。已记忆化请求缓存按物理路由相同的方式记录该答案。

`routeLocalPackage` 不再对本体自有包名短路。这条捷径本来只为 profile 直接依赖省去一次目录探测，但它绕过拦截层，因此本体自有包名改为落入 scoped 查找。

有两种行为刻意保持不变。linked root 仍走 `routeLinked`，开发者仓库自己的包继续遵循 [linked-root 规则](2026-09-09-profile-resolution-generations.zh.md)。显式 CommonJS `paths` 仍绕过拦截，因为指定搜索路径的调用方要的就是 Node 自己的答案。`compileResolution` 的发布检查在 installation 条目与既有映射同名时仍覆盖后者；`dependencyClosure` 会保留 installation 包名，所以 profile 范围的条目永远无法复用同名，该覆盖不可达。

## Alternatives considered

**启动时删除陈旧的 profile 副本。** 启动将不得不判断哪些目录已经过时，并从用户拥有的 profile 中删除它们；删错会破坏用户有意选择的安装。解析可以忽略副本而不碰磁盘，因此不修改任何用户包。

**让 installation 闭包的每个条目都绝对优先。** 闭包也包含第三方库，插件自己的 `zod`、`yaml` 等版本会被安装中的版本替换，破坏 Node 对第三方代码的最近者优先规则。[查找顺序 Note](2026-09-19-profile-resolution-lookup-order.zh.md)已记录该备选被否决；实际发布的规则把它收窄到真正会因重复模块实例破坏共享服务的包名。

**比较版本，让更新的胜出。** 版本比较要为每次请求做 semver 判断，而且两份副本可能无法比较（预发布版、`file:` 构建或 workspace 版本）。Host 自己的运行时才是它能否加载哪些包版本的权威，因此无论版本字符串如何，installation 胜出。

**保持解析不变，要求用户自行删除陈旧的 profile 包。** 失败表现为致命启动错误，界面中没有恢复路径，所有从受影响 release 升级的用户都会遇到。要求重装或手工清理，与“升级后 profile 仍可用”的承诺相矛盾。

## Consequences

买到的：安装升级不再需要配套的 profile 重写；早期 release 装出的 profile 副本无法遮蔽正在运行的 Host 或 Cordis 运行时，单实例保证覆盖了共享服务注册的那些包。启动对用户包仍保持只读。

付出的：有意固定某个 Harness 或 Cordis 版本的 profile 会得到安装中的版本，这些固定对解析不再生效，必须改为匹配的安装。本体自有列表按包名手工维护：新增的共享状态包必须加入 `installationOwnedName()`，否则仍沿用旧的最近者优先行为。第三方库、bundle-only 包与 profile 安装的可选 Harness 插件仍按 Node 的最近者优先规则解析，因此查找顺序不再对所有包名统一。
