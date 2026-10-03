# Qfund 前端部署约定

保留现有界面和基金数据结构；Qfund 是面向用户的名称，不重命名后端 CLI。

## 私有子路径构建

在 `frontend/` 下执行：

```sh
VITE_BASE_PATH=/qfund/ VITE_ALLOW_REGISTRATION=false npm run build
```

标准 Vite 参数同样适用于生产构建：

```sh
VITE_ALLOW_REGISTRATION=false npm run build -- --base=/qfund/
```

构建默认输出到 `backend/static/`。`VITE_BASE_PATH` 也可以放在本地环境配置中；
省略时使用 `/`。开发环境测试子路径时使用 `VITE_BASE_PATH=/qfund/ npm run dev`，
这样开发服务器会将 `/qfund/api/*` 转发为后端的 `/api/*`。

页面路由、静态资源、axios 请求、AI 分析流和登录失效跳转均使用同一个构建前缀。
例如 `/qfund/holdings`、`/qfund/assets/*`、`/qfund/api/*`、`/qfund/login`。
React Router 内的 `/login` 等路由是相对于 basename 的应用路由，不是站点根路径。

## 反向代理对接

- `/qfund` 应重定向到 `/qfund/`。
- `/qfund/` 代理到应用时去掉 `/qfund/` 前缀，后端仍接收 `/`、`/api/*` 和 `/assets/*`。
- `/qfund/holdings` 等页面刷新必须返回应用入口；API 不得退回 HTML 入口。
- AI 分析接口使用流式响应，代理应关闭该接口的响应缓冲。
- 不必、也不应在个人主页添加 Qfund 链接。

## 账户与隐私

生产构建默认不显示注册入口；`VITE_ALLOW_REGISTRATION=false` 可明确关闭。
开发构建默认保留注册，设为 `false` 也会关闭。
这只是界面设置：服务端必须另行关闭注册并对 API 实施鉴权，不能靠隐藏页面保护数据。

在线 AI 分析及提示词编辑入口在生产构建也默认关闭，已有 AI 结果仍可查看。
需要启用时必须同时配置服务端执行能力和 `VITE_ALLOW_AI_ANALYSIS=true`；
仅改变前端开关不会赋予后端执行权限。开发构建默认保留，可用 `false` 明确关闭。

令牌存储键为 `qfund:<部署前缀>:access-token`，不读取或迁移旧的通用 `token` 键。
更换部署前缀后需要重新登录。前缀化 localStorage 键只避免命名冲突，不提供同源安全隔离；
同域的其他脚本仍能访问 localStorage。如需浏览器级隔离，应使用独立子域。

页面声明 `noindex, nofollow, noarchive`，但这不是访问控制。
所有 `VITE_*` 变量都会进入公开前端产物，不能放密码或密钥。

## 验证

`npm run check:deployment` 检查根目录、多级子路径、注册开关、令牌隔离与 401 跳转；
`npx tsc --noEmit` 运行整个前端的类型检查。发布时还应实际检查登录页、资源加载和深层链接刷新。
