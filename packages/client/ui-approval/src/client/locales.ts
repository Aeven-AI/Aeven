/** `approval` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  waiting: '等待审批',
  'detail.aria': '审批详情',
  escalation: '{toolName} 请求比当前模式更大的访问权限',
  once: '「允许一次」只对这一次调用生效，权限模式不会改变。',
  reject: '拒绝',
  allowOnce: '允许一次',
  allowSession: '本会话允许',
  session: '本会话允许将授权此账户执行同一操作，包括不同收件人和内容；其他操作仍需审批。',
  sessionAction: '本会话允许会在本会话内重复此操作而不再询问。访问模式不会改变。',
  sessionSandbox: '本会话允许会让本会话内的任何命令都能取得这次放宽的访问权限而不再询问。访问模式不会改变。',
  send: '发送 {provider} 消息',
  action: '{provider}：{operation}',
  to: '收件人',
  channel: '频道',
  subject: '主题',
  message: '消息',
  details: '操作详情',
} satisfies Record<string, string>

/** Approval dictionary key union. */
export type ApprovalKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  waiting: 'Waiting for approval',
  'detail.aria': 'Approval details',
  escalation: '{toolName} asks for more access than the current mode allows',
  once: 'Allowing applies to this one call; your permission mode does not change.',
  reject: 'Reject',
  allowOnce: 'Allow once',
  allowSession: 'Allow for this session',
  session: 'Session approval allows this account to repeat this operation with different recipients and content. Other operations still ask.',
  sessionAction: 'Session approval repeats this action in this session without asking. Your access mode does not change.',
  sessionSandbox: 'Session approval lets any command take this wider access in this session without asking. Your access mode does not change.',
  send: 'Send a {provider} message',
  action: '{provider}: {operation}',
  to: 'To',
  channel: 'Channel',
  subject: 'Subject',
  message: 'Message',
  details: 'Action details',
} satisfies Record<ApprovalKey, string>
