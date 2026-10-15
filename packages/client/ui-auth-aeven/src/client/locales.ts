/**
 * `auth.aeven` namespace dictionaries, and the lookup the screens read them
 * through.
 *
 * The gate runs before the plugin graph, so `ctx.locale` does not exist yet and
 * these screens cannot take the service's `t`. They carry their own dictionary
 * and select a language from the browser instead, by the same primary-subtag
 * rule the locale plugin uses, so the sign-in screen and the application that
 * follows agree on the language a reader sees. An explicit locale preference
 * lives in Host user settings, which only a signed-in reader has — so before
 * sign-in the browser's own languages are the only signal there is.
 * @module
 */

/** Dictionary namespace owned by this surface. */
export const NS = 'auth.aeven'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'mfa.failure': '无法完成此请求，请重试。',
  'mfa.title': '保护你的账号',
  'mfa.intro': '使用身份验证器应用增强安全性。你也可以稍后在设置中启用。',
  'mfa.setup': '设置身份验证器',
  'mfa.skip': '稍后再说',
  'mfa.scan': '使用身份验证器应用扫描二维码，然后输入六位验证码。',
  'mfa.manual': '无法扫描？手动输入设置密钥',
  'mfa.code': '身份验证器验证码',
  'mfa.confirm': '继续',
  'mfa.cancel': '取消',
  'mfa.login': '验证你的身份',
  'mfa.loginInfo': '输入身份验证器应用中的验证码以完成登录。',
  'mfa.disable': '关闭双重验证',
  'mfa.disableInfo': '输入身份验证器验证码以关闭这项额外保护。',
  'mfa.error': '请检查验证码后重试。',
  'mfa.expired': '设置或登录已过期，请重新开始。',
  'mfa.limited': '尝试次数过多，请五分钟后重试。',
  'mfa.recovery': '保存恢复码',
  'mfa.recoveryInfo': '双重验证已启用。请妥善保存这些恢复码。无法使用身份验证器时，每个恢复码可使用一次。',
  'mfa.saved': '我已保存恢复码',
  'mfa.copy': '复制恢复码',
  'mfa.copied': '已复制',
  'mfa.loading': '正在准备身份验证器…',
  'mfa.useRecovery': '使用恢复码',
  'mfa.useApp': '使用身份验证器验证码',

  'action.ok': '好的',
  'action.continue': '继续',
  'action.back': '返回',
  'action.signIn': '登录',
  'action.signUp': '注册',
  'action.verify': '验证',
  'action.resendCode': '重新发送验证码',
  'action.forgotPassword': '忘记密码？',
  'action.close': '关闭',
  'action.sendCode': '发送验证码',
  'action.setPassword': '设置密码',
  'signIn.title': '登录你的账号',
  'signIn.withEmail': '使用邮箱登录',
  'signIn.withX': '使用 X 登录',
  'signIn.withApple': '使用 Apple 登录',
  'signIn.withGoogle': '使用 Google 登录',
  'signIn.altPrompt': '还没有账号？',
  'signUp.title': '创建你的账号',
  'signUp.withEmail': '使用邮箱注册',
  'signUp.withX': '使用 X 注册',
  'signUp.withApple': '使用 Apple 注册',
  'signUp.withGoogle': '使用 Google 注册',
  'signUp.altPrompt': '已经有账号了？',
  'verify.title': '验证你的账号',
  'verify.info': '请输入你刚收到的邮件中的验证码。记得检查垃圾邮件文件夹',
  'forgot.title': '重置你的密码',
  'forgot.info': '输入你账号的邮箱地址，我会给你发送一个重置密码的验证码',
  'reset.title': '输入你的验证码',
  'newPassword.title': '设置新密码',
  'field.name': '你的名字',
  'field.email': '邮箱',
  'field.password': '密码',
  'field.confirmPassword': '确认密码',
  'field.verificationCode': '验证码',
  'field.newPassword': '新密码',
  'field.confirmNewPassword': '确认新密码',
  'separator.or': '或',
  'legal.prefix': '继续即表示你同意 Æven 的',
  'legal.terms': '服务条款',
  'legal.and': '与',
  'legal.privacy': '隐私政策',
  'modal.emailMissing': '请填写你的邮箱地址',
  'modal.emailInvalid': '请输入有效的邮箱地址',
  'modal.passwordMissing': '请填写你的密码。',
  'modal.passwordRules': '请填写有效的密码。你的密码需要至少 8 个字符，并包含一个数字、一个特殊字符、一个小写字母和一个大写字母',
  'modal.passwordMismatch': '两次输入的密码不一致。请重试',
  'modal.oops': '出错了',
  'modal.oopsExclaim': '出错了！',
  'modal.genericFailure': '很遗憾，某些功能未按预期工作。请稍后重试',
  'modal.accountExists': '账号已存在',
  'modal.accountExistsPassword': '我发现使用该邮箱地址的账号已存在。你可以用密码登录该账号',
  'modal.accountExistsSocial': '我发现使用该邮箱地址的账号已存在。该账号关联了你的某个社交媒体账号，你可以使用该社交媒体账号登录',
  'modal.blocked': '已封锁',
  'modal.tooManyAttempts': '你尝试登录的次数过多。你已被封锁 15 分钟',
  'modal.invalidCredentials': '你输入的邮箱地址或密码似乎不正确',
  'modal.codeMissing': '请输入你刚收到的邮件中的验证码',
  'modal.accountCreated': '账号已创建',
  'modal.accountCreatedBody': '你的账号已成功创建。现在可以用邮箱和密码登录',
  'modal.codeInvalid': '验证码不正确。请检查邮件后重试',
  'modal.codeExpired': '验证码已过期。请重新获取验证码后重试',
  'modal.codeSent': '验证码已发送',
  'modal.codeSentBody': '我已向你的邮箱地址发送了新的验证码',
  'modal.alreadyVerified': '该邮箱地址已经验证过。你可以用邮箱和密码登录',
  'modal.emailNotVerified': '验证你的邮箱',
  'modal.emailNotVerifiedBody': '你的邮箱地址尚未验证。我已向你的邮箱地址发送了新的验证码',
  'modal.resetCodeSent': '请查收邮件',
  'modal.resetCodeSentBody': '如果该邮箱地址有对应的账号，我已向它发送了重置密码的验证码',
  'modal.passwordChanged': '密码已更改',
  'modal.passwordChangedBody': '你的密码已更改。现在可以用新密码登录',
  'modal.tooManyCodeAttempts': '你输入错误验证码的次数过多。请 15 分钟后再试',
  'oauth.failedHeading': '出错了！',
  'oauth.failedBody': '你好，似乎出了点问题。请重试',
  'name.title': '你好！',
  'name.prompt': '在我们开始聊天之前，我该怎么称呼你？',
  'name.promptAnonymous': '在我这里你不必匿名 ;)',
  'name.saveFailed': '我无法保存这个名字。请重试',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<AuthAevenKey, string> = {
  'mfa.failure': 'We couldn’t complete this request. Please try again.',
  'mfa.title': 'Protect your account',
  'mfa.intro': 'Add an extra layer of security with an authenticator app. You can also do this later in settings.',
  'mfa.setup': 'Set up authenticator',
  'mfa.skip': 'Maybe later',
  'mfa.scan': 'Scan this QR code with your authenticator app, then enter the six-digit code.',
  'mfa.manual': 'Can’t scan? Enter a setup key instead',
  'mfa.code': 'Authenticator code',
  'mfa.confirm': 'Continue',
  'mfa.cancel': 'Cancel',
  'mfa.login': 'Verify it’s you',
  'mfa.loginInfo': 'Enter the code from your authenticator app to finish signing in.',
  'mfa.disable': 'Turn off two-factor authentication',
  'mfa.disableInfo': 'Enter an authenticator code to turn off this extra protection.',
  'mfa.error': 'Please check your code and try again.',
  'mfa.expired': 'This setup or sign-in has expired. Please start again.',
  'mfa.limited': 'Too many attempts. Please try again in five minutes.',
  'mfa.recovery': 'Save your recovery codes',
  'mfa.recoveryInfo': 'Two-factor authentication is on. Keep these codes somewhere safe. Each code works once if you lose access to your app.',
  'mfa.saved': 'I have saved my recovery codes',
  'mfa.copy': 'Copy recovery codes',
  'mfa.copied': 'Copied',
  'mfa.loading': 'Preparing your authenticator…',
  'mfa.useRecovery': 'Use a recovery code',
  'mfa.useApp': 'Use an authenticator code',

  'action.ok': 'Ok',
  'action.continue': 'Continue',
  'action.back': 'Back',
  'action.signIn': 'Sign in',
  'action.signUp': 'Sign up',
  'action.verify': 'Verify',
  'action.resendCode': 'Resend code',
  'action.forgotPassword': 'Forgot your password?',
  'action.close': 'Close',
  'action.sendCode': 'Send code',
  'action.setPassword': 'Set password',
  'signIn.title': 'Sign in to your account',
  'signIn.withEmail': 'Sign in with Email',
  'signIn.withX': 'Sign in with X',
  'signIn.withApple': 'Sign in with Apple',
  'signIn.withGoogle': 'Sign in with Google',
  'signIn.altPrompt': "Don't have an account?",
  'signUp.title': 'Create your account',
  'signUp.withEmail': 'Sign up with Email',
  'signUp.withX': 'Sign up with X',
  'signUp.withApple': 'Sign up with Apple',
  'signUp.withGoogle': 'Sign up with Google',
  'signUp.altPrompt': 'Already have an account?',
  'verify.title': 'Verify your account',
  'verify.info': 'Please enter the verification code from the email you have just received. Make sure to check your spam folder',
  'forgot.title': 'Reset your password',
  'forgot.info': 'Enter the email address of your account and I will send you a code to reset your password',
  'reset.title': 'Enter your code',
  'newPassword.title': 'Set a new password',
  'field.name': 'Your name',
  'field.email': 'Email',
  'field.password': 'Password',
  'field.confirmPassword': 'Confirm password',
  'field.verificationCode': 'Verification code',
  'field.newPassword': 'New password',
  'field.confirmNewPassword': 'Confirm new password',
  'separator.or': 'or',
  'legal.prefix': "By continuing, you agree to Æven's",
  'legal.terms': 'Terms of Service',
  'legal.and': 'and',
  'legal.privacy': 'Privacy Policy',
  'modal.emailMissing': 'Please fill in your email address',
  'modal.emailInvalid': 'Please enter a valid email address',
  'modal.passwordMissing': 'Please fill in your password',
  'modal.passwordRules': 'Please fill in a valid password. Your password needs at least 8 characters, with at least one number, one special character, one lowercase character and one uppercase character',
  'modal.passwordMismatch': 'The passwords do not match. Please try again',
  'modal.oops': 'Oops',
  'modal.oopsExclaim': 'Oops!',
  'modal.genericFailure': 'Unfortunately something is not working the way it is supposed to. Please try again later',
  'modal.accountExists': 'Account exists',
  'modal.accountExistsPassword': 'I see that an account with this email address already exists. You can sign in with this account using your password',
  'modal.accountExistsSocial': 'I see that an account with this email address already exists. It is an account linked to one of your social media accounts. You can sign in by using this social media account',
  'modal.blocked': 'Blocked',
  'modal.tooManyAttempts': 'You tried too many times to sign in. You have been blocked for 15 minutes',
  'modal.invalidCredentials': 'It seems you have entered an invalid email address or password',
  'modal.codeMissing': 'Please enter the verification code from the email you have just received',
  'modal.accountCreated': 'Account created',
  'modal.accountCreatedBody': 'Your account has been successfully created. You can now sign in with your email and password',
  'modal.codeInvalid': 'That code is not correct. Please check the email and try again',
  'modal.codeExpired': 'That code has expired. Please request a new code and try again',
  'modal.codeSent': 'Code sent',
  'modal.codeSentBody': 'I have sent a new code to your email address',
  'modal.alreadyVerified': 'This email address is already verified. You can sign in with your email and password',
  'modal.emailNotVerified': 'Verify your email',
  'modal.emailNotVerifiedBody': 'Your email address has not been verified yet. I have sent a new code to your email address',
  'modal.resetCodeSent': 'Check your email',
  'modal.resetCodeSentBody': 'If an account exists for this address, I have sent it a code to reset your password',
  'modal.passwordChanged': 'Password changed',
  'modal.passwordChangedBody': 'Your password has been changed. You can now sign in with your new password',
  'modal.tooManyCodeAttempts': 'You entered a wrong code too many times. Please try again in 15 minutes',
  'oauth.failedHeading': 'Oops!',
  'oauth.failedBody': 'Hi, It seems i have an issue. Please try again',
  'name.title': 'Hi there!',
  'name.prompt': 'Before we continue to chat, how should I call you?',
  'name.promptAnonymous': "You don't have to be anonymous with me ;)",
  'name.saveFailed': 'I could not save that name. Please try again',
}

/** Key domain of the Aeven authentication namespace. */
export type AuthAevenKey = keyof typeof zh

/** The dictionaries this surface ships, by locale id. */
const DICTIONARIES: Readonly<Record<string, Record<AuthAevenKey, string>>> = { en, zh }

/** Language used when the browser asks for none this surface ships. */
const FALLBACK = 'en'

/**
 * The shipped dictionary the browser asks for.
 *
 * Each requested tag matches a dictionary id exactly, then by primary subtag,
 * so `zh-CN` reaches the `zh` dictionary. `window` is the browser test, not
 * `navigator`: Node exposes a global `navigator` reporting the machine's own
 * language, which must not decide the language for a non-browser run.
 * @returns the locale id to read copy from.
 */
function activeLocale(): string {
  if (typeof window === 'undefined') return FALLBACK
  // Embedders and older WebViews may omit the DOM-typed `languages` property.
  const languages = (navigator as { readonly languages?: readonly string[] }).languages
  for (const tag of [...languages ?? [], navigator.language]) {
    const requested = tag.toLowerCase()
    if (Object.hasOwn(DICTIONARIES, requested)) return requested
    /* v8 ignore next -- `split` always yields a first element; the coalesce
     * only satisfies noUncheckedIndexedAccess. */
    const primary = requested.split('-')[0] ?? ''
    if (Object.hasOwn(DICTIONARIES, primary)) return primary
  }
  return FALLBACK
}

/**
 * Read one piece of copy in the reader's language.
 * @param key - the dictionary key.
 * @returns the translated string.
 */
export function t(key: AuthAevenKey): string {
  /* v8 ignore next -- activeLocale answers only ids DICTIONARIES holds; the
   * coalesce only satisfies noUncheckedIndexedAccess. */
  return (DICTIONARIES[activeLocale()] ?? en)[key]
}
