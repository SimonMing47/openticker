# OpenTicker

OpenTicker 是一个给 OpenCode 用的终端计划任务管家。它补的是 OpenCode 没有“计划触发层”的空缺：你可以通过一个 geek 风格的 TUI，快速创建循环任务、一次性任务和延时任务，再交给后台 daemon 或系统 service 稳定执行。

## 特性

- 全屏 TUI 控制台，键盘优先
- `cron` / `once` / `delay` 三种任务模型
- 任务创建 preset，降低首次配置门槛
- 本地 detached daemon
- macOS `launchd` / Linux `systemd --user` service 安装
- 调用 `opencode run` 执行任务，兼容 `--attach`
- 日志持久化、导入导出、`doctor` 健康检查

## 为什么做这个项目

OpenCode 已经能很好地完成交互式工作，但很多开发者还需要下面这些能力：

- 每小时自动巡检一次仓库
- 在固定时间执行发布前检查
- 在 30 分钟或 2 小时后自动补跑 follow-up
- 让这些任务在终端关闭后继续执行

OpenTicker 专门解决这些问题。

## 安装

### 前置条件

- Node.js 20.11+
- 已安装并能在 PATH 中运行的 `opencode`

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

### 创建一个一次性任务

```bash
openticker add \
  --name "Release Gate" \
  --type once \
  --at "2026-03-20 09:00" \
  --prompt "Run a release readiness check and summarize blockers."
```

### 创建一个延时任务

```bash
openticker add \
  --name "Follow-up" \
  --type delay \
  --delay "45m" \
  --prompt "Check the workspace again and report what changed."
```

## 配置与日志

- 配置文件：`~/.config/openticker/config.json`
- 日志目录：`~/.local/share/openticker/logs/`
- runtime 状态：`~/.local/share/openticker/runtime/`

## 导入导出

导出：

```bash
openticker export openticker.config.json
```

导入：

```bash
openticker import ./examples/tasks.sample.json
```

## 开发

```bash
npm install
npm test
npm start
```

## 开源文档

- [产品分析与需求拆解](./docs/PRODUCT.md)
- [架构说明](./docs/ARCHITECTURE.md)
- [贡献指南](./CONTRIBUTING.md)

## License

MIT
