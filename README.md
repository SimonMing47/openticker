# OpenTicker

OpenTicker 是一个给 AI CLI 用的终端计划任务管家。它补的是 `opencode`、`codex`、`claude code` 这类工具缺少“计划触发层”的空缺：你可以通过一个 geek 风格的 TUI，快速创建循环任务、一次性任务和延时任务，再交给后台 daemon 或系统 service 稳定执行。

## 特性

- 全屏 TUI 控制台，键盘优先
- `cron` / `once` / `delay` 三种任务模型
- 任务级别选择触发 CLI，默认 `opencode`，也支持 `codex` 和 `claude code`
- 任务创建 preset，降低首次配置门槛
- 本地 detached daemon
- macOS `launchd` / Linux `systemd --user` service 安装
- 按 provider 自动映射到 `opencode run`、`codex exec`、`claude --print`
- 日志持久化、导入导出、`doctor` 健康检查
- 保留任务的下一次触发时间，daemon 重启后不会跳过已到期的 cron 任务
- 导入时自动校验配置结构、任务 ID 唯一性和调度参数

## 为什么做这个项目

AI CLI 已经能很好地完成交互式工作，但很多开发者还需要下面这些能力：

- 每小时自动巡检一次仓库
- 在固定时间执行发布前检查
- 在 30 分钟或 2 小时后自动补跑 follow-up
- 让这些任务在终端关闭后继续执行

OpenTicker 专门解决这些问题。

## 安装

### 前置条件

- Node.js 20.11+
- 已安装并能在 PATH 中运行的任一 CLI：
  - `opencode`
  - `codex`
  - `claude`

### 直接从 GitHub 安装

```bash
npm install -g github:SimonMing47/openticker
```

### 本地开发安装

```bash
npm install
npm start
```

## 快速开始

### 1. 打开 TUI

```bash
openticker
```

或者：

```bash
openticker tui
```

### 2. 创建任务

在 TUI 中使用这些快捷键：

- `a` 新建任务
- `e` 编辑任务
- `space` 启停任务
- `r` 立即运行
- `x` 删除任务
- `d` 启动/停止本地 daemon
- `i` 安装/启动或停止系统 service

### 3. 检查环境

```bash
openticker doctor
```

`doctor` 会同时校验配置文件是否可解析、任务是否有效，以及当前任务真正依赖的 CLI 是否可用。

### 4. 启动后台调度

快速本地启动：

```bash
openticker daemon start
```

查看状态：

```bash
openticker daemon status
```

停止：

```bash
openticker daemon stop
```

### 5. 安装系统 service

安装：

```bash
openticker service install
```

启动：

```bash
openticker service start
```

## CLI 示例

### 创建一个每小时运行的任务

```bash
openticker add \
  --name "Hourly Heartbeat" \
  --type cron \
  --cron "0 * * * *" \
  --prompt "Inspect the workspace, summarize changes, and exit." \
  --attach always
```

### 创建一个使用 Codex 的任务

```bash
openticker add \
  --name "Codex Review" \
  --type cron \
  --cron "30 10 * * 1-5" \
  --provider codex \
  --model o3 \
  --prompt "Review the current repository status and list the top risks."
```

### 创建一个一次性任务

```bash
openticker add \
  --name "Release Gate" \
  --type once \
  --at "2026-03-20 09:00" \
  --prompt "Run a release readiness check and summarize blockers."
```

### 创建一个使用 Claude Code 的延时任务

```bash
openticker add \
  --name "Claude Follow-up" \
  --type delay \
  --delay "45m" \
  --provider claude \
  --model sonnet \
  --prompt "Check the workspace again and report what changed."
```

## 配置与日志

- 配置文件：`~/.config/openticker/config.json`
- 日志目录：`~/.local/share/openticker/logs/`
- runtime 状态：`~/.local/share/openticker/runtime/`

### Provider 配置

默认 provider 是 `opencode`。你也可以在配置里改默认值，或者给每个 provider 指定自定义命令：

```json
{
  "settings": {
    "defaultProvider": "codex",
    "cliCommands": {
      "opencode": "opencode",
      "codex": "npx -y @openai/codex",
      "claude": "npx -y @anthropic-ai/claude-code"
    }
  }
}
```

`cliCommands` 支持完整命令，不要求只能是单个二进制名。

## 导入导出

导出：

```bash
openticker export openticker.config.json
```

导入：

```bash
openticker import ./examples/tasks.sample.json
```

导入会先做结构校验和规范化，再写入正式配置文件。

## 开发

```bash
npm install
npm test
npm start
```

## 开源文档

- [产品分析与需求拆解](./docs/PRODUCT.md)
- [架构说明](./docs/ARCHITECTURE.md)
- [发布说明](./docs/RELEASE.md)
- [贡献指南](./CONTRIBUTING.md)

## License

MIT
