# 私有部署

每个客户独立运行一套 PiCoding，共享这套实例的项目、对话和模型设置。访问密码用于保护整套工作台；不提供成员权限或租户隔离。任务运行需要 Linux Docker Engine 或 Docker Desktop，Node.js 最低 22.19。

## 本机运行

默认监听 `127.0.0.1:4310`，无需访问密码。执行 `npm ci`、`npm run sandbox:build`、`npm run build` 和 `npm start`。也可设置 `PICODING_ACCESS_PASSWORD` 为本机工作台启用登录。

## HTTPS 远程访问

部署到自己的服务器，通过 HTTPS 反向代理访问。保持控制服务监听本机地址，并在 `.env` 中同时设置：

```dotenv
PICODING_HOST=127.0.0.1
PICODING_PORT=4310
PICODING_PUBLIC_ORIGIN=https://coding.example.com
PICODING_ACCESS_PASSWORD=<替换为随机访问密码>
PICODING_DATA_DIR=/var/lib/picoding
```

访问密码长度为 12–256 字符；可用 `node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"` 生成。`.env` 包含秘密，应只允许服务管理员读取，不提交到 Git。

公网地址只接受 HTTPS 来源地址，不接受路径、用户名、查询参数或通配来源。没有同时配置来源和密码时，不允许远程监听。反向代理需要保留原始 `Host`，支持 WebSocket Upgrade，并关闭 SSE 缓冲；不采用客户端提供的 `X-Forwarded-Host` 扩大来源范围。

浏览器登录后获得八小时会话；退出、过期或控制服务重启后需要重新登录。退出不会停止后台任务；重新登录后可继续查看。页面内已有的编辑和消息草稿保留，刷新后的消息草稿由当前浏览器标签页保存。修改访问密码后重启服务使旧会话失效。

模型密钥和项目数据属于同一实例。能登录的使用者能操作整个工作台，包括运行命令、查看项目和修改模型设置。安装的 pi 扩展在控制服务中执行，应仅由实例管理员安装可信来源。任务容器不接收登录 Cookie 或模型密钥。

## 交付验收

在目标机器执行 `npm run verify`、`npm run doctor` 和 `npm run test:integration`。最后检查真实 HTTPS 地址的登录、发送任务、文件保存、桌面接管、终端连接和项目导出。生产集成验收使用临时任务和本地确定性模型服务，无需真实模型凭证；外部模型服务仍须用客户自己的地址验证。

当前开发环境没有 Docker 和 Chromium，HTTP/WebSocket 访问保护及 React 交互回归测试不能替代目标机器的实际容器和浏览器验收。
