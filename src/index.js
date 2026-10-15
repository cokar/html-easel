// Worker 入口：所有请求先进这里，再由 Host 决定去向。
//
//   www.<域名>        /         ->  对外入口页（项目列表）
//                    /admin    ->  管理后台（登录上传）
//                    /api/*    ->  接口
//   <项目>.<域名>                ->  该项目在 R2 里的静态文件
//   <根域名>（仅 ENABLE_APEX）    ->  302 到 www
//   其他保留子域名                ->  提示页
//
// 只需要一条通配路由 *.<域名>/*：它同时覆盖 www（承载主机）和所有 <项目>.<域名>，
// 见 scripts/build-config.mjs。

import { parseHost } from './util.js';
import { handleApi } from './api.js';
import { serveProject, serveAdmin, infoPage } from './serve.js';
import { serveLanding } from './landing.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = parseHost(url.hostname, env.ROOT_DOMAIN);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request, env);
    }

    // /admin 只在承载主机（www / 本地 / 预览域名）上生效：
    // 项目子域名里的 /admin 路径属于项目自己的内容，不能劫持。
    if (
      (host.kind === 'console' || host.kind === 'local' || host.kind === 'unknown') &&
      (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))
    ) {
      return serveAdmin(request, env);
    }

    switch (host.kind) {
      case 'project':
        return serveProject(request, env, ctx, host.projectId);

      // 承载主机：根路径渲染入口页，其余路径给一个 404 提示
      case 'console':
      case 'local':
      case 'unknown':
        if (url.pathname !== '/') {
          return infoPage(404, '未找到', `这个地址没有对应的内容。入口在 <a href="/">首页</a>。`, env, request);
        }
        return serveLanding(request, env, ctx);

      // 只有 ENABLE_APEX=true 时部署配置里才会有根域名路由；到得了这里就跳 www
      case 'apex':
        return Response.redirect(`https://www.${env.ROOT_DOMAIN}/`, 302);

      case 'reserved':
        return infoPage(
          404,
          '保留子域名',
          `<code>${host.label}</code> 是系统保留名，未被分配给任何项目。后台在 <code>www.${String(env.ROOT_DOMAIN || '')}/admin</code>。`,
          env,
          request
        );

      case 'invalid':
        return infoPage(
          404,
          '地址无效',
          '只能通过 <code>www.' + String(env.ROOT_DOMAIN || '') + '</code> 或 <code>项目名.' + String(env.ROOT_DOMAIN || '') + '</code> 这一层子域名访问（免费版证书不覆盖多级子域名）。',
          env,
          request
        );

      default:
        return infoPage(404, '未找到', '这个地址没有对应的内容。', env, request);
    }
  },
};
