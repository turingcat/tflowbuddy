/** Typed English and Chinese copy owned by the Electron shell. */

import { desktopEdition } from './edition.ts'

const productName = desktopEdition.productName

export const en = {
  application: 'Application',
  aboutMenu: `About ${productName}`,
  hideApplication: `Hide ${productName}`,
  hideOtherApplications: 'Hide Others',
  showAllApplications: 'Show All',
  quitApplication: `Quit ${productName}`,
  edit: 'Edit',
  menuBar: 'Application menu',
  delete: 'Delete',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select All',
  startupFailed: `${productName} is unavailable`,
  fatalSummary: 'The application could not start or stopped unexpectedly.',
  startupAddressInUse: 'Another DSH instance (such as dsh web or the desktop app) is running. They cannot start at the same time. Quit the other running DSH instance, then restart.',
  diagnosticTruncated: '… Error details shortened. The full diagnostic was written to the Electron console.',
  startupReinstallAdvice: 'If application files are missing or damaged, close the application and reinstall it. Your tasks are stored separately.',
  exitApplication: 'Exit',
  restartApplication: 'Restart',
  recoveryOperationFailed: 'The recovery operation failed',
  disableThirdPartyPlugins: 'Disable third-party plugins, back up profile patch, and restart',
  welcomeTitle: productName,
  welcomeBrand: productName,
  checkUpdatesMenu: 'Check for Updates…',
  reloadPageMenu: 'Reload Page',
  restartAppHostMenu: 'Restart App and Host',
  updateCheckFailedTitle: 'Update Check Failed',
  updateCheckFailed: 'Could not check for updates. Please try again later.',
  updateDownloadFailed: 'Could not download the update. Please try again.',
  updateInstallFailed: 'Could not install the update. Please try again later.',
  updateCheckNetworkFailed: 'Could not check for updates. Please try again later. The connection was interrupted. Check your network and try again.',
  updateDownloadNetworkFailed: 'Could not download the update. Please try again. The connection was interrupted. Check your network and try again.',
  updateInstallNetworkFailed: 'Could not install the update. Please try again later. The connection was interrupted. Check your network and try again.',
  unknownError: 'Unknown error',
  updateCheckTitle: 'Check for Updates',
  updateCurrent: 'No updates available. Current version: V{version}',
  updateChecking: 'Checking for updates…',
  updateDownload: 'Download update',
  updateDownloadedTitle: `${productName} v{version} downloaded`,
  updateDownloadedDetail: 'The update package has downloaded. Select “Install and Restart” to restart the app and begin installation.',
  updateClose: 'Close',
  updateAcknowledge: 'OK',
  updateLater: 'Update later',
  updateDownloading: 'Downloading {percent}%…',
  updateVerifying: 'Verifying update files…',
  updateInstalling: 'Preparing to restart…',
  updateRetry: 'Retry update',
  updateActiveTasks: 'Tasks are still in progress',
  updateActiveTasksDetail: 'Restarting to update may interrupt these tasks. Continue updating?',
  updateStopTasks: 'Stop tasks and update',
  updateTasksChanged: 'New tasks started. Review the update confirmation again.',
  updateTasksUnavailable: 'Task status is unavailable. Try updating again when the workspace is ready.',
  updateStopFailed: 'Tasks could not be stopped safely. The update was not installed. Please try again later.',
  updateTechnicalDetails: 'View technical details',
  updateTitle: `${productName} Update`,
  updateAvailable: 'An update is available',
  updateDetail: `${productName} {version}\n\nThis release includes its matching dsh version. The application will restart after installation.`,
  installAndRestart: 'Install and Restart',
  later: 'Later',
  updateFailedTitle: 'Update Failed',
  mandatoryTitle: 'Update required',
  mandatoryDetail: 'This version is no longer supported. Update to continue. Existing tasks can keep running until you approve a restart.',
  mandatoryUnavailable: 'The update requirement could not be checked. Retry when the connection is available.',
  policyLoginTitle: 'Sign in to the test environment',
  policyLoginRequired: 'This is a test build. Checking update requirements needs Feishu sign-in. Signing in does not download or install an update.',
  policyLogin: 'Sign in with Feishu',
  policyLoginFailed: 'Test environment sign-in did not complete. Please check your connection and try again.',
  policyLoginLoading: 'Loading sign-in page…',
  mandatoryNoRelease: 'No applicable update is available. Check again or contact support.',
  mandatoryRefresh: 'Check again',
  mandatoryPage: 'Open download page',
  mandatoryCopy: 'Copy download address',
  mandatoryPageFailed: 'The download page could not be opened. Copy the address below and open it in your browser.',
  mandatoryActionFailed: 'The update action failed. Retry; the update requirement remains active.',
  mandatoryReady: 'Update ready',
  mandatoryVersion: 'V{version}',
  mandatoryReadyDetail: 'Installing the update will restart the application.',
  mandatoryDeferred: 'Existing tasks can keep running. Update to continue using the application.',
  mandatoryContinue: 'Continue installing update',
  mandatoryInspecting: 'Checking tasks…',
  mandatoryStopping: 'Safely stopping tasks in the application.',
  mandatoryRestarting: 'The application will restart shortly. Please wait.',
  mandatoryDownloadFailed: 'The update files could not be downloaded or prepared. Please retry.',
  mandatoryInstallFailed: 'The update was not installed. Check tasks again and retry.',
  mandatoryOpenHelp: 'If the page did not open, you can',
  mandatoryReopen: 'Open download page again',
  mandatoryCopied: 'Link copied',
  mandatoryCopyFailed: 'Copy failed. Select and copy the address below manually.',
  mandatoryAddress: 'Download address',
  mandatoryNotification: 'Return to the application to confirm installation and restart.',
  welcomeSignInTitle: 'Sign in to TFlowBuddy',
  welcomeSignInIntro: 'Sign in with your TFlow account to start chatting.',
  welcomeCredentialsTitle: 'Account sign in',
  welcomeCredentialsConnecting: 'Connecting to TFlow…',
  welcomeCredentialsHint: 'Enter the email and password you registered with TFlow.',
  welcomeEmail: 'Email',
  welcomePassword: 'Password',
  welcomeCaptcha: 'Verification code',
  welcomeTotpTitle: 'Enter your verification code',
  welcomeTotpHint: 'Enter the 6-digit code from your authenticator app.',
  welcomeTotpHintFor: 'Enter the 6-digit code your authenticator app generated for {email}.',
  welcomeCode: 'Verification code',
  welcomeGroupTitle: 'Choose a model group',
  welcomeGroupHint: 'Choose a group to create your model key. You can change it later on the TFlow website.',
  welcomeSignedIn: 'Signed in',
  welcomeOpeningWorkspace: 'Opening the workspace…',
  welcomeSignIn: 'Sign in',
  welcomeConfirm: 'Confirm',
  welcomeRetry: 'Sign in again',
  welcomeActionFailed: 'The action did not complete. Please try again.',

} as const

/** Every Desktop locale supplies the complete English key set. */
export type DesktopMessages = { readonly [Key in keyof typeof en]: string }

export const zh = {
  application: '应用',
  aboutMenu: `关于 ${productName}`,
  hideApplication: `隐藏 ${productName}`,
  hideOtherApplications: '隐藏其他',
  showAllApplications: '显示全部',
  quitApplication: `退出 ${productName}`,
  edit: '编辑',
  menuBar: '应用菜单',
  delete: '删除',
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  selectAll: '全选',
  startupFailed: `${productName} 无法使用`,
  fatalSummary: '应用无法启动或已意外停止。',
  startupAddressInUse: '有其他正在运行的 DSH（如其他 dsh web、桌面端），无法同时启动，请退出其他正在运行的 DSH 后重启。',
  diagnosticTruncated: '… 错误详情已截短，完整诊断已写入 Electron 控制台。',
  startupReinstallAdvice: '如果应用文件缺失或损坏，请关闭应用并重新安装。任务数据存储在独立位置。',
  exitApplication: '退出',
  restartApplication: '重启',
  recoveryOperationFailed: '恢复操作失败',
  disableThirdPartyPlugins: '禁用第三方插件、备份 profile patch 并重启',
  welcomeTitle: productName,
  welcomeBrand: productName,
  checkUpdatesMenu: '检查更新…',
  reloadPageMenu: '刷新页面',
  restartAppHostMenu: '重启应用与 Host',
  updateCheckFailedTitle: '更新检查失败',
  updateCheckFailed: '检查更新失败，请稍后重试。',
  updateDownloadFailed: '下载更新失败，请重试。',
  updateInstallFailed: '安装更新失败，请稍后重试。',
  updateCheckNetworkFailed: '检查更新失败，请稍后重试。网络连接异常，请检查网络后重试。',
  updateDownloadNetworkFailed: '下载更新失败，请重试。网络连接异常，请检查网络后重试。',
  updateInstallNetworkFailed: '安装更新失败，请稍后重试。网络连接异常，请检查网络后重试。',
  unknownError: '未知错误',
  updateCheckTitle: '检查更新',
  updateCurrent: '当前暂无可用更新。当前版本：V{version}',
  updateChecking: '正在检查更新…',
  updateDownload: '下载更新',
  updateDownloadedTitle: `${productName} v{version} 下载完成`,
  updateDownloadedDetail: '安装包已下载完毕，点击“安装并重启”，即刻重启客户端，开始部署。',
  updateClose: '关闭',
  updateAcknowledge: '确定',
  updateLater: '稍后更新',
  updateDownloading: '正在下载 {percent}%…',
  updateVerifying: '正在校验更新文件…',
  updateInstalling: '正在准备重启…',
  updateRetry: '重试更新',
  updateActiveTasks: '仍有进行中的任务',
  updateActiveTasksDetail: '重启更新可能中断这些任务，是否要继续更新？',
  updateStopTasks: '停止任务并更新',
  updateTasksChanged: '有新任务开始，请重新确认更新。',
  updateTasksUnavailable: '无法确认任务状态，请在工作区就绪后重试更新。',
  updateStopFailed: '未能安全停止任务，更新未安装。请稍后重试。',
  updateTechnicalDetails: '查看技术详情',
  updateTitle: `${productName} 更新`,
  updateAvailable: '发现可用更新',
  updateDetail: `${productName} {version}\n\n新版本绑定匹配的 dsh，安装后将重新启动。`,
  installAndRestart: '安装并重启',
  later: '稍后',
  updateFailedTitle: '更新失败',
  mandatoryTitle: '需要更新',
  mandatoryDetail: '当前版本已停止支持，请更新后继续使用。在您确认重启之前，现有任务可以继续运行。',
  mandatoryUnavailable: '暂时无法检查更新要求，请在网络恢复后重试。',
  policyLoginTitle: '登录测试环境',
  policyLoginRequired: '这是测试版应用，检查更新要求需要先通过飞书登录。登录不会下载或安装更新。',
  policyLogin: '通过飞书登录',
  policyLoginFailed: '测试环境登录未完成，请检查网络后重试。',
  policyLoginLoading: '正在加载登录页面…',
  mandatoryNoRelease: '暂时没有可用的更新，请重新检查或联系支持人员。',
  mandatoryRefresh: '重新检查',
  mandatoryPage: '前往官网下载',
  mandatoryCopy: '复制下载链接',
  mandatoryPageFailed: '无法打开浏览器，请复制下载链接后手动打开。',
  mandatoryActionFailed: '更新操作失败，请重试；应用仍需更新后才能继续使用。',
  mandatoryReady: '更新已准备就绪',
  mandatoryVersion: 'V{version}',
  mandatoryReadyDetail: '安装后将重新启动应用。',
  mandatoryDeferred: '现有任务可以继续运行。完成更新后才能继续操作应用。',
  mandatoryContinue: '继续安装更新',
  mandatoryInspecting: '正在检查任务状态…',
  mandatoryStopping: '正在安全结束应用中的任务。',
  mandatoryRestarting: '应用即将重启，请稍候。',
  mandatoryDownloadFailed: '更新文件下载或准备失败，请重试。',
  mandatoryInstallFailed: '更新尚未安装，请重新检查任务后重试。',
  mandatoryOpenHelp: '若页面未打开，可',
  mandatoryReopen: '重新打开官网',
  mandatoryCopied: '已复制链接',
  mandatoryCopyFailed: '复制失败，请手动选择下方地址复制。',
  mandatoryAddress: '下载地址',
  mandatoryNotification: '返回应用确认安装并重启。',
  welcomeSignInTitle: '登录 TFlowBuddy',
  welcomeSignInIntro: '使用你的 TFlow 账号登录，即可开始对话。',
  welcomeCredentialsTitle: '账号登录',
  welcomeCredentialsConnecting: '正在连接 TFlow 服务…',
  welcomeCredentialsHint: '请输入注册 TFlow 时使用的邮箱和密码。',
  welcomeEmail: '邮箱',
  welcomePassword: '密码',
  welcomeCaptcha: '验证码',
  welcomeTotpTitle: '输入动态验证码',
  welcomeTotpHint: '请输入身份验证器中的 6 位数字验证码。',
  welcomeTotpHintFor: '请输入身份验证器中为 {email} 生成的 6 位数字验证码。',
  welcomeCode: '动态验证码',
  welcomeGroupTitle: '选择模型分组',
  welcomeGroupHint: '选择一个分组来创建你的模型密钥，之后可以在 TFlow 网站上调整。',
  welcomeSignedIn: '已登录',
  welcomeOpeningWorkspace: '正在打开工作区…',
  welcomeSignIn: '登录',
  welcomeConfirm: '确认',
  welcomeRetry: '重新登录',
  welcomeActionFailed: '操作未完成，请重试。',

} as const satisfies DesktopMessages

/** Locale payload exposed to the Desktop-owned renderer. */
export interface DesktopLocale {
  readonly id: 'en' | 'zh-CN'
  readonly messages: DesktopMessages
}

/** Resolve Electron's locale to one shipped Desktop dictionary. */
export function resolveDesktopLocale(locale: string): DesktopLocale {
  return locale.toLowerCase().startsWith('zh')
    ? { id: 'zh-CN', messages: zh }
    : { id: 'en', messages: en }
}

/**
 * Choose a built-in dictionary from the shared preference, then ordered OS languages.
 * @param preference - explicit locale.preference, or null when no language was selected.
 * @param languages - operating-system languages in preference order.
 * @returns the supported dictionary, falling back to English.
 */
export function resolveDesktopStartupLocale(preference: string | null, languages: readonly string[]): DesktopLocale {
  const selected = preference?.toLowerCase()
  if (selected === 'zh' || selected === 'en') return resolveDesktopLocale(selected)
  for (const language of languages) {
    const primary = language.toLowerCase().split('-')[0]
    if (primary === 'zh' || primary === 'en') return resolveDesktopLocale(primary)
  }
  return resolveDesktopLocale('en')
}

/** Replace named placeholders in one locale-owned message. */
export function formatDesktopMessage(
  message: string,
  values: Readonly<Record<string, string>>,
): string {
  return message.replaceAll(/\{([^{}]+)\}/gu, (placeholder, key: string) => values[key] ?? placeholder)
}

/**
 * Challenge locale for the native welcome window.
 *
 * The product ships for readers of Simplified Chinese, so the sign-in surface
 * opens in Chinese regardless of the operating-system language. The workspace
 * still follows {@link resolveDesktopStartupLocale}, and the language setting
 * remains available there.
 * @returns the welcome dictionary.
 */
export function resolveWelcomeLocale(): DesktopLocale {
  return { id: 'zh-CN', messages: zh }
}

/**
 * Whether one window locale argument names the dictionary this build ships for
 * the sign-in surface. The preload refuses an argument it cannot vouch for, so a
 * window created with a locale this build does not know fails loudly instead of
 * rendering a partially translated page.
 * @param value - value of the window's locale argument, or `undefined` when absent.
 * @returns whether the argument matches the shipped welcome locale.
 */
export function isWelcomeLocale(value: string | undefined): boolean {
  return value === resolveWelcomeLocale().id
}
