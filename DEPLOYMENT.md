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

文件密码可在「模型设置 → 访问安全」修改：验证当前密码，输入 12–256 个字符的新密码并再次确认。服务原子替换 `access.json` 中的带盐哈希，保留 `0600` 权限；成功后立即拒绝旧密码，刷新当前浏览器的会话，并注销其他会话及实时连接，无需重启。项目、模型配置和正在执行的任务保留。保存失败时仍可使用原密码和原会话，页面保留输入供重试。系统更新或关闭期间拒绝修改，关闭流程等待已开始的密码保存完成。

可运行 `npm run access -- status` 查看是否启用鉴权及配置来源，不输出密码或哈希。忘记文件密码时，需先正常停止服务，使用同一服务用户和数据目录运行：

```bash
PICODING_DATA_DIR=/var/lib/picoding npm run access -- reset
```

启动服务后仅新密码有效，旧登录会话失效。CLI 密码管理与服务共用数据目录锁，运行中的服务会阻止 CLI 初始化或重置；页面修改由持有该锁的服务执行。Linux/WSL 的维护命令需要 util-linux `flock`。完整备份包含密码哈希文件，恢复后沿用备份时的工作台密码。

公网地址只接受 HTTPS 来源地址，不接受路径、用户名、查询参数或通配来源。没有同时配置来源和密码时，不允许远程监听。反向代理需要保留原始 `Host`，支持 WebSocket Upgrade，并关闭 SSE 缓冲；不采用客户端提供的 `X-Forwarded-Host` 扩大来源范围。

浏览器登录后获得八小时会话；退出、过期或控制服务重启后需要重新登录。退出不会停止后台任务；重新登录后可继续查看。页面内已有的编辑和消息草稿保留，刷新后的消息草稿由当前浏览器标签页保存。页面修改密码保留当前浏览器登录；管理员通过 CLI 重置或环境文件修改后重启服务，则全部浏览器需要重新登录。

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

## 设置页一键更新

设置页的「系统更新」检查公开仓库 `joyiok/picoding` 的 main 分支，显示当前构建提交、新提交说明与时间。检查失败会清除可安装的旧结果；安装只接受刚检查过的提交，不接受用户提供的仓库或命令。GitHub 限流或网络失败会显示可重试提示。

网页更新适用于上面的 Linux systemd 部署：服务名称 `picoding.service`、用户 `picoding`、代码入口 `/opt/picoding`，配置保存在 `/etc/picoding.env`，数据保存在代码目录之外，例如 `/var/lib/picoding`。先拉取本功能的代码，运行 `npm ci`、`npm run build`，再从 `/opt/picoding` 执行一次：

```bash
sudo npm run update -- setup
```

安装工具读取 `/etc/picoding.env`，将代码移入 `/opt/picoding-releases` 并建立 `/opt/picoding` 链接，配置专用更新服务和路径监听，加入 `PICODING_UPDATE_DIR=/var/lib/picoding-updates`，然后重启工作台。代码目录若含 `.env` 或 `.picoding`，请先按本文迁移到外部配置和数据目录。工具不会自动迁移或删除用户数据。使用系统级 Node；维护程序单独安装到 root 管理的 `/usr/local/lib/picoding/runner`，不依赖旧发布目录的 node_modules。后续若维护程序协议变更，由管理员重新运行 setup。

登录后打开「模型设置 → 系统更新」，点击「检查更新」，再点击「立即更新」并确认。请先停止执行中的任务、等待已有任务操作完成，并保存未保存的编辑。更新开始后禁止新的任务、模型和资源变更；已有任务环境在切换阶段正常停止，项目卷保留。关闭设置窗口不会取消更新，回来后仍可查看进度。

更新服务先以 `picoding` 用户在独立发布目录下载代码、安装锁定依赖、构建程序及新任务镜像；旧服务在构建期间继续运行。它验证目标提交属于官方 main 且是原版本之后的提交，拒绝本地修改或版本分叉。构建成功才停止服务，使用旧版维护命令完整备份控制数据和项目卷到 `/srv/picoding-backups/<时间-更新ID>`，然后切换代码链接和任务镜像。访问密码哈希、模型密钥和项目数据保留；环境文件保持不变。

服务只有通过启动、访问接口和构建提交检查后才显示完成。登录会话因重启失效，请重新登录后点击「加载新版本」。任务环境可在任务中手动启动。构建失败保留原服务；备份失败重新启动原服务；新程序启动失败恢复旧代码链接及原任务镜像。更新服务被 systemd 中断时，结束处理器根据 root 私有恢复记录尝试启动原程序并标记失败。不会自动覆盖当前数据或项目卷；若新版本涉及数据格式迁移，应按备份恢复步骤由管理员处理。机器断电不执行结束处理器，管理员需启动工作台并检查日志、状态及备份。

查看更新日志：

```bash
sudo journalctl -u picoding-update.service -n 100
sudo systemctl status picoding-update.path picoding-update.service
```

更新请求和状态不包含密码或模型密钥。网页服务不持有 sudo 权限；root 专用服务仅消费固定目录内的提交请求，构建以服务用户执行，完成后的程序由 root 持有。请保留旧发布目录、镜像和完整备份，确认稳定后再由管理员清理。非标准目录、原生 Windows 和未安装更新服务的实例仍可检查版本，界面会提供本文安装链接。自动流程的回归使用明确的维护适配器；目标机器的 systemd、Docker 镜像切换与真实备份仍需部署验收。

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
