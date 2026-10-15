// 交互式部署向导：npm run setup
//
// 做五件事：检查登录 → 建 R2 桶（建议全局唯一名）→ 把桶名和域名写进 wrangler.jsonc
// （保留注释的正则替换，不用 --update-config，那个会重写整份配置）→ 部署 → 设置后台口令。
// 唯一剩下的手动步骤是 DNS，结束时打印精确表格。
//
// DNS 不自动化的原因：wrangler 没有 DNS 命令，走 API 得另建 Token，比省下的步骤更贵。

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, 'wrangler.jsonc');
const IS_WIN = process.platform === 'win32';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const question = async (text) => (await rl.question(text)).trim();

function run(cmd, args, { inherit = false } = {}) {
  return spawnSync(cmd, args, {
    cwd: root,
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    shell: IS_WIN, // Windows 下 npx 是 .cmd，必须经 shell
    encoding: 'utf8',
  });
}

function output(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

async function askYesNo(text, fallback = true) {
  const hint = fallback ? '[Y/n]' : '[y/N]';
  const answer = (await question(`${text} ${hint} `)).toLowerCase();
  if (!answer) return fallback;
  return answer === 'y' || answer === 'yes';
}

function step(title) {
  console.log(`\n\x1b[1;36m== ${title}\x1b[0m`);
}

// ---------------------------------------------------------------- 1. 登录检查

step('1/5 检查 wrangler 登录状态');

let accountName = null;
for (let attempt = 0; attempt < 2; attempt++) {
  const whoami = run('npx', ['wrangler', 'whoami']);
  const text = output(whoami);
  const match = text.match(/logged in.*?account\s+"([^"]+)"/is) || text.match(/Account Name:\s*(\S+)/i);
  if (whoami.status === 0 && match) {
    accountName = match[1];
    break;
  }
  if (attempt > 0 || !text.includes('not authenticated')) {
    console.error('  无法确认登录状态，上面是 wrangler 的原始输出。请先解决再重跑 npm run setup。');
    process.exit(1);
  }
  console.log('  还没有登录。现在打开浏览器授权（回车开始）…');
  await question('  回车继续 > ');
  run('npx', ['wrangler', 'login'], { inherit: true });
}

if (!accountName) {
  console.error('  未能解析出账号名，中止。');
  process.exit(1);
}
console.log(`  ✓ 已登录账号：${accountName}`);

// ---------------------------------------------------------------- 2. R2 桶

step('2/5 创建 R2 桶');

const suggestion = `html-easel-${randomBytes(3).toString('hex')}`;
console.log(`  建议桶名：${suggestion}（R2 桶名全球唯一，带随机后缀基本不会撞）`);
let bucketName = (await question(`  桶名（回车用建议值）> `)) || suggestion;
if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucketName)) {
  console.error(`  "${bucketName}" 不是合法桶名（3-63 位小写字母/数字/连字符）。`);
  process.exit(1);
}

while (true) {
  console.log(`  正在创建 ${bucketName} …`);
  const created = run('npx', ['wrangler', 'r2', 'bucket', 'create', bucketName]);
  if (created.status === 0) {
    console.log('  ✓ 桶已创建');
    break;
  }
  const text = output(created);
  if (/already exists|Bucket name already/i.test(text)) {
    const reuse = await askYesNo(`  桶 ${bucketName} 已存在于你的账号，直接用它？`);
    if (reuse) break;
    bucketName = (await question('  换个桶名 > ')).trim();
    if (!bucketName) { console.error('  桶名不能为空。'); process.exit(1); }
    continue;
  }
  if (/subscription|enable R2|purchase/i.test(text)) {
    console.error('  你的账号还没开通 R2 订阅（免费额度也需要走一次开通流程）。');
    console.error('  打开 Dashboard → Storage & databases → R2 → Overview 完成开通后重跑本向导。');
    process.exit(1);
  }
  console.error(`  创建失败：${text.trim().split('\n').slice(-3).join('\n')}`);
  process.exit(1);
}

// ---------------------------------------------------------------- 3. 写配置

step('3/5 写入 wrangler.jsonc');

let configText = await readFile(configPath, 'utf8');
const parsed = parse(configText, [], { allowTrailingComma: true });
const currentDomain = String(parsed.vars?.ROOT_DOMAIN || '');

let rootDomain = currentDomain;
if (!rootDomain || rootDomain === 'example.com') {
  rootDomain = (await question('  你的域名（必须已托管在 Cloudflare，如 mydomain.dev）> ')).toLowerCase();
}
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(rootDomain)) {
  console.error(`  "${rootDomain}" 看起来不是域名。`);
  process.exit(1);
}

configText = configText.replace(
  /("bucket_name"\s*:\s*")[^"]*(")/,
  `$1${bucketName}$2`
);
configText = configText.replace(
  /("ROOT_DOMAIN"\s*:\s*")[^"]*(")/,
  `$1${rootDomain}$2`
);
await writeFile(configPath, configText, 'utf8');

// 确认写入真的生效了（占位值替换失败是最常见的意外）
const verify = parse(configText, [], { allowTrailingComma: true });
if (verify.r2_buckets?.[0]?.bucket_name !== bucketName || verify.vars?.ROOT_DOMAIN !== rootDomain) {
  console.error('  配置写入校验失败（wrangler.jsonc 的结构可能被改过），请手工填这两项后重跑。');
  process.exit(1);
}
console.log(`  ✓ 桶名与域名已写入（ROOT_DOMAIN=${rootDomain}，bucket=${bucketName}）`);

// ---------------------------------------------------------------- 4. 部署

step('4/5 部署');

const deployNow = await askYesNo('  现在部署到 Cloudflare？');
if (deployNow) {
  const deployed = run('npm', ['run', 'deploy'], { inherit: true });
  if (deployed.status !== 0) {
    console.error('  部署失败，上面有 wrangler 的原始报错；解决后可直接重跑 `npm run deploy`。');
    rl.close();
    process.exit(1);
  }
} else {
  console.log('  跳过。之后执行：npm run deploy');
}

// ---------------------------------------------------------------- 5. 口令 + 手动步骤

step('5/5 设置后台口令');

if (deployNow && await askYesNo('  现在设置 ADMIN_PASSWORD（输入不回显）？')) {
  // 交互式输入，口令不进 shell 历史
  run('npx', ['wrangler', 'secret', 'put', 'ADMIN_PASSWORD'], { inherit: true });
  console.log('  ✓ 口令已设置，立即生效（AUTH_SECRET 会自动生成，不用管）');
} else {
  console.log('  之后执行：npx wrangler secret put ADMIN_PASSWORD');
}

rl.close();

console.log(`
\x1b[1;36m== 剩最后一步（手动）：加 DNS 记录\x1b[0m

  Dashboard → 你的域名 ${rootDomain} → DNS → Records → Add record：

  ┌────────┬────────┬─────────────┬──────────────────────┐
  │ 类型   │ 名称   │ IPv4 地址   │ 代理状态             │
  ├────────┼────────┼─────────────┼──────────────────────┤
  │ A      │ *      │ 192.0.2.1   │ Proxied（橙云）      │
  └────────┴────────┴─────────────┴──────────────────────┘

  就这一条。IP 随便填（请求会被 Worker 截获），橙云必须开。
  生效后（约 1-2 分钟）：

    入口页    https://www.${rootDomain}/
    管理后台  https://www.${rootDomain}/admin/
    项目页面  https://<项目名>.${rootDomain}/

  建议顺手加一条 WAF 限流（路径 /api/login，60 秒 10 次，Block）保护登录口令。
`);
