# 私有部署

每个客户独立运行一套 PiCoding，共享这套实例的项目、对话和模型设置。访问密码用于保护整套工作台；不提供成员权限或租户隔离。私有部署和备份支持 Linux/WSL，需要 Docker、Node.js 22.19 或更新版本及 util-linux 的 `flock`。原生 Windows 本机模式可运行，但备份命令需在 WSL 中使用。

## 本机运行

默认监听 `127.0.0.1:4310`，无需访问密码。执行 `npm ci`、`npm run sandbox:build`、`npm run build` 和 `npm start`。也可设置 `PICODING_ACCESS_PASSWORD` 为本机工作台启用登录。

## HTTPS 远程访问

部署到自己的服务器，通过 HTTPS 反向代理访问。保持控制服务监听本机地址，并在 `.env` 中设置：

```dotenv
PICODING_HOST=127.0.0.1
PICODING_PORT=4310
PICODING_PUBLIC_ORIGIN=https://coding.example.com
PICODING_DATA_DIR=/var/lib/picoding
```

先运行 `npm run build`，在服务停止时，以服务用户初始化独立的工作台访问密码：

```bash
PICODING_DATA_DIR=/var/lib/picoding npm run access -- init
```

命令输出随机密码一次，请保存到密码管理器。后端仅在 `<PICODING_DATA_DIR>/access.json` 保存带随机盐的 scrypt 哈希，权限 `0600`；文件损坏会阻止服务启动。重复初始化不会覆盖已有密码。此密码与服务器 SSH 登录密码分别管理。

也可设置 `PICODING_ACCESS_PASSWORD` 为 12–256 字符的密码；显式环境变量优先于密码文件。使用该方式时，请通过环境文件修改密码并重启服务，密码管理命令会拒绝改写。`.env` 包含秘密，应只允许服务管理员读取，不提交到 Git。

可运行 `npm run access -- status` 查看是否启用鉴权及配置来源，不输出密码或哈希。重置文件密码需先正常停止服务，使用同一服务用户和数据目录运行：

```bash
PICODING_DATA_DIR=/var/lib/picoding npm run access -- reset
```

启动服务后仅新密码有效，旧登录会话失效。密码管理与服务共用数据目录锁，运行中的服务会阻止初始化或重置。Linux/WSL 的维护命令需要 util-linux `flock`。完整备份包含密码哈希文件，恢复后沿用原工作台密码。

公网地址只接受 HTTPS 来源地址，不接受路径、用户名、查询参数或通配来源。没有同时配置来源和密码时，不允许远程监听。反向代理需要保留原始 `Host`，支持 WebSocket Upgrade，并关闭 SSE 缓冲；不采用客户端提供的 `X-Forwarded-Host` 扩大来源范围。

浏览器登录后获得八小时会话；退出、过期或控制服务重启后需要重新登录。退出不会停止后台任务；重新登录后可继续查看。页面内已有的编辑和消息草稿保留，刷新后的消息草稿由当前浏览器标签页保存。修改访问密码后重启服务使旧会话失效。

模型密钥和项目数据属于同一实例。能登录的使用者能操作整个工作台，包括运行命令、查看项目和修改模型设置。安装的 pi 扩展在控制服务中执行，应仅由实例管理员安装可信来源。任务容器不接收登录 Cookie 或模型密钥。

## Linux 服务管理

将代码放在 `/opt/picoding`，完成 `npm ci`、`npm run sandbox:build` 和 `npm run build`。创建 `picoding` 系统用户，并授予 Docker 使用权限：

```bash
sudo useradd --system --home-dir /var/lib/picoding --create-home --shell /usr/sbin/nologin picoding
sudo usermod -aG docker picoding
```

Docker 权限用于创建任务容器，属于宿主机管理权限。服务用户不能用于不可信的成员账户；这套产品面向实例管理员和可信使用者。

将已填好的部署配置保存为 `/etc/picoding.env`，权限 `0600`、属主 root，数据目录使用 `/var/lib/picoding`。环境变量由 systemd 注入，避免同时维护两份不同的 `.env`。仓库提供 [picoding.service](deploy/picoding.service)：

```bash
sudo install -m 0644 deploy/picoding.service /etc/systemd/system/picoding.service
```

先确认 `command -v node` 指向系统级 Node，把服务中 `/usr/bin/node` 改为实际可执行路径；不要使用管理员 home 下的 nvm 路径，因为服务启用了 `ProtectHome`。本地插件源放在服务用户可读的路径，例如 `/var/lib/picoding/local-packages`。

```bash
sudo systemd-analyze verify /etc/systemd/system/picoding.service
sudo systemctl daemon-reload
sudo systemctl enable --now picoding
sudo systemctl status picoding
sudo journalctl -u picoding -n 100
```

服务会创建权限 `0700` 的数据目录，失败后重启，并为正常退出保留 90 秒。两个控制服务或维护命令不能同时使用同一数据目录；SIGKILL 后内核会释放锁，不需要手动删除锁文件。

把 [Caddyfile](deploy/Caddyfile) 的站点块合并到 Caddy 配置，将域名与 `PICODING_PUBLIC_ORIGIN` 保持一致，再运行 `caddy validate` 和重载。域名 DNS 指向服务器，公网开放 HTTPS 所需端口；控制服务保持 loopback。Caddy 的标准反代支持 WebSocket，并对 `text/event-stream` 即时传输，配置依据见 [官方 reverse_proxy 文档](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。

## 完整备份

先正常停止工作台，等待任务环境关闭。编译后的维护命令不依赖 tsx 或开发依赖：

```bash
sudo systemctl stop picoding
PICODING_DATA_DIR=/var/lib/picoding npm run backup -- create /srv/picoding-backups/release-backup
sudo systemctl start picoding
```

从代码目录运行命令，使用具有数据目录和 Docker 访问权限的服务用户，并提前准备可写的私有备份父目录。备份目录必须是新目录，且在数据目录之外。该目录按 `0700` 创建，含私有项目、对话和可能存在的模型密钥。

备份包含整个 `PICODING_DATA_DIR`（任务记录、模型设置、pi 会话与资源配置）和每个存在的完整项目卷，包括 `.git`、`.picoding/browser` 及二进制文件。未成功创建环境的任务可以没有项目卷，清单会明确记录。运行中的服务、项目卷或未正常关闭的任务会阻止备份。

控制服务数据和各项目卷独立归档，清单记录 SHA-256 校验值。外部 `.env`、systemd 环境文件、在数据目录外配置的本地插件源及环境变量中的模型密钥不属于数据备份，需要单独迁移。备份不跟随指向归档外的链接；遇到该链接会退出，避免得到不完整或不可移植的结果。

## 恢复与升级

在空的数据目录、没有同名项目卷的目标 Docker 环境中恢复。先安装同一代码版本并构建任务镜像，保持服务停止：

```bash
PICODING_DATA_DIR=/var/lib/picoding npm run backup -- restore /srv/picoding-backups/release-backup
sudo systemctl start picoding
```

恢复先验证清单、归档校验值、路径/链接安全和任务记录一致性，再创建项目卷和提交控制服务数据。已有数据或同名卷会让命令退出，保留原项目。恢复返回失败时，工具会清理本次新建的卷；Docker 清理失败会明确报错。若进程被强制杀死或机器断电，可能留下未完成的目录或新卷，需检查后再恢复；工具仍会拒绝覆盖它们。只有清单写入成功的备份目录才算完成备份。单个归档解压后上限为 100 GiB。恢复后的任务保持停止状态，登录后点击「启动环境」继续。

升级前停止服务、建立完整备份，再更新到确认的 Git 提交，执行 `npm ci`、`npm run build` 和对应版本的 `sandbox:build`，之后启动并验收。记录旧 Git 提交和旧镜像名供回滚使用。当前模型设置采用多供应商格式，旧单模型配置首次保存或切换时会迁移；旧版本不能直接读取新格式。回滚至不支持 `access.json` 的版本时，先按旧版本配置访问密码，并使用与该版本匹配的数据备份恢复。不要把代码回滚当作项目数据恢复。

## 交付验收

在目标机器执行 `npm run verify`、`npm run doctor` 和 `npm run test:integration`。最后检查真实 HTTPS 地址的登录、发送任务、文件保存、桌面接管、终端连接和项目导出。生产集成验收使用临时任务和本地确定性模型服务，无需真实模型凭证；外部模型服务仍须用客户自己的地址验证。

验收记录应注明 Git 提交和实际运行环境。HTTP/WebSocket 访问保护及 React 交互回归测试不能替代目标机器的真实 HTTPS、容器和浏览器验收。
