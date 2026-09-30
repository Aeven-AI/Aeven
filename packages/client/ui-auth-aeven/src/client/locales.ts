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
  'action.ok': '好的',
  'action.continue': '继续',
  'action.back': '返回',
  'action.signIn': '登录',
  'action.signUp': '注册',
  'action.verify': '验证',
  'action.resendCode': '重新发送验证码',
  'action.forgotPassword': '忘记密码？',
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
  'field.name': '你的名字',
  'field.email': '邮箱',
  'field.password': '密码',
  'field.confirmPassword': '确认密码',
  'field.verificationCode': '验证码',
  'separator.or': '或',
  'legal.prefix': '继续即表示你同意 Æven 的',
  'legal.terms': '服务条款',
  'legal.and': '与',
  'legal.privacy': '隐私政策',
  'modal.emailMissing': '请填写你的邮箱地址',
  'modal.emailInvalid': '请输入有效的邮箱地址',
  'modal.passwordMissing': '请填写你的密码。',
  'modal.passwordRules': `请填写有效的密码。你的密码需要满足以下条件：<br /><br />
              <ul>
                <li>至少 8 个字符</li>
                <li>至少一个数字</li>
                <li>至少一个特殊字符</li>
                <li>至少一个小写字母</li>
                <li>至少一个大写字母</li>
              </ul>`,
  'modal.passwordMismatch': '两次输入的密码不一致。请重试',
  'modal.oops': '出错了',
  'modal.oopsExclaim': '出错了！',
  'modal.genericFailure': '很遗憾，某些功能未按预期工作。请稍后重试',
  'modal.accountExists': '账号已存在',
  'modal.accountExistsPassword': '我发现使用该邮箱地址的账号已存在。你可以用密码登录该账号',
  'modal.accountExistsSocial': '我发现使用该邮箱地址的账号已存在。该账号关联了你的某个社交媒体账号。<br /><br />你可以使用该社交媒体账号登录',
  'modal.blocked': '已封锁',
  'modal.tooManyAttempts': '你尝试登录的次数过多。你已被封锁 15 分钟',
  'modal.invalidCredentials': '你输入的邮箱地址或密码似乎不正确',
  'modal.codeMissing': '请输入你刚收到的邮件中的验证码',
  'modal.accountCreated': '账号已创建',
  'modal.accountCreatedBody': '你的账号已成功创建。现在可以用邮箱和密码登录',
  'oauth.failedHeading': '出错了！',
  'oauth.failedBody': '你好，似乎出了点问题。请重试',
  'name.title': '你好！',
  'name.prompt': '在我们开始聊天之前，我该怎么称呼你？',
  'name.promptAnonymous': '在我这里你不必匿名 ;)',
  'name.saveFailed': '我无法保存这个名字。请重试',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<AuthAevenKey, string> = {
  'action.ok': 'Ok',
  'action.continue': 'Continue',
  'action.back': 'Back',
  'action.signIn': 'Sign in',
  'action.signUp': 'Sign up',
  'action.verify': 'Verify',
  'action.resendCode': 'Resend code',
  'action.forgotPassword': 'Forgot your password?',
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
  'field.name': 'Your name',
  'field.email': 'Email',
  'field.password': 'Password',
  'field.confirmPassword': 'Confirm password',
  'field.verificationCode': 'Verification code',
  'separator.or': 'or',
  'legal.prefix': "By continuing, you agree to Æven's",
  'legal.terms': 'Terms of Service',
  'legal.and': 'and',
  'legal.privacy': 'Privacy Policy',
  'modal.emailMissing': 'Please fill in your email address',
  'modal.emailInvalid': 'Please enter a valid email address',
  'modal.passwordMissing': 'Please fill in a your password.',
  'modal.passwordRules': `Please fill in a valid password. Your password needs to have the following:<br /><br />
              <ul>
                <li>At least 8 characters</li>
                <li>At least one number</li>
                <li>At least one special character</li>
                <li>At least one lowercase character</li>
                <li>At least one uppercase character</li>
              </ul>`,
  'modal.passwordMismatch': 'The passwords do not match. Please try again',
  'modal.oops': 'Oops',
  'modal.oopsExclaim': 'Oops!',
  'modal.genericFailure': 'Unfortunatly something is not working the way it is supposed to. Please try again later',
  'modal.accountExists': 'Account exists',
  'modal.accountExistsPassword': 'I see than an account with this email address already exists. You can sign in with this account using your password',
  'modal.accountExistsSocial': 'I see that an account with this email address already exists. It is an account linked to one of your social media accounts.<br /><br />You can sign in by using this social media account',
  'modal.blocked': 'Blocked',
  'modal.tooManyAttempts': 'You tried too many times to sign in. Your have been blocked for 15 mins ',
  'modal.invalidCredentials': 'It seems you have entered an invalid emailaddress or password',
  'modal.codeMissing': 'Please enter the verification code from the email you have just received',
  'modal.accountCreated': 'Account created',
  'modal.accountCreatedBody': 'Your account has been successfully created. You can now sign in with your email and password',
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
