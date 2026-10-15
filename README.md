<div align="center">

# 🎨 Easel

**上传一个 ZIP，得到一个网站。**

解压在浏览器里完成，Cloudflare 只管存储和分发 —— 所以免费额度就够，成本 $0。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers_%C2%B7_R2-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Tests](https://img.shields.io/badge/smoke_tests-72_passing-brightgreen)](scripts/smoke-test.mjs)

[特性](#-特性) · [原理](#-它是怎么工作的) · [快速开始](#-快速开始) · [部署上线](#-部署上线) · [常见问题](#-常见问题)

</div>

---

## ✨ 特性

- **💸 零成本** — 一个 Worker + 一个 R2 桶就是全部基础设施，免费额度绰绰有余，附[逐项核算](#-免费额度核算)
- **🧊 浏览器端解压** — ZIP 在浏览器里用 Web Worker 流式解开，绕开 Workers 免费版 10ms CPU / 128MB 内存 / 50 子请求三重限制（服务端解压方案必然超时的原因）
- **🌐 子域名隔离** — 每个项目一个 `<项目名>.你的域名`，项目内绝对路径互不串扰，不改写 HTML
- **🚀 部署只有 6 步** — `npm run setup` 向导建桶、写配置、引导设口令；全程只需 1 条 DNS 记录、1 条路由、1 个 Secret
- **⚡ 部署即生效** — 边缘缓存键包含部署版本号，重新部署立即全局生效，不用等 TTL
- **🖥️ 自带入口页和后台** — `www.你的域名` 是项目收藏页（搜索 + 统计），`/admin` 是管理后台，全部由 Worker 自己托管，不用 Cloudflare Pages
- **🛡️ 内置防护** — 路径穿越拦截、系统垃圾文件过滤、HMAC 签名会话、常量时间口令比较
- **✅ 72 项端到端测试** — `npm run smoke` 用真实 ZIP 走完登录、上传、分发、覆盖部署、删除全流程

## 🧭 它是怎么工作的

| 环节 | 由谁负责 |
| :--- | :--- |
| 解压 ZIP | 你的浏览器（`public/admin/unzip-worker.js`，用 fflate 流式解压） |
| 分片上传 | 浏览器按「≤40 个文件 / ≤20MB」一批推给 `/api/projects/<名字>/files` |
| 存文件 | Worker 写入 R2，键为 `<项目名>/<路径>` |
| 存元数据 | 也在 R2 —— 单个 `__sites.json` 对象承载全部项目登记信息 |
| 对外入口页 | `www.你的域名` 由 Worker 渲染项目列表（`src/landing.js`） |
| 分发访问 | 同一个 Worker 按 Host 取项目名 → 读 R2 → 按 `deployId` 做边缘缓存 |

三个位置各司其职，**只需要一条路由、一条 DNS 记录**（部署时自动生成）：

```
www.你的域名            ->  /       对外入口页（项目列表）
                           /admin  管理后台（登录上传）      ┐
                           /api/*  接口                     ├ 路由 *.你的域名/*
<项目名>.你的域名         ->  该项目在 R2 里的静态文件        ┘
```

**为什么元数据放 R2 而不是 D1**：本项目对元数据的全部需求就是「按 id 查 + 全列表」，一个 JSON 对象就够了；少一个数据库就少一整套创建 / 填 id / 建表的部署步骤。落地页要一次列出全部项目，如果逐个读 manifest，项目数超过 50 个时会撞免费版每次调用 50 个子请求的硬上限 —— 单对象让任何读操作都只需 1 次 R2 调用。

**为什么选子域名而不是路径**：子域名天然隔离，项目里的 `/style.css` 这类绝对路径不会串到别的项目，不需要改写 HTML，也不用担心 `<base>`。后台自己倒是放在 `/admin` 路径上 —— 那是我们自己的界面，路径可控；而且项目子域名里的 `/admin` 属于项目内容，不会被劫持。

**为什么不用 Cloudflare Pages**：Pages 不支持通配自定义域名，且有 100 个项目 / 20000 文件 / 每月 500 次构建的限制；R2 方案没有这些天花板。

## 🚀 快速开始

本地跑起来不需要 Cloudflare 账号 —— Miniflare 会在本地模拟 R2。

```bash
git clone <你的仓库地址> easel && cd easel
npm install                # 安装依赖，并把 fflate 拷入 public/admin/vendor/
cp .dev.vars.example .dev.vars
npm run dev                # http://127.0.0.1:8787
```

| 看什么 | 地址 |
| :--- | :--- |
| 访客视角的入口页 | `http://127.0.0.1:8787/` 或 `http://localhost:8787/` |
| 管理后台 | `http://127.0.0.1:8787/admin/` |
| 某个项目 | `http://<项目名>.localhost:8787/` |

本地口令在 `.dev.vars` 里（模板默认 `dev-password-change-me`）。Chrome 会把 `*.localhost` 解析到 `127.0.0.1`，三个地址都能直接访问。会话签名密钥不需要配置 —— 首次运行自动生成。

跑测试：

```bash
npm run smoke    # 另开一个终端跑着 npm run dev，然后用真实 ZIP 走 72 项断言
```

> [!TIP]
> 改了服务端代码后如果页面没变化，是浏览器缓存 —— 入口页 60 秒、资源 10 分钟。加个 `?v=1` 或 `?fresh=1` 立刻看到最新内容。

## 📖 部署上线

全新账号大约 10 分钟，共 6 步。需要：一个已托管在 Cloudflare 的域名（NS 指向 Cloudflare）+ Node 18+。

### 第 1 步：安装依赖并登录

```bash
npm install
npx wrangler login      # 打开浏览器授权
npx wrangler whoami     # 核对账号（多账号的人在这里最容易踩错）
```

### 第 2 步：开通 R2 订阅（一次性）

> [!IMPORTANT]
> R2 即使只用免费额度，也要先在账号里走一次开通流程，否则下一步建桶会直接失败。
> Dashboard → **Storage & databases** → **R2** → **Overview** → 完成开通。
> 会要求添加支付方式；免费额度内（10GB 存储 + 每月 100 万次 A 类 + 1000 万次 B 类操作）不产生费用。

### 第 3 步：跑 setup 向导

```bash
npm run setup
```

向导依次做五件事，每步都有确认：

1. 检查 wrangler 登录状态
2. 创建 R2 桶（建议全局唯一名 `easel-<随机后缀>`，已存在可复用）
3. 把桶名和你的域名写进 `wrangler.jsonc`（保留注释的精确替换，不用 `--update-config`）
4. 部署（可跳过，之后 `npm run deploy`）
5. 引导设置后台口令 `ADMIN_PASSWORD`（交互输入，不进 shell 历史）

签名密钥 `AUTH_SECRET` 不用设 —— 首次访问时自动生成并存在你自己的 R2 里。

### 第 4 步：加 DNS 记录（就一条）

Dashboard → 你的域名 → **DNS** → **Records** → **Add record**：

| 类型 | 名称（Name）| IPv4 地址 | 代理状态 |
| :--- | :--- | :--- | :--- |
| `A` | `*` | `192.0.2.1` | **Proxied（橙云）** |

- **IP 为什么可以随便填**：请求会被 Worker 路由截获，永远不会回源。`192.0.2.1` 是 RFC 5737 文档保留地址，不会撞上真实主机。
- **为什么必须开橙云**：只有被代理的请求才经过 Cloudflare 边缘、才命中 Worker 路由、才用得上 `*.<域名>` 的免费证书。灰云会去连那个不存在的 IP，直接连接失败。

验证（一两分钟后）：

```bash
nslookup anything.mydomain.dev    # 返回 Cloudflare 的 IP（而非 192.0.2.1）即生效
```

> [!NOTE]
> 通配记录是多级的，但免费版 Universal SSL 只覆盖一层子域名 —— `a.mydomain.dev` 能用，`a.b.mydomain.dev` 会证书错误。本项目按一层设计。
> 默认裸域名（不带 www）不解析。以后想要的话：`wrangler.jsonc` 里 `ENABLE_APEX` 改 `true` → 再加一条 `@` 的 A 记录（橙云）→ `npm run deploy`，裸域名会 302 到 www。

### 第 5 步：部署（如果第 3 步跳过了）

```bash
npm run deploy
```

串了三步：`preflight` 检查占位值 → 从 `ROOT_DOMAIN` 生成含路由的 `wrangler.deploy.jsonc` → `wrangler deploy`。预期输出最后能看到路由 `*.你的域名/*`。

### 第 6 步：验证

1. **入口页** `https://www.你的域名/` —— 大标题 + 空状态 + 右上角「管理后台」
2. **后台** `https://www.你的域名/admin/` —— 用第 3 步的口令登录
3. **传第一个项目** —— 拖一个 ZIP，日志出现 `✓ 上线：https://<项目名>.你的域名/`
4. **打开项目** —— 新标签页看到你上传的页面
5. **回入口页** —— 新项目出现在列表里（60 秒浏览器缓存，加 `?v=1` 立刻看到）

**部署后建议**：给登录接口加一条 WAF 限流（Dashboard → Security → WAF → Rate limiting：路径 `/api/login`，60 秒 10 次，Block 60 秒）。免费套餐含 1 条。

<details>
<summary>常见报错速查（点开）</summary>

| 报错 / 现象 | 原因 |
| :--- | :--- |
| setup 提示需要 R2 订阅 | 第 2 步没做 |
| `vars.ROOT_DOMAIN 还是占位值`（preflight） | 第 3 步没跑完 |
| `缺少 public/admin/vendor/fflate.js`（preflight） | 没跑 `npm install` |
| `Could not find zone "mydomain.dev"` | 域名不在当前账号下，或 `wrangler whoami` 是另一个账号 |
| `A worker with the name "html-hosting" already exists` | 账号里已有同名 Worker：删掉它，或改 `wrangler.jsonc` 的 `name` |
| www 打开 404 | DNS 通配记录没加或没开橙云 |
| 项目页证书错误 | 通配证书还在签发（几分钟，最长 24 小时）；或子域名超过一层 |
| 后台提示"服务端未设置 ADMIN_PASSWORD" | 口令 secret 没设，跑 `npx wrangler secret put ADMIN_PASSWORD` |

</details>

### 以后怎么更新

| 你想做什么 | 怎么做 |
| :--- | :--- |
| 改代码（`src/`、`public/`） | `npm run deploy` |
| 改入口页文案 | 改 `wrangler.jsonc` 的 `SITE_TITLE` / `SITE_DESCRIPTION` → `npm run deploy` |
| 改后台口令 | `npx wrangler secret put ADMIN_PASSWORD`（立即生效，不需要重新部署） |
| 换域名 | 改 `ROOT_DOMAIN` → 给新域名加通配 A 记录 → `npm run deploy`；旧 DNS 记录要自己删 |
| 增删项目、重新部署项目 | 全在后台界面操作 |
| 回滚到上一个版本 | `npx wrangler rollback`，或 Dashboard → Deployments → Rollback |

### 想彻底卸载

```bash
npx wrangler delete                   # 删 Worker（路由一并移除）
npx wrangler r2 bucket delete <桶名>   # 删桶（需先清空对象）
```

最后回 Dashboard 的 DNS 删掉那条通配 `A` 记录。

## 🕹️ 日常使用

**对访客**（`https://www.你的域名/`）：项目列表，点卡片直接打开；搜索框按 `/` 聚焦、`Esc` 清空；右上角「管理后台」是给你用的入口。

**对你**（`https://www.你的域名/admin/`）：

- **上传新项目**：拖入 ZIP 或单个 HTML。项目名自动从文件名推导，可改；上传前先显示探测结果（入口文件、数量、体积、是否剥掉顶层目录、忽略了几个垃圾文件）
- **项目卡片**：打开 / 复制链接 / 重新部署（覆盖） / 删除
- 顶栏「查看入口页」直达访客视角；失败自动重试 3 次（指数退避）

**自动处理**：剥掉 ZIP 常见的单层顶层目录；丢弃 `__MACOSX/`、`.DS_Store`、`.git/` 等垃圾；拦截带 `..` 的路径穿越；入口探测优先 `index.html`，其次浅层 `home/default/main.html`；覆盖部署按 `deployId` 清理上一版残留；入口页只列部署完成的项目。

**URL 行为**：`/` → 入口文件；`/about` → 先试 `about/index.html` 再试 `about.html`；找不到时项目自带的 `404.html` 会顶上；`?fresh=1` 绕过所有缓存。

## 🧪 本地开发与测试

```bash
cp .dev.vars.example .dev.vars
npm run dev          # http://127.0.0.1:8787
npm run smoke        # 另开终端；72 项断言
```

> [!WARNING]
> **不要把 `routes` 写回 `wrangler.jsonc`。** 只要配置里存在 routes，`wrangler dev` 会把所有请求的 Host 重写成路由域名，本地完全没法测试子域名分发。路由由 `npm run deploy` 时生成到 `wrangler.deploy.jsonc`，详见 `scripts/build-config.mjs` 顶部注释。

## 📊 免费额度核算

以 200 个项目、每个 1000 个文件共 5MB 计：

| 项目 | 用量 | 免费额度 | 余量 |
| :--- | :--- | :--- | :--- |
| R2 存储 | 1 GB（含 `__sites.json`，几 KB） | 10 GB / 月 | 10% |
| R2 A 类操作（上传、列出、删除） | 约 20 万 / 月 | 100 万 / 月 | 20% |
| R2 B 类操作（读取） | 每次页面访问 2 次（元数据 + 文件），边缘缓存命中时只有元数据 1 次 | 1000 万 / 月 | 充裕 |
| **Workers 请求** | **每访问一个资源算 1 次**，入口页每次 1 次 | **10 万 / 天** | **最先撞墙** |

**最需要留意的一条**：边缘缓存能减少 R2 读取，但**不能减少 Worker 的请求计数** —— 一个含 20 个资源的页面每天被访问 5000 次就吃满 10 万/天。个人收藏夹的流量下够用；要分享给较多人就升级 Workers Paid（$5/月，含 1000 万请求/月），这是唯一的现实付费点。R2 免费额度只适用于 Standard 存储，出口流量免费。

## ⚠️ 限制与取舍

- **元数据是单文件**（`__sites.json`）：读-改-写在单管理员顺序操作下安全；文件上传时都带 `deployId` 的 `customMetadata`，极端情况下可从对象侧重建索引。不做并发写锁。
- **浏览器缓存有延迟**：边缘按 `deployId` 换键，重新部署在边缘**立刻全局生效**；访客浏览器自己的副本要等 `max-age`（HTML 60 秒，资源 10 分钟）。改 `src/mime.js` 的 `cacheControlFor` 可调。
- **单次上传上限**：单文件 ≤50MB、单批 ≤30MB、单项目解压后 ≤300MB、≤5000 个文件（常量在 `public/admin/unzip-worker.js` 和 `src/api.js` 顶部）。
- **口令暴力破解防护有限**：常量时间比较 + 单 isolate 节流，全局限流要靠那条 WAF 规则。
- **项目名必须是合法 DNS 标签**：小写字母数字与连字符，≤40 字符，不能连续连字符，不能在保留名单里（`www`/`admin`/`api`/`mail` 等，见 `src/util.js`）。
- **会话 Cookie 有效期 7 天**。

**刻意不做的事**：不改写项目内的绝对路径引用（子域名天然隔离）、不做多用户、不做访问统计、不保留原始 ZIP。

## ❓ 常见问题

**为什么解压放在浏览器，而不是 Worker 里？**
Workers 免费版每次调用只有 10ms CPU、128MB 内存、50 个子请求。服务端解压稍大的包必然 1102 超时，而且往 R2 写每个文件都算一次子请求，50 个文件就是上限。挪到浏览器后这三条限制全部消失。

**忘记后台口令怎么办？**
`npx wrangler secret put ADMIN_PASSWORD` 重新设一个，立即生效，不需要重新部署。

**AUTH_SECRET 不设置安全吗？**
首次访问时自动生成 64 位随机串存在你自己的 R2 桶里 —— 桶只有你的 Worker 绑定能读，和存在 Worker Secret 里的信任域相同。要显式管理也行：`npx wrangler secret put AUTH_SECRET`，设置后优先生效。

**项目里有个 `/admin` 目录，会被后台劫持吗？**
不会。后台只挂在 `www.你的域名/admin`；项目子域名下的 `/admin/...` 属于项目自己的内容（有 72 项测试里的专门断言）。

其余问题见[部署上线](#-部署上线)的报错速查。

## 📁 项目结构

```
├─ wrangler.jsonc          主配置（不含 routes，原因见本地开发一节的警告）
├─ wrangler.deploy.jsonc   部署时自动生成，含路由，不要手改
├─ .dev.vars.example       本地密钥模板
├─ src/
│  ├─ index.js             入口：按 Host 分流入口页 / /admin / 项目 / 保留子域名
│  ├─ landing.js           对外入口页（服务端渲染 + 内联 CSS + 搜索过滤）
│  ├─ api.js               登录、项目增删、分片上传、finalize、残留清理
│  ├─ serve.js             R2 读取、Content-Type、ETag、边缘缓存、后台静态资源
│  ├─ sites.js             元数据层：__sites.json / __config.json 读写与密钥自举
│  ├─ auth.js              HMAC 签名会话 Cookie、常量时间口令比较
│  ├─ mime.js              扩展名 → Content-Type、缓存时长
│  └─ util.js              主机名解析、项目名校验、路径规范化
├─ public/admin/           管理后台（由 Worker 托管，URL 路径 /admin/*）
│  ├─ index.html / app.js / style.css
│  ├─ unzip-worker.js      Web Worker：两遍扫描（先读中央目录做规划，再流式解压分片）
│  └─ vendor/fflate.js     由 npm run vendor 拷入，不进版本库
└─ scripts/
   ├─ setup.mjs            交互式部署向导（建桶/写配置/设口令）
   ├─ vendor.mjs           拷贝 fflate
   ├─ preflight.mjs        部署前配置体检
   ├─ build-config.mjs     生成带路由的部署配置
   └─ smoke-test.mjs       72 项端到端断言
```

## 🧰 技术栈

| 层 | 选型 | 说明 |
| :--- | :--- | :--- |
| 运行时 | [Cloudflare Workers](https://workers.cloudflare.com/) | 免费版，100k 请求/天 |
| 存储 | [Cloudflare R2](https://developers.cloudflare.com/r2/) | 文件 + 元数据一桶搞定，出口流量免费 |
| 解压 | [fflate](https://github.com/101arrowz/fflate) | 纯 JS，浏览器端流式解压 |
| 前端 | 原生 ES Modules | 无框架、无构建步骤 |
| 测试 | Node 原生脚本 | `npm run smoke`，72 项端到端断言 |

## 📄 许可证

[MIT](LICENSE) © 2026 cokar
