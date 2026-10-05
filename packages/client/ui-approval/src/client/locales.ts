/** `approval` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  waiting: '等待审批',
  'detail.aria': '审批详情',
  escalation: '{toolName} 请求比当前模式更大的访问权限',
  once: '「允许一次」只对这一次调用生效，权限模式不会改变。',
  reject: '拒绝',
  allowOnce: '允许一次',
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
} satisfies Record<ApprovalKey, string>
