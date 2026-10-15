// 由 wrangler.jsonc 生成 wrangler.deploy.jsonc，唯一区别是补上通配路由。
//
// 为什么要把 routes 单独生成，而不是直接写在主配置里：
// 只要配置里存在 routes，`wrangler dev` 的本地服务器就会把所有请求的 Host
// 重写成路由里的域名（实测 *.example.com/* 会把任何 Host 变成 example.com），
// 于是本地完全没法测试「子域名 -> 项目」这条核心链路（用 myproj.localhost 也无效）。
// 放在生成文件里之后：本地开发保留真实 Host，部署时路由由 ROOT_DOMAIN 自动推导，
// 域名只存在于一个地方，不会出现两边不一致。

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, printParseErrorCode } from 'jsonc-parser';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'wrangler.jsonc');
const target = resolve(root, 'wrangler.deploy.jsonc');

const text = await readFile(source, 'utf8');

const errors = [];
const config = parse(text, errors, { allowTrailingComma: true, allowEmptyContent: false });

if (errors.length) {
  console.error('\n✖ wrangler.jsonc 有语法错误，无法生成部署配置：\n');
  for (const error of errors) {
    const before = text.slice(0, error.offset);
    const line = before.split('\n').length;
    const column = error.offset - before.lastIndexOf('\n');
    console.error(`  第 ${line} 行第 ${column} 列：${printParseErrorCode(error.error)}`);
  }
  console.error('');
  process.exit(1);
}

const rootDomain = String(config.vars?.ROOT_DOMAIN || '').trim().replace(/^\*\./, '');

if (!rootDomain || rootDomain === 'example.com') {
  console.error('\n✖ wrangler.jsonc 里的 vars.ROOT_DOMAIN 还是占位值 "example.com"。');
  console.error('  改成你自己的域名（例如 "mydomain.dev"）后重新执行。\n');
  process.exit(1);
}
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(rootDomain)) {
  console.error(`\n✖ vars.ROOT_DOMAIN = "${rootDomain}" 看起来不是一个域名。\n`);
  process.exit(1);
}

// 一条路由就够：*.<域名>/* 同时覆盖承载主机 www.<域名>（入口页 + /admin + /api）
// 和所有 <项目>.<域名>。zone route 不占用「每个域名 100 个自定义域名」的配额。
//
// ENABLE_APEX=true（默认 false）时额外生成 <域名>/* 一条：
// 给以后想让裸域名也能访问的人留的门 —— 需要另加一条 @ 的 A 记录，
// 访问时 302 到 www。默认不开，部署时就只需要一条通配 DNS 记录。
const enableApex = config.vars?.ENABLE_APEX === true;

config.routes = [{ pattern: `*.${rootDomain}/*`, zone_name: rootDomain }];
if (enableApex) {
  config.routes.unshift({ pattern: `${rootDomain}/*`, zone_name: rootDomain });
}

await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(
  `✔ 已生成 wrangler.deploy.jsonc（路由 ${config.routes.map((r) => r.pattern).join(' + ')}）`
);
