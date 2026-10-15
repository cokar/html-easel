// 部署前体检：把「忘了改配置」变成一条人能看懂的报错，而不是 wrangler 天书。
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, printParseErrorCode } from 'jsonc-parser';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

const text = await readFile(resolve(root, 'wrangler.jsonc'), 'utf8');
const errors = [];
const config = parse(text, errors, { allowTrailingComma: true });

if (errors.length) {
  console.error('\n✖ wrangler.jsonc 有语法错误：\n');
  for (const error of errors) {
    const before = text.slice(0, error.offset);
    console.error(
      `  第 ${before.split('\n').length} 行第 ${error.offset - before.lastIndexOf('\n')} 列：` +
        printParseErrorCode(error.error)
    );
  }
  console.error('');
  process.exit(1);
}

const rootDomain = String(config.vars?.ROOT_DOMAIN || '').trim().replace(/^\*\./, '');
const bucket = String(config.r2_buckets?.[0]?.bucket_name || '').trim();

if (!rootDomain || rootDomain === 'example.com') {
  problems.push(
    'vars.ROOT_DOMAIN 还是占位值 "example.com"。\n' +
      '     改成你自己的域名，例如 "mydomain.dev"。\n' +
      '     唯一的路由 *.<ROOT_DOMAIN>/* 会自动推导出来，不需要另外配。\n' +
      '     （也可以直接跑 `npm run setup`，向导会帮你写好。）'
  );
} else if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(rootDomain)) {
  problems.push(`vars.ROOT_DOMAIN = "${rootDomain}" 看起来不是一个域名。`);
}

if (!bucket) {
  problems.push('wrangler.jsonc 里缺少 r2_buckets[0].bucket_name。');
} else if (bucket === 'html-easel') {
  // R2 桶名全球唯一，这里只是提醒，不算硬错误。
  notes.push(
    `R2 桶名仍是默认的 "${bucket}"。R2 桶名在全球范围内唯一，` +
      '如果部署时报 bucket 已存在，换一个名字并同步修改 wrangler.jsonc。'
  );
}

if (problems.length) {
  console.error('\n✖ 部署前检查未通过：\n');
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
  console.error('  改完再执行一次 `npm run deploy`。\n');
  process.exit(1);
}

notes.forEach((n) => console.warn(`⚠ ${n}`));

// 后台解压 Worker 依赖这个文件（由 npm run vendor 生成）
try {
  await readFile(resolve(root, 'public/admin/vendor/fflate.js'));
} catch {
  console.error('✖ 缺少 public/admin/vendor/fflate.js，请先执行：npm run vendor');
  process.exit(1);
}

console.log(`✔ 配置检查通过（域名 ${rootDomain}，桶 ${bucket}）`);
