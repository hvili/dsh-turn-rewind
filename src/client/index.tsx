import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  Modal,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'

interface ConversationNodeLike {
  readonly kind: string
  readonly seq: number
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
}

interface ConversationChatNodeLike {
  readonly key: string
  readonly kind: string
  readonly data: ConversationNodeLike
}

interface ConversationSnapshotLike {
  readonly nodes: readonly ConversationNodeLike[]
  readonly chat?: {
    readonly nodes: {
      values(): readonly ConversationChatNodeLike[]
    }
  }
}

type RewindNodeLike = ConversationNodeLike | ConversationChatNodeLike

interface RewindMatch {
  readonly messageSeq: number
  readonly promptText: string
}

interface RewindMessageActionProps {
  readonly matched: RewindMatch
  readonly sessionId: string
  readonly openRestoredSession: (sessionId: string, promptText: string) => Promise<void>
}

interface RewindPortalBridgeProps {
  readonly sessionId: string
  readonly openRestoredSession: (sessionId: string, promptText: string) => Promise<void>
  readonly useSession: <T>(selector: (snapshot: ConversationSnapshotLike) => T) => T
}

interface RewindPortalTarget {
  readonly container: HTMLElement
  readonly matched: RewindMatch
}

interface SlotsLike {
  inject(name: string, install: () => unknown): void
  register(
    entry: {
      readonly name: string
      readonly id: string
      readonly order: number
      readonly inject: () => {
        readonly openRestoredSession: (sessionId: string, promptText: string) => Promise<void>
      }
    },
    component: (props: RewindPortalBridgeProps) => ReactNode,
  ): () => void
}

interface ClientContextLike {
  readonly slots: SlotsLike
  readonly sessions: {
    open(sessionId: string): void
    scope(sessionId: string): unknown | undefined
  }
  readonly conversation: {
    readonly input: {
      for(scope: unknown): { setDraft(text: string): void }
    }
  }
  effect(setup: () => (() => void), label?: string): unknown
}

type RewindMode = 'both' | 'code'
type ChangeKind = 'added' | 'deleted' | 'modified' | 'mode-changed' | 'type-changed'

interface ReadyPreview {
  readonly status: 'ready'
  readonly sessionId: string
  readonly messageSeq: number
  readonly turn: number
  readonly checkpointId: string
  readonly turnStartSeq: number
  readonly totalChanges: number
  readonly changes: readonly { readonly path: string; readonly kind: ChangeKind }[]
  readonly offset: number
  readonly truncated: boolean
  readonly headChanged: boolean
  readonly operationChanged: boolean
  readonly checkpointHead?: string
  readonly checkpointBranch?: string
  readonly checkpointOperation?: string
  readonly currentHead?: string
  readonly currentBranch?: string
  readonly currentOperation?: string
  readonly activeSessionIds: readonly string[]
  readonly restoreBlocked: boolean
  readonly planId?: string
  readonly confirmation?: string
}

type Preview = ReadyPreview
  | { readonly status: 'pending' }
  | { readonly status: 'missing' }
  | { readonly status: 'failed'; readonly error: string }

type Locale = 'zh' | 'en'

/** User-visible copy keys for the Turn Rewind client surface. */
type CopyKey =
  | 'edit.tooltip'
  | 'edit.aria'
  | 'edit.openErrorPrefix'
  | 'edit.serverMismatch'
  | 'rewind.tooltip'
  | 'rewind.aria'
  | 'rewind.title'
  | 'rewind.close'
  | 'rewind.description'
  | 'rewind.cancel'
  | 'rewind.applying'
  | 'rewind.done'
  | 'rewind.actionBoth'
  | 'rewind.actionCode'
  | 'rewind.loading'
  | 'rewind.pending'
  | 'rewind.missing'
  | 'rewind.failed'
  | 'rewind.optionBothTitle'
  | 'rewind.optionBothDesc'
  | 'rewind.optionCodeTitle'
  | 'rewind.optionCodeDesc'
  | 'rewind.summaryFiles'
  | 'rewind.summaryBoth'
  | 'rewind.summaryCode'
  | 'rewind.blockedShared'
  | 'rewind.warnBranchChanged'
  | 'rewind.warnHeadChanged'
  | 'rewind.warnDrift'
  | 'rewind.planMissing'
  | 'rewind.stale'
  | 'rewind.noChanges'
  | 'rewind.viewAll'
  | 'rewind.loadingDetails'
  | 'rewind.backupNote'
  | 'rewind.retry'
  | 'rewind.completedCode'
  | 'rewind.completedBoth'
  | 'rewind.openFailed'
  | 'file.added'
  | 'file.deleted'
  | 'file.modified'
  | 'file.modeChanged'
  | 'file.typeChanged'
  | 'error.planStale'
  | 'error.planStaleRepo'
  | 'error.workspaceInUse'
  | 'error.workspaceLocked'
  | 'error.headChanged'
  | 'error.repositoryChanged'
  | 'error.gitOperationChanged'
  | 'error.restorePointNotFound'
  | 'error.noChanges'
  | 'error.restoreFailedRolledBack'
  | 'error.conversationRewindFailed'
  | 'error.invalidResponse'
  | 'error.requestFailed'
  | 'error.unknownStatus'
  | 'error.missingChanges'
  | 'error.missingActiveSessions'
  | 'error.newSessionNotReady'
  | 'error.invalidObject'
  | 'error.invalidValue'

const COPY: Record<Locale, Record<CopyKey, string>> = {
  zh: {
    'edit.tooltip': '编辑这条消息',
    'edit.aria': '编辑这条消息',
    'edit.openErrorPrefix': '无法打开可编辑的对话：',
    'edit.serverMismatch': '服务器返回了不匹配的编辑操作',
    'rewind.tooltip': '恢复到发送这条消息之前',
    'rewind.aria': '恢复到发送这条消息之前',
    'rewind.title': '恢复到发送这条消息之前',
    'rewind.close': '关闭',
    'rewind.description': '查看恢复的文件，选择适合你的回退方式。当前会话不受影响。',
    'rewind.cancel': '取消',
    'rewind.applying': '正在恢复…',
    'rewind.done': '已完成',
    'rewind.actionBoth': '恢复并从这里继续',
    'rewind.actionCode': '恢复文件',
    'rewind.loading': '正在检查可以恢复的项目文件…',
    'rewind.pending': '这条消息发送前的文件还在保存，请稍后再试。',
    'rewind.missing': '没有保存这条消息发送前的文件。可能是当时还没启用回退功能，或记录已超过保留期限。',
    'rewind.failed': '没能保存这条消息发送前的文件：',
    'rewind.optionBothTitle': '恢复文件并从这里继续',
    'rewind.optionBothDesc': '创建一个从这里开始的新会话（当前对话会保留）',
    'rewind.optionCodeTitle': '只恢复文件',
    'rewind.optionCodeDesc': '恢复这条消息发送前的文件，当前对话保持不变。',
    'rewind.summaryFiles': '将恢复 {count} 个文件',
    'rewind.summaryBoth': '恢复后在新对话里继续',
    'rewind.summaryCode': '当前对话保持不变',
    'rewind.blockedShared': '这个项目目录还有别的对话正在运行。恢复文件会影响到它们，因此本次操作已被阻止。请等那些对话结束或停止后，再重新检查。',
    'rewind.warnBranchChanged': '当前所在的 Git 分支和发送这条消息时不同。恢复不会切换分支，只会把当时的文件内容恢复到当前分支。',
    'rewind.warnHeadChanged': '这条消息之后有了新的 Git 提交。恢复只会改文件，不会撤销提交；完成后这些文件会显示为未提交修改。',
    'rewind.warnDrift': 'Git 正在进行合并、变基或类似操作。请先完成或取消这次 Git 操作，再重新检查。',
    'rewind.planMissing': '恢复信息已经失效，请重新检查。',
    'rewind.stale': '项目文件在检查后又发生了变化。为避免覆盖新修改，这次恢复已失效，请重新检查。',
    'rewind.noChanges': '项目文件已经是这条消息发送前的状态，无需恢复。想重新开始时，可以使用“分支新对话”。',
    'rewind.viewAll': '查看全部 {count} 个文件',
    'rewind.loadingDetails': '正在读取全部文件…',
    'rewind.backupNote': '恢复前会自动备份当前文件；若恢复失败会自动还原，项目不会停留在只恢复了一部分的状态。',
    'rewind.retry': '重新检查',
    'rewind.completedCode': '项目文件已恢复；当前对话保持不变。恢复前的文件已自动备份。',
    'rewind.completedBoth': '项目文件已恢复，并已创建新对话。恢复前的文件已自动备份。',
    'rewind.openFailed': '文件已经恢复，新对话也已创建，但没能自动打开：',
    'file.added': '移除后来新增的文件',
    'file.deleted': '找回文件',
    'file.modified': '恢复之前的版本',
    'file.modeChanged': '恢复文件权限',
    'file.typeChanged': '恢复之前的文件类型',
    'error.planStale': '项目文件在检查后又发生了变化。为避免覆盖新修改，请重新检查后再恢复。',
    'error.planStaleRepo': 'Git 状态在检查后又发生了变化，恢复已失效。请重新检查后再试。',
    'error.workspaceInUse': '这个项目目录还有别的对话正在运行。请等那些对话结束或停止后，再重新检查。',
    'error.workspaceLocked': '另一个恢复操作正在处理这个项目目录。请等待它完成后重新检查。',
    'error.headChanged': '项目的提交或分支已发生变化。为避免覆盖新改动，请重新检查后再恢复。',
    'error.repositoryChanged': '这个项目目录已不属于原来的 Git 工作区，无法恢复。',
    'error.gitOperationChanged': 'Git 正在执行其他操作。请先完成或取消该操作，再重新检查。',
    'error.restorePointNotFound': '没有找到对应的文件状态，可能已被清理。',
    'error.noChanges': '项目文件已经是这条消息发送前的状态，无需恢复。想重新开始时，可以使用“分支新对话”。',
    'error.restoreFailedRolledBack': '恢复未能完成，项目文件已自动还原到操作前的状态。',
    'error.conversationRewindFailed': '文件已恢复，但无法创建新对话；项目文件已自动还原。',
    'error.invalidResponse': '回退服务返回了无法识别的响应。',
    'error.requestFailed': '请求失败：{status}',
    'error.unknownStatus': '未知回退状态：{status}',
    'error.missingChanges': '回退预览缺少 changes',
    'error.missingActiveSessions': '回退预览缺少 activeSessionIds',
    'error.newSessionNotReady': '新对话还没有准备好',
    'error.invalidObject': '服务器返回了无效对象',
    'error.invalidValue': '{name} 无效',
  },
  en: {
    'edit.tooltip': 'Edit this message',
    'edit.aria': 'Edit this message',
    'edit.openErrorPrefix': 'Could not open the editable conversation: ',
    'edit.serverMismatch': 'The server returned a mismatched edit operation',
    'rewind.tooltip': 'Return to before sending this message',
    'rewind.aria': 'Return to before sending this message',
    'rewind.title': 'Return to before sending this message',
    'rewind.close': 'Close',
    'rewind.description': 'Review the files to restore and choose how to rewind. The current conversation is not affected.',
    'rewind.cancel': 'Cancel',
    'rewind.applying': 'Restoring…',
    'rewind.done': 'Done',
    'rewind.actionBoth': 'Restore files and continue here',
    'rewind.actionCode': 'Restore files only',
    'rewind.loading': 'Checking which project files can be restored…',
    'rewind.pending': 'The files from before this message are still being saved. Try again shortly.',
    'rewind.missing': 'No file state was saved before this message. Rewind may not have been enabled then, or the record exceeded its retention limit.',
    'rewind.failed': 'The file state before this message could not be saved: ',
    'rewind.optionBothTitle': 'Restore files and continue here',
    'rewind.optionBothDesc': 'Creates a new conversation starting here; the current conversation is kept.',
    'rewind.optionCodeTitle': 'Restore files only',
    'rewind.optionCodeDesc': 'Restores the files from before this message; the current conversation stays unchanged.',
    'rewind.summaryFiles': 'Will restore {count} file(s)',
    'rewind.summaryBoth': 'Continue in a new conversation after restoring',
    'rewind.summaryCode': 'The current conversation stays unchanged',
    'rewind.blockedShared': 'Another conversation is actively using this project directory. Restoring files would affect it, so this operation is blocked. Wait for those conversations to finish or stop, then check again.',
    'rewind.warnBranchChanged': 'The current Git branch differs from the one active when this message was sent. Restoring does not switch branches; it restores the file contents from that time onto the current branch.',
    'rewind.warnHeadChanged': 'New Git commits exist after this message. Restoring only changes files and does not undo commits; after it finishes these files appear as uncommitted changes.',
    'rewind.warnDrift': 'Git is currently merging, rebasing, or running a similar operation. Finish or cancel it, then check again.',
    'rewind.planMissing': 'The restore information is no longer valid. Check again.',
    'rewind.stale': 'Project files changed after the check. To avoid overwriting newer edits, this restore is no longer valid. Check again.',
    'rewind.noChanges': 'Project files already match the state before this message, so there is nothing to restore. To start over, use “Branch into a new conversation”.',
    'rewind.viewAll': 'View all {count} files',
    'rewind.loadingDetails': 'Reading all files…',
    'rewind.backupNote': 'Current files are backed up automatically before restoring; if a restore fails, files are rolled back automatically so the project is never left partially restored.',
    'rewind.retry': 'Check again',
    'rewind.completedCode': 'Project files restored; the current conversation stays unchanged. The pre-restore files were backed up automatically.',
    'rewind.completedBoth': 'Project files restored and a new conversation was created. The pre-restore files were backed up automatically.',
    'rewind.openFailed': 'Files were restored and the new conversation was created, but it could not be opened automatically: ',
    'file.added': 'Remove a file added later',
    'file.deleted': 'Restore a deleted file',
    'file.modified': 'Restore the previous version',
    'file.modeChanged': 'Restore file permissions',
    'file.typeChanged': 'Restore the previous file type',
    'error.planStale': 'Project files changed after the check. To avoid overwriting newer edits, check again before restoring.',
    'error.planStaleRepo': 'Git state changed after the check and the restore is no longer valid. Check again and retry.',
    'error.workspaceInUse': 'Another conversation is actively using this project directory. Wait for those conversations to finish or stop, then check again.',
    'error.workspaceLocked': 'Another restore operation is handling this project directory. Wait for it to finish, then check again.',
    'error.headChanged': 'The project commits or branch changed. To avoid overwriting newer edits, check again before restoring.',
    'error.repositoryChanged': 'This project directory no longer belongs to the original Git worktree and cannot be restored.',
    'error.gitOperationChanged': 'Git is running another operation. Finish or cancel it, then check again.',
    'error.restorePointNotFound': 'The matching file state was not found; it may have been cleaned up.',
    'error.noChanges': 'Project files already match the state before this message, so there is nothing to restore. To start over, use “Branch into a new conversation”.',
    'error.restoreFailedRolledBack': 'The restore could not be completed; project files were automatically restored to their pre-operation state.',
    'error.conversationRewindFailed': 'Files were restored, but the new conversation could not be created; project files were automatically restored.',
    'error.invalidResponse': 'The rewind service returned an unrecognized response.',
    'error.requestFailed': 'Request failed: {status}',
    'error.unknownStatus': 'Unknown rewind status: {status}',
    'error.missingChanges': 'The rewind preview is missing changes',
    'error.missingActiveSessions': 'The rewind preview is missing activeSessionIds',
    'error.newSessionNotReady': 'The new conversation is not ready yet',
    'error.invalidObject': 'The server returned an invalid object',
    'error.invalidValue': '{name} is invalid',
  },
}

function currentLocale(): Locale {
  if (typeof document !== 'undefined' && document.documentElement?.lang !== undefined) {
    const lang = document.documentElement.lang.toLowerCase()
    if (lang.startsWith('zh')) return 'zh'
    if (lang.startsWith('en')) return 'en'
  }
  return 'zh'
}

function formatCopy(template: string, values?: Record<string, string | number>): string {
  if (values === undefined) return template
  let result = template
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{${key}}`).join(String(value))
  }
  return result
}

function translate(lang: Locale, key: CopyKey, values?: Record<string, string | number>): string {
  return formatCopy(COPY[lang][key] ?? COPY.zh[key] ?? key, values)
}

/**
 * React binding for the locale that the DSH locale plugin publishes on
 * `<html lang>`. Kept self-contained because this bundle is loaded through the
 * module table and does not declare a dependency on the client locale plugin.
 * @returns the current locale and a translation helper.
 */
function useLocale(): { readonly lang: Locale; readonly t: (key: CopyKey, values?: Record<string, string | number>) => string } {
  const [lang, setLang] = useState<Locale>(currentLocale)
  useEffect(() => {
    const element = document.documentElement
    const update = (): void => setLang(currentLocale())
    const observer = new MutationObserver(update)
    observer.observe(element, { attributes: true, attributeFilter: ['lang'] })
    update()
    return () => { observer.disconnect() }
  }, [])
  const t = useCallback((key: CopyKey, values?: Record<string, string | number>) => translate(lang, key, values), [lang])
  return { lang, t }
}

const PATH = '/turn-rewind'
const STYLE_ID = '@deepseek-ai/dsh-turn-rewind'
const styles = `
.dcl-rewind-tail{display:inline-flex;align-items:center;align-self:center;order:0;height:24px;margin-left:2px}
.dcl-rewind-trigger{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dcl-rewind-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dcl-rewind-dialog{box-sizing:border-box;width:min(560px,100%);max-height:calc(100dvh - 48px)}
.dcl-rewind-content{min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.dcl-rewind-body{display:flex;flex-direction:column;gap:14px;width:100%;min-width:0;max-width:100%;box-sizing:border-box}
.dcl-rewind-options{display:flex;flex-direction:column;gap:8px;min-width:0;max-width:100%}
.dcl-rewind-option{display:flex;align-items:flex-start;gap:10px;width:100%;min-width:0;box-sizing:border-box;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.dcl-rewind-option[data-selected="true"]{border-color:var(--dsw-alias-state-business-primary)}
.dcl-rewind-option[data-disabled="true"]{cursor:not-allowed;opacity:.52}
.dcl-rewind-option input{flex:none;margin:2px 0 0}
.dcl-rewind-option-content{display:block;flex:1;min-width:0}
.dcl-rewind-option strong{display:block;color:var(--dsw-alias-label-primary);font-size:14px}
.dcl-rewind-option-description{display:block;margin-top:3px;overflow-wrap:anywhere;word-break:break-word;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dcl-rewind-summary{display:flex;flex-wrap:wrap;column-gap:16px;row-gap:4px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:13px}
.dcl-rewind-files{min-width:0;max-width:100%;box-sizing:border-box;max-height:220px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.dcl-rewind-file{display:flex;justify-content:space-between;gap:16px;min-width:0;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}
.dcl-rewind-file:last-child{border-bottom:0}.dcl-rewind-file code{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
.dcl-rewind-kind{flex:none;color:var(--dsw-alias-label-tertiary)}
.dcl-rewind-file-actions{display:flex;justify-content:flex-start}
.dcl-rewind-status{margin:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dcl-rewind-warning,.dcl-rewind-error{box-sizing:border-box;max-width:100%;margin:0;padding:10px 12px;overflow-wrap:anywhere;word-break:break-word;border-radius:10px;font-size:12px;line-height:18px}
.dcl-rewind-warning{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary)}
.dcl-rewind-error{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);color:var(--dsw-alias-state-error-primary)}
.dcl-rewind-backup{box-sizing:border-box;margin:0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dcl-rewind-retry{align-self:flex-start}
`

/** Return the rewind anchor and editable text owned by one direct user message. */
export function selectRewindMessage(node: ConversationNodeLike): RewindMatch | null {
  if (node.kind !== 'user' || !Number.isSafeInteger(node.seq) || node.seq < 0) return null
  const promptText = (node.content ?? [])
    .filter((block): block is { readonly type: string; readonly text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
  return { messageSeq: node.seq, promptText }
}

/** Browser plugin entry: bridge every direct user-message action row to the rewind UI. */
export const inject = ['slots', 'sessions', 'conversation']
export function apply(ctx: ClientContextLike): void {
  ctx.effect(() => {
    if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.plugin = '@deepseek-ai/dsh-turn-rewind'
    tag.dataset.pluginCss = STYLE_ID
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'turn-rewind: styles')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'turn-rewind-portals',
    order: 100,
    inject: () => ({
      openRestoredSession: async (sessionId: string, promptText: string) => {
        await openSessionWithDraft(ctx, sessionId, promptText, currentLocale())
      },
    }),
  }, RewindMessagePortals))
}

/** Session-scoped bridge that portals rewind controls into direct user-message action rows. */
export function RewindMessagePortals({ sessionId, openRestoredSession, useSession }: RewindPortalBridgeProps): ReactNode {
  const nodes = useSession<readonly RewindNodeLike[]>(snapshot => snapshot.chat?.nodes.values() ?? snapshot.nodes)
  const [targets, setTargets] = useState<readonly RewindPortalTarget[]>([])

  useLayoutEffect(() => {
    let active = true
    let queued = false
    const refresh = (): void => {
      if (!active) return
      const next = collectPortalTargets(nodes)
      setTargets(current => samePortalTargets(current, next) ? current : next)
    }
    const queueRefresh = (): void => {
      if (queued || !active) return
      queued = true
      queueMicrotask(() => {
        queued = false
        refresh()
      })
    }
    refresh()
    const observer = new MutationObserver(queueRefresh)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      active = false
      observer.disconnect()
    }
  }, [nodes])

  if (targets.length === 0) return null
  return (
    <>
      {targets.map(target => createPortal(
        <>
          <EditMessageAction matched={target.matched} sessionId={sessionId} openRestoredSession={openRestoredSession} />
          <RewindMessageAction matched={target.matched} sessionId={sessionId} openRestoredSession={openRestoredSession} />
        </>,
        target.container,
        `${sessionId}:${String(target.matched.messageSeq)}`,
      ))}
    </>
  )
}

/** Edit a direct user message by branching before it and pre-filling the new composer. */
export function EditMessageAction({ matched, sessionId, openRestoredSession }: RewindMessageActionProps): ReactNode {
  const { t } = useLocale()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const edit = async (): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(PATH, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'edit', sessionId, messageSeq: matched.messageSeq }),
      })
      const result = recordOf(await responseJson(response))
      if (requiredString(result.action, 'action') !== 'edit') throw new RewindRequestError('INVALID_RESPONSE', t('edit.serverMismatch'))
      await openRestoredSession(requiredString(result.sessionId, 'sessionId'), matched.promptText)
    } catch (caught) {
      setError(`${t('edit.openErrorPrefix')}${messageOf(caught)}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="dcl-rewind-tail">
      <Tooltip label={t('edit.tooltip')} side="bottom">
        <button type="button" className="dcl-rewind-trigger" onClick={() => { void edit() }} disabled={pending} aria-label={t('edit.aria')}>
          <PencilIcon size={16} />
        </button>
      </Tooltip>
      {error !== null && <span className="dcl-rewind-error" role="alert">{error}</span>}
    </div>
  )
}

/** User-message action and its review-first file/conversation restore dialog. */
export function RewindMessageAction({ matched, sessionId, openRestoredSession }: RewindMessageActionProps): ReactNode {
  const { lang, t } = useLocale()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mode, setMode] = useState<RewindMode>('both')
  const [applying, setApplying] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState<string | null>(null)
  const loadAbort = useRef<AbortController | null>(null)
  const applyPending = useRef(false)

  useEffect(() => () => {
    loadAbort.current?.abort()
    loadAbort.current = null
  }, [])

  const load = useCallback(async () => {
    loadAbort.current?.abort()
    const controller = new AbortController()
    loadAbort.current = controller
    setLoading(true)
    setStale(false)
    setError(null)
    setCompleted(null)
    try {
      const response = await fetch(`${PATH}?sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}`, {
        method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal,
      })
      const value = await responseJson(response)
      if (loadAbort.current === controller) setPreview(decodePreview(value))
    } catch (caught) {
      if (!controller.signal.aborted) setError(friendlyError(caught, lang))
    } finally {
      if (loadAbort.current === controller) {
        loadAbort.current = null
        setLoading(false)
      }
    }
  }, [lang, matched.messageSeq, sessionId])

  const show = (): void => {
    setOpen(true)
    setPreview(null)
    setMode('both')
    setStale(false)
    void load()
  }
  const close = (): void => {
    if (applying) return
    loadAbort.current?.abort()
    loadAbort.current = null
    setLoading(false)
    setOpen(false)
  }
  const chooseMode = (next: RewindMode): void => {
    if (applying) return
    setMode(next)
    setError(null)
    setCompleted(null)
  }
  const ready = preview?.status === 'ready' ? preview : null
  const hasFileChanges = ready !== null && ready.totalChanges > 0
  const driftBlocked = hasFileChanges && ready?.operationChanged === true
  const sharedBlocked = (ready?.activeSessionIds.length ?? 0) > 0
  const planMissing = hasFileChanges && ready !== null && !sharedBlocked && !driftBlocked
    && (ready.planId === undefined || ready.confirmation === undefined)
  const canApply = ready !== null
    && !loading
    && !applying
    && !loadingDetails
    && completed === null
    && hasFileChanges
    && !driftBlocked
    && !sharedBlocked
    && !planMissing
    && !stale

  const loadAllChanges = async (): Promise<void> => {
    if (ready === null || loadingDetails || !ready.truncated) return
    setLoadingDetails(true)
    setError(null)
    try {
      const collected = [...ready.changes]
      let offset = collected.length
      while (offset < ready.totalChanges) {
        const response = await fetch(`${PATH}?sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}&details=1&offset=${String(offset)}&limit=200`, {
          method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store',
        })
        const page = decodePreview(await responseJson(response))
        if (page.status !== 'ready'
          || page.checkpointId !== ready.checkpointId
          || page.totalChanges !== ready.totalChanges
          || page.offset !== offset) {
          throw new RewindRequestError('PLAN_STALE', t('rewind.stale'))
        }
        collected.push(...page.changes)
        offset += page.changes.length
        if (page.changes.length === 0) break
      }
      if (offset !== ready.totalChanges) throw new RewindRequestError('PLAN_STALE', t('rewind.stale'))
      setPreview({ ...ready, changes: collected, truncated: false })
    } catch (caught) {
      if (caught instanceof RewindRequestError && caught.code === 'PLAN_STALE') setStale(true)
      setError(friendlyError(caught, lang))
    } finally {
      setLoadingDetails(false)
    }
  }

  const applyRestore = async (): Promise<void> => {
    if (ready === null || !canApply || applyPending.current) return
    const body: Record<string, unknown> = {
      mode,
      sessionId,
      messageSeq: ready.messageSeq,
      checkpointId: ready.checkpointId,
    }
    if (ready.planId === undefined || ready.confirmation === undefined) return
    body.planId = ready.planId
    body.confirmation = ready.confirmation
    applyPending.current = true
    setApplying(true)
    setError(null)
    try {
      const response = await fetch(PATH, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = recordOf(await responseJson(response))
      const resultMode = requiredString(result.mode, 'mode')
      if (resultMode !== mode) throw new RewindRequestError('INVALID_RESPONSE', t('rewind.stale'))
      if (mode === 'code') {
        requiredString(result.rescuePointId, 'rescuePointId')
        setCompleted(t('rewind.completedCode'))
        return
      }
      const childSessionId = requiredString(result.sessionId, 'sessionId')
      requiredString(result.rescuePointId, 'rescuePointId')
      setCompleted(t('rewind.completedBoth'))
      try {
        await openRestoredSession(childSessionId, matched.promptText)
        setOpen(false)
      } catch (navigationError) {
        setError(`${t('rewind.openFailed')}${messageOf(navigationError)}`)
      }
    } catch (caught) {
      if (caught instanceof RewindRequestError && (caught.code === 'PLAN_STALE' || caught.code === 'WORKSPACE_IN_USE')) {
        setStale(true)
      }
      setError(friendlyError(caught, lang))
    } finally {
      applyPending.current = false
      setApplying(false)
    }
  }

  const actionLabel = mode === 'both' ? t('rewind.actionBoth') : t('rewind.actionCode')
  const radioName = `dcl-rewind-${sessionId}-${String(matched.messageSeq)}`
  const branchChanged = ready !== null && ready.checkpointBranch !== ready.currentBranch

  return (
    <div className="dcl-rewind-tail">
      <Tooltip label={t('rewind.tooltip')} side="bottom">
        <button type="button" className="dcl-rewind-trigger" onClick={show} aria-label={t('rewind.aria')}>
          <RewindIcon size={16} />
        </button>
      </Tooltip>
      <Modal
        open={open}
        onClose={close}
        title={t('rewind.title')}
        closeLabel={t('rewind.close')}
        description={t('rewind.description')}
        className="dcl-rewind-dialog"
        contentClassName="dcl-rewind-content"
        footer={(
          <>
            <Button variant="outline" onClick={close} disabled={applying}>{t('rewind.cancel')}</Button>
            <Button variant="primary" onClick={() => { void applyRestore() }} disabled={!canApply}>
              {applying ? t('rewind.applying') : completed === null ? actionLabel : t('rewind.done')}
            </Button>
          </>
        )}
      >
        <div className="dcl-rewind-body">
          {loading && <p className="dcl-rewind-status">{t('rewind.loading')}</p>}
          {preview?.status === 'pending' && <p className="dcl-rewind-status">{t('rewind.pending')}</p>}
          {preview?.status === 'missing' && <p className="dcl-rewind-error">{t('rewind.missing')}</p>}
          {preview?.status === 'failed' && <p className="dcl-rewind-error">{t('rewind.failed')}{preview.error}</p>}
          {ready !== null && (
            <>
              <div className="dcl-rewind-options">
                <label className="dcl-rewind-option" data-selected={mode === 'both'} data-disabled={applying}>
                  <input type="radio" name={radioName} checked={mode === 'both'} disabled={applying} onChange={() => { chooseMode('both') }} />
                  <span className="dcl-rewind-option-content"><strong>{t('rewind.optionBothTitle')}</strong><span className="dcl-rewind-option-description">{t('rewind.optionBothDesc')}</span></span>
                </label>
                <label className="dcl-rewind-option" data-selected={mode === 'code'} data-disabled={applying}>
                  <input type="radio" name={radioName} checked={mode === 'code'} disabled={applying} onChange={() => { chooseMode('code') }} />
                  <span className="dcl-rewind-option-content"><strong>{t('rewind.optionCodeTitle')}</strong><span className="dcl-rewind-option-description">{t('rewind.optionCodeDesc')}</span></span>
                </label>
              </div>
              <div className="dcl-rewind-summary">
                <strong>{t('rewind.summaryFiles', { count: ready.totalChanges })}</strong>
                <span>{mode === 'both' ? t('rewind.summaryBoth') : t('rewind.summaryCode')}</span>
              </div>
              {sharedBlocked && (
                <p className="dcl-rewind-error">{t('rewind.blockedShared')}</p>
              )}
              {ready.headChanged && !ready.operationChanged && (
                <p className="dcl-rewind-warning">{branchChanged
                  ? t('rewind.warnBranchChanged')
                  : t('rewind.warnHeadChanged')}</p>
              )}
              {driftBlocked && <p className="dcl-rewind-warning">{t('rewind.warnDrift')}</p>}
              {planMissing && <p className="dcl-rewind-error">{t('rewind.planMissing')}</p>}
              {stale && <p className="dcl-rewind-error">{t('rewind.stale')}</p>}
              {ready.totalChanges === 0 && <p className="dcl-rewind-status">{t('rewind.noChanges')}</p>}
              {ready.changes.length > 0 && (
                <div className="dcl-rewind-files">
                  {ready.changes.map(change => <div className="dcl-rewind-file" key={change.path}><code>{change.path}</code><span className="dcl-rewind-kind">{fileRecoveryLabel(change.kind, lang)}</span></div>)}
                </div>
              )}
              {ready.truncated && (
                <div className="dcl-rewind-file-actions"><Button variant="outline" size="sm" onClick={() => { void loadAllChanges() }} disabled={loadingDetails}>{loadingDetails ? t('rewind.loadingDetails') : t('rewind.viewAll', { count: ready.totalChanges })}</Button></div>
              )}
            </>
          )}
          {completed !== null && <p className="dcl-rewind-status">{completed}</p>}
          {error !== null && <p className="dcl-rewind-error">{error}</p>}
          {error !== null && <p className="dcl-rewind-backup">{t('rewind.backupNote')}</p>}
          {!loading && (preview?.status !== 'ready' || stale || planMissing || sharedBlocked || driftBlocked) && <Button className="dcl-rewind-retry" variant="outline" size="sm" onClick={() => { void load() }}>{t('rewind.retry')}</Button>}
        </div>
      </Modal>
    </div>
  )
}

function decodePreview(value: unknown): Preview {
  const record = recordOf(value)
  const status = requiredString(record.status, 'status')
  if (status === 'pending' || status === 'missing') return { status }
  if (status === 'failed') return { status, error: requiredString(record.error, 'error') }
  if (status !== 'ready') {
    throw new RewindRequestError('INVALID_RESPONSE', translate(currentLocale(), 'error.unknownStatus', { status }))
  }
  const changesValue = record.changes
  if (!Array.isArray(changesValue)) {
    throw new RewindRequestError('INVALID_RESPONSE', translate(currentLocale(), 'error.missingChanges'))
  }
  const changes = changesValue.map((entry) => {
    const change = recordOf(entry)
    return { path: requiredString(change.path, 'path'), kind: requiredString(change.kind, 'kind') as ChangeKind }
  })
  const activeSessionIdsValue = record.activeSessionIds
  if (!Array.isArray(activeSessionIdsValue) || !activeSessionIdsValue.every(value => typeof value === 'string')) {
    throw new RewindRequestError('INVALID_RESPONSE', translate(currentLocale(), 'error.missingActiveSessions'))
  }
  return {
    status,
    sessionId: requiredString(record.sessionId, 'sessionId'),
    messageSeq: requiredInteger(record.messageSeq, 'messageSeq'),
    turn: requiredInteger(record.turn, 'turn'),
    checkpointId: requiredString(record.checkpointId, 'checkpointId'),
    turnStartSeq: requiredInteger(record.turnStartSeq, 'turnStartSeq'),
    totalChanges: requiredInteger(record.totalChanges, 'totalChanges'),
    changes,
    offset: requiredInteger(record.offset, 'offset'),
    truncated: requiredBoolean(record.truncated, 'truncated'),
    headChanged: requiredBoolean(record.headChanged, 'headChanged'),
    operationChanged: requiredBoolean(record.operationChanged, 'operationChanged'),
    ...optionalRecordString(record, 'checkpointHead'),
    ...optionalRecordString(record, 'checkpointBranch'),
    ...optionalRecordString(record, 'checkpointOperation'),
    ...optionalRecordString(record, 'currentHead'),
    ...optionalRecordString(record, 'currentBranch'),
    ...optionalRecordString(record, 'currentOperation'),
    activeSessionIds: activeSessionIdsValue as string[],
    restoreBlocked: requiredBoolean(record.restoreBlocked, 'restoreBlocked'),
    ...(typeof record.planId === 'string' ? { planId: record.planId } : {}),
    ...(typeof record.confirmation === 'string' ? { confirmation: record.confirmation } : {}),
  }
}

/** Resolve one conversation node to its DOM row key and rewind match. */
export function selectRewindMessageTarget(value: RewindNodeLike): { readonly matched: RewindMatch; readonly rowKey: string } | null {
  const node = 'key' in value && 'data' in value
    ? { ...value.data, kind: value.kind }
    : value
  const matched = selectRewindMessage(node)
  if (matched === null) return null
  return {
    matched,
    rowKey: 'key' in value && 'data' in value ? value.key : `node:${String(node.seq)}`,
  }
}

function collectPortalTargets(nodes: readonly RewindNodeLike[]): readonly RewindPortalTarget[] {
  const rows = new Map<string, HTMLElement>()
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(
    '[data-chat-flow-kind="user"][data-chat-anchor-key]',
  ))) {
    const key = element.dataset.chatAnchorKey
    if (key !== undefined) rows.set(key, element)
  }
  const targets: RewindPortalTarget[] = []
  const usedContainers = new Set<HTMLElement>()
  for (const value of nodes) {
    const target = selectRewindMessageTarget(value)
    if (target === null) continue
    const row = rows.get(target.rowKey)
    const messageRoot = row?.querySelector<HTMLElement>('[data-time-hover-root="true"]')
    const actions = messageRoot?.lastElementChild
    if (!(actions instanceof HTMLElement) || actions.querySelector(':scope > button') === null) continue
    targets.push({ container: actions, matched: target.matched })
    usedContainers.add(actions)
  }
  const unmatched = nodes
    .map(selectRewindMessageTarget)
    .filter((target): target is { readonly matched: RewindMatch; readonly rowKey: string } => target !== null && !rows.has(target.rowKey))
  const legacyActions = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-time-hover-root="true"]:not([data-turn-tail]):not([data-pending-steering])',
  )).map(root => root.lastElementChild).filter((actions): actions is HTMLElement =>
    actions instanceof HTMLElement && actions.querySelector(':scope > button') !== null && !usedContainers.has(actions),
  )
  for (const [index, target] of unmatched.entries()) {
    const actions = legacyActions[index]
    if (actions === undefined) break
    targets.push({ container: actions, matched: target.matched })
  }
  return targets
}

function samePortalTargets(
  left: readonly RewindPortalTarget[],
  right: readonly RewindPortalTarget[],
): boolean {
  return left.length === right.length && left.every((target, index) => {
    const other = right[index]
    return other !== undefined
      && target.container === other.container
      && target.matched.messageSeq === other.matched.messageSeq
      && target.matched.promptText === other.matched.promptText
  })
}

async function openSessionWithDraft(
  ctx: ClientContextLike,
  sessionId: string,
  promptText: string,
  lang: Locale = currentLocale(),
): Promise<void> {
  let lastError: unknown = new RewindRequestError('NEW_SESSION_NOT_READY', translate(lang, 'error.newSessionNotReady'))
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      ctx.sessions.open(sessionId)
      const scope = ctx.sessions.scope(sessionId)
      if (scope !== undefined) {
        ctx.conversation.input.for(scope).setDraft(promptText)
        return
      }
      lastError = new RewindRequestError('NEW_SESSION_NOT_READY', translate(lang, 'error.newSessionNotReady'))
    } catch (error) {
      lastError = error
    }
    await new Promise<void>(resolve => { setTimeout(resolve, 50) })
  }
  throw lastError
}

async function responseJson(response: Response): Promise<unknown> {
  const value = await response.json() as unknown
  if (!response.ok) {
    const record = recordOf(value)
    throw new RewindRequestError(
      typeof record.code === 'string' ? record.code : 'REWIND_FAILED',
      typeof record.error === 'string' ? record.error : translate(currentLocale(), 'error.requestFailed', { status: response.status }),
    )
  }
  return value
}

class RewindRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RewindRequestError('INVALID_RESPONSE', translate(currentLocale(), 'error.invalidObject'))
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new RewindRequestError('INVALID_RESPONSE', translate(currentLocale(), 'error.invalidValue', { name }))
  }
  return value
}

function requiredInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RewindRequestError('INVALID_RESPONSE', translate(currentLocale(), 'error.invalidValue', { name }))
  }
  return value as number
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RewindRequestError('INVALID_RESPONSE', translate(currentLocale(), 'error.invalidValue', { name }))
  }
  return value
}

function optionalRecordString(record: Record<string, unknown>, name: string): Record<string, string> {
  const value = record[name]
  if (value === undefined) return {}
  return { [name]: requiredString(value, name) }
}

/** Describe the user-visible result of restoring one changed file. */
export function fileRecoveryLabel(kind: ChangeKind, lang: Locale = currentLocale()): string {
  switch (kind) {
    case 'added': return translate(lang, 'file.added')
    case 'deleted': return translate(lang, 'file.deleted')
    case 'modified': return translate(lang, 'file.modified')
    case 'mode-changed': return translate(lang, 'file.modeChanged')
    case 'type-changed': return translate(lang, 'file.typeChanged')
  }
}

function RewindIcon({ size }: { readonly size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.35 3.25 2.75 7l3.6 3.75M3.1 7h5.15a4.25 4.25 0 0 1 4.25 4.25v1.25" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PencilIcon({ size }: { readonly size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3 11.8 1.1-3.2 6.6-6.6a1.45 1.45 0 0 1 2.05 2.05l-6.6 6.6L3 11.8Zm6.7-8.7 2.05 2.05" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function friendlyError(error: unknown, lang: Locale = currentLocale()): string {
  if (!(error instanceof RewindRequestError)) return messageOf(error)
  switch (error.code) {
    case 'PLAN_STALE': return translate(lang, 'error.planStale')
    case 'PLAN_STALE_REPOSITORY': return translate(lang, 'error.planStaleRepo')
    case 'WORKSPACE_IN_USE': return translate(lang, 'error.workspaceInUse')
    case 'WORKSPACE_LOCKED': return translate(lang, 'error.workspaceLocked')
    case 'HEAD_CHANGED': return translate(lang, 'error.headChanged')
    case 'REPOSITORY_CHANGED': return translate(lang, 'error.repositoryChanged')
    case 'GIT_OPERATION_CHANGED': return translate(lang, 'error.gitOperationChanged')
    case 'RESTORE_POINT_NOT_FOUND': return translate(lang, 'error.restorePointNotFound')
    case 'NO_CHANGES': return translate(lang, 'error.noChanges')
    case 'RESTORE_FAILED_ROLLED_BACK': return translate(lang, 'error.restoreFailedRolledBack')
    case 'CONVERSATION_REWIND_FAILED': return translate(lang, 'error.conversationRewindFailed')
    case 'NEW_SESSION_NOT_READY': return translate(lang, 'error.newSessionNotReady')
    case 'INVALID_RESPONSE': return translate(lang, 'error.invalidResponse')
    case 'REWIND_FAILED': return translate(lang, 'error.requestFailed', { status: 'unknown' })
    default: return error.message
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
