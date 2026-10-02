# PiCoding

以 **pi coding-agent** 为核心的本地 Web 编程工作台。每个任务拥有一个独立 Linux 容器，预装 Chromium、Git、Node.js、Python 和图形桌面。你能看到 agent 的对话、工具调用、文件改动、命令结果，并接管它正在使用的同一个浏览器。

## 启动

需要 Node.js **22.19 或更新版本**、npm 和正在运行的 Docker Engine / Docker Desktop。

```bash
npm ci
npm run sandbox:build
npm run dev
```

打开 **http://127.0.0.1:5173**。后端默认监听 `127.0.0.1:4310`。进入「模型设置」，选择 **OpenAI 格式**或 **Anthropic 格式**，自行填写 API 基础地址、模型 ID 和 API Key。两种格式都支持自定义地址；界面不预置服务商、模型目录或默认模型。

OpenAI 格式使用 Chat Completions 协议，基础地址通常包含 `/v1`；Anthropic 格式使用 Messages 协议，基础地址通常为服务根地址。地址不要包含完整的 `/chat/completions` 或 `/v1/messages` 请求路径，以服务商说明为准。

部署为本机的单进程服务：

```bash
npm run build
npm start
```

此时打开 **http://127.0.0.1:4310**。第一版仅支持本地单用户，不提供登录或多人部署。

## 使用

1. 描述项目，发送任务。后端启动带浏览器的任务电脑，并创建 pi 会话。
2. pi 通过沙盒工具读写 `/workspace` 的文件、执行命令、打开网页、点击、输入、查看截图和页面结构。
3. 在「浏览器」实时观看。在「代码」查看和编辑文件、创建文件、查看 diff；在「终端」查看执行记录或自行运行命令。
4. 点击「接管浏览器」。后端先取消 agent 和命令，等待当前浏览器操作完成，再开放人工操作。点击「归还浏览器」后可发送新的指令。
5. 点击右上角下载按钮，导出项目 `tar.gz`。停止任务环境会保留项目文件和对话；点击「启动环境」可继续。删除任务会删除任务的项目数据卷。

切换浏览器、代码和终端会保留未保存的草稿；切换任务前会提醒。若 pi 或终端修改了正在编辑的文件，工作台会显示版本冲突，保留草稿并让你对比和合并。新建文件不会覆盖已有文件。初次启动失败时，原始任务会保留，重试启动后继续执行。

Docker 未就绪时，工作台每 10 秒重新检查一次。也可点击底部的环境状态手动检查，构建完成后无需刷新页面。

在任务电脑启动网页服务后，浏览器打开 **`http://localhost:端口`**；这是容器内的 localhost。服务应在后台运行，例如：

```bash
nohup npm run dev -- --host 0.0.0.0 > /tmp/app.log 2>&1 &
```

## 实现

```text
Web 工作台 (React + TypeScript)
   │ REST + SSE + WebSocket
Node.js 控制服务
   ├── pi SDK：模型、会话、工具循环、上下文压缩
   ├── 本机任务历史和模型设置
   └── 每个任务一个 Docker 环境
        ├── /workspace 持久化项目数据卷
        ├── 文件和 Bash HTTP 工具
        ├── Chromium + Playwright
        └── Xvfb + Openbox + x11vnc + noVNC
```

pi 在控制服务中运行，全部操作工具通过内部 HTTP 请求进入任务环境。pi 的宿主机内置读写/执行工具被替换；未加载项目扩展或宿主机的上下文文件。模型 API Key 保存在本机 `.picoding/settings.json`（权限 `0600`），不作为环境变量传入任务容器。

容器采用非 root 用户、只读根文件系统、清空 capabilities、禁止提权、进程数和 CPU/内存限额。工作目录是每个任务独立的 Docker volume，没有挂载宿主机目录或 Docker socket。远程桌面经控制服务代理，工作容器 HTTP 接口使用随机凭证，端口只绑定宿主机 loopback。Docker 容器共享宿主机内核，第一版的隔离面向本地单用户；虚拟机级隔离属于后续运行时替换。

## 配置

可复制 `.env.example` 为 `.env`。所有配置可选，默认适合本地使用。

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `PICODING_PORT` | `4310` | 控制服务端口，Vite 自动同步代理目标 |
| `PICODING_DATA_DIR` | `.picoding` | 任务记录、pi 会话和模型设置 |
| `PICODING_SANDBOX_IMAGE` | `picoding-sandbox:local` | 沙盒镜像 |
| `PICODING_MAX_TASKS` | `3` | 同时运行的任务环境数量 |
| `PICODING_SANDBOX_MEMORY` | `2g` | 单个任务的内存限额 |
 | `PICODING_SANDBOX_CPUS` | `2` | 单个任务的 CPU 限额 |

| 模型配置 | 用途 |
| --- | --- |
| `PICODING_API_PROTOCOL` | `openai` 或 `anthropic`，仅指定 API 格式 |
| `PICODING_API_BASE_URL` | 用户自己的 API 基础地址 |
| `PICODING_MODEL` | 用户填写的模型 ID |

也可通过后端进程的 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 提供所选格式的凭证。Web 设置保存的配置优先。更换 API 地址或格式后需填写相应密钥。

在「模型设置」中填写模型能力，数值可编辑，请按所用模型的说明调整；两种 API 格式都使用这些设置，地址、模型 ID 和密钥仍由你提供。

| 能力参数 | 新配置初始值 | 用途 |
| --- | --- | --- |
| 上下文 Token 数（`contextWindow`） | `128000` | 传给 pi 模型，并据此调整上下文压缩预算 |
| 最大输出 Token 数（`maxTokens`） | `16384` | 每次模型回复的输出上限，进入所选协议的 API 请求 |
| 支持图片输入（`supportsImages`） | 关闭 | 勾选后允许把浏览器截图传给支持图片的模型；关闭时使用网页结构和文本，不向模型发送截图 |

两个 Token 数都必须是正整数，最大输出不能超过上下文容量。pi SDK 还可能根据剩余上下文空间进一步降低请求的输出上限。初始数值是可编辑的起点，界面不套用模型预设。

关闭「支持图片输入」时，本次浏览器截图和旧对话中的历史图片都会过滤，网页文本和历史文字仍会提供给模型。

能力设置随其他模型配置保存在本机，后端重启后恢复。旧配置缺少的上下文、输出字段分别回填 `128000` / `16384`；缺少图片字段时，已有模型 ID 的配置保留以前图片支持开启的行为，没有模型 ID 的配置图片默认关闭。

## 检查

```bash
npm run check
npm test
npm run build
npm run doctor
```

本轮 **22 项测试全部通过**，生产构建通过。测试涵盖路径和符号链接边界、歧义编辑、二进制/大文件限制、命令取消、密钥隐藏、跨站与 Host 访问控制、任务恢复、启动失败后重试、文件版本冲突和重复创建、浏览器前台标签选择，以及实际 HTTP 路由和 pi 工具执行循环；新增能力参数的持久化、旧设置迁移和非法值拒绝均已覆盖。

真实 pi SDK 已通过**本地模拟 HTTP SSE 服务**验证 OpenAI Chat Completions 和 Anthropic Messages，分别使用配置中的 API 地址、自定义模型 ID 和凭证，未使用预设模型列表；测试覆盖 API 请求的输出上限、工具执行循环中的图片开关，以及关闭图片后两种协议保留历史文字、排除已记录历史截图的行为。外部真实模型服务尚未联调。

此前运行验证中，Docker 镜像 `picoding-sandbox:local` 构建成功（ID `c37574e1eebc`）。真实沙盒以 uid 1000 完成 Node.js、Python、Git 命令及文件读写；重启环境后，浏览器正常启动且项目文件保留。Chromium 导航和自动点击成功。noVNC 的 1280×800 canvas 已连接，并通过真实远程键盘输入含 `?manual=2` 的地址完成导航；`pageErrors=[]`，必需桌面资源零失败。UI 归还浏览器后状态为 `ready`。导出的 `tar.gz` 包含项目文件，不包含 `.git` 和 `.picoding`。

本轮能力设置的[桌面截图（1440×1000）](.impeccable/review/capabilities-desktop.png)、[手机截图（390×844）](.impeccable/review/capabilities-mobile.png)和[手机底部截图](.impeccable/review/capabilities-mobile-bottom.png)已完成限定范围复核，结论为 **ship**；无横向溢出，操作页脚可见。真实浏览器中的表单提交测试拦截了 POST，没有更改实际用户配置或保存测试 API Key。工作台仍在 `http://localhost:5173` 后台运行。

## 后续范围

这是第一版本地工作台。暂未包含 Git 仓库导入、文件上传、任务快照/分支、TTY 交互终端、多用户账户或云端调度。终端当前执行独立 Bash 命令并显示输出；浏览器人工接管提供真正的图形交互。
