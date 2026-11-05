# 让项目规则文件按 AGENTS.md -> CLAUDE.md 顺序生效（忽略重复的 CLAUDE.md）

内置 `dsh-agent-instructions` 会在同一目录里，把凡是存在的候选文件（默认 `AGENTS.md`、`CLAUDE.md`）**全部**注入上下文；
当项目里两者并存且内容不同时，就会重复注入、浪费上下文。

本插件不改内置代码，只做一件事：**给共享的 `fs` 服务的 `resolve()` 包一层**。

- 内置插件（包括各模式里那份）读取规则文件时都走同一个 `fs` 服务：`resolve(path)` + `stat(target)`；
- 本插件在启动时改装这个服务的 `resolve`：若被解析的是候选组里“靠后的名字”（如 `CLAUDE.md`），
  且同目录确实存在更靠前的候选（如 `AGENTS.md`），就抛 `code='FS_NOT_FOUND'`，内置逻辑便视其为“不存在”而跳过；
- `AGENTS.local.md` / `CLAUDE.local.md` 同理；
- 用户全局规则（`~/.dsh/AGENTS.md`、`~/.agents/AGENTS.md`）行为不变。

效果（带回退）：
- 同时存在 `AGENTS.md` 与 `CLAUDE.md` → 只取 `AGENTS.md`；
- 只有 `CLAUDE.md` → 取 `CLAUDE.md`。

因为逻辑在代码里、作用的又是共享服务，所以补丁只需插入本插件一行，无需为每个模式写一大段配置。
