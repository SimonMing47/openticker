# Release Guide

## GitHub

如果本机已经完成 `gh auth login`，可以直接执行：

```bash
gh repo create SimonMing47/openticker --public --source=. --remote=origin --push
```

如果远端仓库已经先在网页端创建好了，则执行：

```bash
git push -u origin main
```

## npm

如果后续要发布到 npm：

```bash
npm login
npm publish --access public
```

发布前建议先检查：

```bash
npm test
npm pack --dry-run
```

## 推荐发布顺序

1. 先创建 GitHub public 仓库并推送。
2. 再确认 README 中的安装命令和仓库地址一致。
3. 最后再选择是否发布到 npm registry。
