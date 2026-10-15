// 项目元数据：全部收在 R2 根下的单个 __sites.json 对象里。
//
// 为什么是单对象而不是「每项目一个 manifest + 分隔符列表」：
// 落地页要一次列出全部项目，如果逐个读 manifest，项目数超过 50 个时
// 会撞上 Workers 免费版每次调用 50 个子请求的硬上限。
// 单对象让任何读操作都只需要 1 次 R2 调用；写入走读-改-写，
// 在「单管理员顺序操作」的假设下是安全的（R2 写入强一致）。
//
// 兜底：每个文件上传时都带着 customMetadata.d = deployId，
// __sites.json 意外损坏时可以据此从对象侧重建（恢复脚本不在本期实现）。

const SITES_KEY = '__sites.json';
const CONFIG_KEY = '__config.json';

export async function loadSites(env) {
  const obj = await env.BUCKET.get(SITES_KEY);
  if (!obj) return { projects: {} };
  try {
    const parsed = await obj.json();
    if (parsed && typeof parsed === 'object' && parsed.projects && typeof parsed.projects === 'object') {
      return parsed;
    }
  } catch {
    // 损坏的对象按空处理：上传功能不受影响，落地页显示空列表
  }
  return { projects: {} };
}

export async function saveSites(env, sites) {
  await env.BUCKET.put(SITES_KEY, JSON.stringify(sites), {
    httpMetadata: { contentType: 'application/json' },
    // 只有同属本服务的对象才允许管理界面之外被误碰时校验失败
    customMetadata: { easel: 'sites' },
  });
}

/** 读-改-写。fn(sites) 就地修改；返回 fn 的返回值。 */
export async function updateSites(env, fn) {
  const sites = await loadSites(env);
  const result = await fn(sites);
  await saveSites(env, sites);
  return result;
}

/** 按创建时间倒序的项目数组（给列表和落地页用）。 */
export function sitesToList(sites) {
  return Object.values(sites.projects || {})
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ---------------------------------------------------------------- 配置对象

/** AUTH_SECRET 的 R2 侧存储：不存在则生成一个并写回。 */
export async function getOrCreateAuthSecret(env) {
  const obj = await env.BUCKET.get(CONFIG_KEY);
  let config = {};
  if (obj) {
    try {
      config = (await obj.json()) || {};
    } catch {
      config = {};
    }
  }
  if (typeof config.authSecret === 'string' && config.authSecret.length >= 16) {
    return config.authSecret;
  }

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  config.authSecret = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

  await env.BUCKET.put(CONFIG_KEY, JSON.stringify(config), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { easel: 'config' },
  });
  return config.authSecret;
}
