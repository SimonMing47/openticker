# OpenTicker 架构说明

## 总览

OpenTicker 使用单进程本地架构，核心分为 5 层：

1. `CLI`
   负责命令解析、TUI 启动、导入导出、daemon/service 管理。
2. `TUI`
   使用 `blessed` 渲染全屏终端界面和任务向导。
3. `Store`
   使用 JSON 文件保存 settings、tasks 和 runtime 状态。
4. `Scheduler/Runner`
   负责计算下一次触发时间，并按 provider 调用 `opencode run`、`codex exec` 或 `claude --print`。
5. `Daemon/Service`
   负责后台轮询和开机自启。

## 数据模型

### settings

- `timezone`
- `defaultProvider`
- `cliCommands.opencode`
- `cliCommands.codex`
- `cliCommands.claude`
- `attachUrl`
- `autoAttach`
- `outputMode`
- `maxConcurrentRuns`

### task

- `id`
- `name`
- `description`
- `type`: `cron | once | delay`
- `schedule`
- `command`
- `enabled`
- `overlapPolicy`
- `createdAt`
- `updatedAt`
- `runtime`

### runtime

- `runCount`
- `lastRunAt`
- `lastExitCode`
- `lastDurationMs`
- `nextRunAt`
- `lastError`
- `lastLogFile`
- `lastOutputPreview`

## 任务调度策略

### cron

使用 `cron-parser` 计算下一个执行时间，并按任务自身时区求值。计算结果会持久化到 `runtime.nextRunAt`，后续加载配置时优先保留该值，避免 daemon 离线后跳过已经到点的任务。

### once

存储绝对时间点，执行后自动禁用。

### delay

在创建时将相对延时转成绝对 `runAt`，执行后自动禁用。

## 执行链路

1. daemon 读取配置。
2. 筛选 `enabled && nextRunAt <= now` 的任务。
3. 按 `maxConcurrentRuns` 限制并发。
4. 为任务创建日志文件。
5. 根据任务的 `command.provider` 选择目标 CLI 并拼装参数。
6. 将 stdout/stderr 追加写入日志。
7. 把执行结果回写到任务的 `runtime`。
8. 如果是 `cron`，计算下一次执行时间；如果是 `once/delay`，自动禁用。

## 后台运行模式

### detached daemon

- 通过 `openticker daemon start` 启动一个脱离当前终端的 Node 进程。
- 使用 PID 文件和状态文件跟踪运行状态。

### service

- macOS：生成 `launchd plist`
- Linux：生成 `systemd --user service`

service 解决的是重启后自动拉起和稳定常驻，daemon 解决的是快速本地启动。

## 日志与配置位置

- 配置：`~/.config/openticker/config.json`
- 日志：`~/.local/share/openticker/logs/`
- runtime：`~/.local/share/openticker/runtime/`

## 设计取舍

- 选 JSON 而不是数据库：更透明、可导出、可手改。
- 选纯 JS 依赖：降低安装门槛。
- 选“provider 适配层”而不是绑定单一 CLI：默认 OpenCode，同时兼容 Codex 和 Claude Code。
- 选 TUI 而不是 Web：安装更轻、符合终端工作流。
- 导入与 `doctor` 统一走配置规范化路径：尽早暴露坏配置，避免 daemon 在运行中才失败。
