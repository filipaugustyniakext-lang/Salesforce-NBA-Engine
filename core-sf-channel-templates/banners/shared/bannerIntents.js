/**
 * Banner deep-link intents (mobile navigation targets).
 * Custom values are allowed via free-text entry in the combobox.
 */

export const BANNER_INTENT_OPTIONS = [
  'SHOW_DASHBOARD',
  'SHOW_HISTORY',
  'SHOW_PRODUCTS',
  'SHOW_DASHBOARD_BIO_DISABLED',
  'SHOW_PRODUCTS_SAVINGS',
  'SHOW_PRODUCTS_LOANS',
  'SHOW_ACCOUNT_HISTORY',
  'OPEN_NEW_ACCOUNT',
  'SHOW_TRANSACTION_DETAILS',
  'TOP_UP_ACCOUNT',
  'GENERATE_STATEMENT',
  'SHOW_SETTINGS',
  'SHOW_SETTINGS_INTEGRATIONS',
  'SWITCH_PACKAGE_UNICREDIT_EASY',
  'SHOW_KYC_FORM',
  'SHOW_EDIT_TAX_RESIDENCY',
  'SHOW_EDIT_TAX_RESIDENCY_SME',
  'SHOW_PERSONAL_DATA_CHANGE',
  'MAKE_INTERNAL_TRANSFER',
  'MAKE_SPLIT_TRANSFER',
  'MAKE_DOMESTIC_TRANSFER',
  'MAKE_INTERNATIONAL_TRANSFER',
  'TRANSFERS',
  'NEW_TRANSFER',
  'REDO_INTERNAL_TRANSFER',
  'REDO_DOMESTIC_TRANSFER',
  'REDO_INTERNATIONAL_TRANSFER',
  'REDO_TAX_TRANSFER',
  'REDO_ZUS_TRANSFER',
  'REDO_SPLIT_TRANSFER',
  'RETURN_INTERNAL_TRANSFER',
  'RETURN_DOMESTIC_TRANSFER',
  'RETURN_INTERNATIONAL_TRANSFER',
  'RETURN_SPLIT_TRANSFER',
  'SHOW_BLIK_SETTINGS',
  'SHOW_P2P_BLIK_TRANSFER',
  'SHOW_BLIK_LIMITS',
  'SHOW_BLIK_OR_P2P_ACTIVATION',
  'INIT_BIZUM_REGISTRATION',
  'SHOW_BIZUM_DASHBOARD',
  'SHOW_CARDS',
  'SHOW_CARD',
  'NEW_DEBIT_CARD',
  'SHOW_CASH_LOAN_DETAILS',
  'SHOW_CONSOLIDATION_LOAN_DETAILS',
  'NEW_CASH_LOAN',
  'NEW_CONSOLIDATION_LOAN',
  'NEW_CREDIT_CARD_LOAN',
  'SHOW_OVERPAYMENT_LOAN',
  'SME_SHOW_OVERDRAFT',
  'SME_CLOSE_OVERDRAFT',
  'SME_SHOW_INSTALLMENT',
  'SME_SHOW_CREDITS_PRODUCTS',
  'SME_RETURN_TO_PROCESS',
  'PSD2_CONTINUE',
  'RETAIL_RETURN_TO_PROCESS',
  'SHOW_BENEFITS',
  'SHOW_MULTIVOUCHERS',
  'CREATE_NEW_DEPOSIT',
  'SHOW_DEPOSIT_DETAILS',
  'SHOW_SAVINGS_ACCOUNTS_LIST',
  'SHOW_SAVINGS_ACCOUNT',
  'CREATE_NEW_SAVING',
  'CLOSE_ACCOUNT',
  'SHOW_SAVINGS_ACCOUNT_DETAILS',
  'CREATE_NEW_SAVING_VANILLA',
  'SHOW_FX',
  'SHOW_FX_DASHBOARD',
  'SHOW_FX_PRICE_ALERT',
  'START_SELF_INVESTING_ONBOARDING',
  'START_ROBO_ADVISOR_ONBOARDING',
  'POLL_SELF_INVESTING_ONBOARDING_STATUS',
  'POLL_ROBO_ADVISOR_ONBOARDING_STATUS',
  'SHOW_ONBOARDING_CLIENT',
  'SHOW_MGM_OFFER',
  'SHOW_REFERRAL_CODE',
  'ENTER_REFERRAL_CODE',
  'RSA_CREATE_NEW_SAVING',
  'RSA_SHOW_SAVING_ACCOUNTS',
  'RSA_CREATE_NEW_RSA_SAVING',
  'RSA_SHOW_RSA_SAVING_ACCOUNTS',
  'SHOW_SIM_CARD_INSTALLATION',
  'SHOW_SIM_CARD_DETAILS',
]

export const BANNER_ACTION_MODE_INTENT = 'intent'
export const BANNER_ACTION_MODE_URL = 'url'
export const BANNER_INTENT_LIST_MAX_HEIGHT_ITEMS = 10

/** True when a stored value looks like a web URL / path rather than an intent key. */
export function looksLikeBannerActionUrl(value = '') {
  const text = String(value ?? '').trim()
  if (!text) return false
  if (/^https?:\/\//i.test(text)) return true
  if (/^\/\//.test(text)) return true
  // AMPscript / personalization tokens are commonly used inside URLs.
  if (/%%|AttributeValue\s*\(/i.test(text)) return true
  // Intent keys are UPPER_SNAKE_CASE (optionally with digits).
  if (/^[A-Z][A-Z0-9_]*$/.test(text)) return false
  // Host/path-like strings.
  if (/[./]/.test(text)) return true
  return false
}

export function normalizeBannerActionMode(
  value = '',
  hasIntent = false,
  hasUrl = false,
) {
  const mode = String(value ?? '').trim().toLowerCase()
  // Trust an explicit mode only when its value is present, or the other field is empty.
  // This repairs contradictory payloads such as actionMode=intent with only url populated.
  if (mode === BANNER_ACTION_MODE_URL) {
    if (hasUrl || !hasIntent) return BANNER_ACTION_MODE_URL
    return BANNER_ACTION_MODE_INTENT
  }
  if (mode === BANNER_ACTION_MODE_INTENT) {
    if (hasIntent || !hasUrl) return BANNER_ACTION_MODE_INTENT
    return BANNER_ACTION_MODE_URL
  }
  if (hasUrl && !hasIntent) return BANNER_ACTION_MODE_URL
  return BANNER_ACTION_MODE_INTENT
}

/**
 * Normalize a button/link action so only one of intent vs url is populated.
 * Always emits both keys (empty string when unused).
 */
export function normalizeBannerActionTarget(source = {}, options = {}) {
  const {
    modeKey = 'actionMode',
    intentKey = 'intent',
    urlKey = 'url',
    legacyUrlKeys = [],
  } = options

  const root = source && typeof source === 'object' ? source : {}
  // Prefer the configured key, then common aliases (cross-banner / legacy casing).
  let intent = String(
    root[intentKey] ??
      root.intent ??
      root.Intent ??
      root.primaryIntent ??
      root.PrimaryIntent ??
      '',
  ).trim()
  let url = String(
    root[urlKey] ?? root.url ?? root.Url ?? root.primaryUrl ?? root.PrimaryUrl ?? '',
  ).trim()
  if (!url) {
    for (const key of legacyUrlKeys) {
      const candidate = String(root[key] ?? '').trim()
      if (candidate) {
        url = candidate
        break
      }
    }
  }

  // Legacy / race: value stored in the url field while mode says intent (or intent empty).
  if (!intent && url && !looksLikeBannerActionUrl(url)) {
    intent = url
    url = ''
  }

  const actionMode = normalizeBannerActionMode(
    root[modeKey] ??
      root.actionMode ??
      root.ActionMode ??
      root.primaryActionMode ??
      root.PrimaryActionMode ??
      '',
    Boolean(intent),
    Boolean(url),
  )

  if (actionMode === BANNER_ACTION_MODE_URL) {
    return {
      [modeKey]: BANNER_ACTION_MODE_URL,
      [intentKey]: '',
      [urlKey]: url,
    }
  }

  return {
    [modeKey]: BANNER_ACTION_MODE_INTENT,
    [intentKey]: intent,
    [urlKey]: '',
  }
}

export function filterBannerIntentOptions(query = '') {
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle) return [...BANNER_INTENT_OPTIONS]
  return BANNER_INTENT_OPTIONS.filter((option) =>
    option.toLowerCase().includes(needle),
  )
}
