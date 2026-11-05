// @lwfjyjy/dsh-session-ignore-claude-md
//
// 目的：不改内置 dsh-agent-instructions 的任何代码，只把它的行为从
//   “同目录里凡存在的候选文件全部注入（AGENTS.md + CLAUDE.md 都读）”
// 改成
//   “按顺序取第一个存在的（AGENTS.md 优先，没有才读 CLAUDE.md）”，避免重复注入、节省上下文。
//
// 原理：
//   内置插件（包括各对话模式里那份）读取规则文件时，统一走同一个共享的 `fs` 服务：
//   `resolve(path)` 找目标 -> `stat(target)` 判类型 -> `streamText` 读内容。
//   本插件在启动时给这个服务的 `resolve()` 包一层：当被解析的是候选组里“靠后的名字”
//   （如 CLAUDE.md），且同目录确实存在更靠前的候选（如 AGENTS.md）时，就抛“文件不存在”。
//   内置逻辑会把它当作 absent 跳过，于是不再读取、也不会注入。
//
// 为什么是篡改共享服务、而不是套一层 ctx：
//   预设（标准/PTC/Cordis…）里的 agent-instructions 实例拿的是同一个 fs 服务对象，
//   只有改动对象本身，才能一次对所有实例生效。

import { basename, dirname, join } from 'node:path'

export const name = 'session-ignore-claude-md'
// 等 fs 服务就绪后再执行 apply，保证拿到的是可用服务
export const inject = ['fs']

const DEFAULT_CANDIDATES = ['AGENTS.md', 'CLAUDE.md']
const DEFAULT_LOCAL_CANDIDATES = ['AGENTS.local.md', 'CLAUDE.local.md']
const RESERVED = new Set(['', '.', '..'])
// 标记：避免热重载时对同一个 fs 服务重复包装
const MARK = Symbol.for('lwfjyjy.dsh-session-ignore-claude-md')

// 与内置插件一致的候选清洗：剔除空值、含路径分隔符的项
const sanitize = (list) => (list ?? []).filter((name) => !RESERVED.has(name) && !/[\\/]/.test(name))

export function apply(ctx, config = {}) {
  // 用 effect 管理包装生命周期：插件卸载/热重载时自动还原 fs.resolve
  ctx.effect(() => {
    const fs = ctx.get('fs')
    if (!fs || typeof fs.resolve !== 'function' || fs[MARK]) return

    // 候选组：组内靠前优先；只有 2 个及以上候选才存在“隐藏靠后者”的意义
    const groups = [
      sanitize(config.instructionFileCandidates ?? DEFAULT_CANDIDATES),
      sanitize(config.localInstructionFileCandidates ?? DEFAULT_LOCAL_CANDIDATES),
    ].filter((group) => group.length > 1)
    if (groups.length === 0) return

    // 只为“靠后的候选名”做判断，其它文件名直接放行，几乎零开销
    const laterNames = new Set(groups.flatMap((group) => group.slice(1)))
    const originalResolve = fs.resolve

    // 用真实 resolve/stat 判断目录下是否存在某个候选文件（不经过被包装后的 resolve）
    const existsInDir = async (dir, fileName, options) => {
      try {
        const target = await originalResolve.call(fs, join(dir, fileName), options)
        const info = await fs.stat(target, options)
        return info?.type === 'file'
      } catch {
        return false
      }
    }

    // 是否应“假装不存在”：属于靠后候选，且同目录存在更靠前的候选
    const shouldHide = async (path, options) => {
      if (typeof path !== 'string' || !laterNames.has(basename(path))) return false
      const file = basename(path)
      const group = groups.find((candidates) => candidates.includes(file))
      const index = group ? group.indexOf(file) : 0
      for (let i = 0; i < index; i += 1) {
        if (await existsInDir(dirname(path), group[i], options)) return true
      }
      return false
    }

    fs.resolve = async (path, options) => {
      if (await shouldHide(path, options)) {
        const error = new Error(`ENOENT: no such file or directory, stat '${path}'`)
        error.code = 'FS_NOT_FOUND'
        throw error
      }
      return originalResolve.call(fs, path, options)
    }
    fs[MARK] = true

    return () => {
      fs.resolve = originalResolve
      delete fs[MARK]
    }
  }, 'session-ignore-claude-md: hide later instruction files')
}
