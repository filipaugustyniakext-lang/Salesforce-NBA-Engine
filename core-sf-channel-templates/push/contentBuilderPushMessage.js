import { appendApiQuery, getApiFetchInit, getRepositoryApiUrl } from '../config/runtimeConfig.js'
import {
  PUSH_CHANNEL_FOLDER_LABEL,
  PUSH_CHANNEL_FOLDER_SEGMENTS,
} from '../config/contentBuilderPaths.js'
import { buildTemplateBasedEmailAssetName } from '../config/contentBuilderNaming.js'
import { searchMceContentAssets } from './adminMasterTemplateSync.js'
import {
  loadContentBuilderFolders,
  resolveCategoryIdByFolderSegments,
} from './contentBuilderFolders.js'

export { buildTemplateBasedEmailAssetName as buildPushMessageAssetName }

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok === false) {
    throw new Error(
      String(payload?.message ?? `Request failed (${response.status})`),
    )
  }
  return payload
}

export async function searchMcePushReferenceAssets(options = {}) {
  const folderResult = await loadContentBuilderFolders()
  const categories = Array.isArray(folderResult.categories)
    ? folderResult.categories
    : []
  const categoryId =
    String(options.categoryId ?? '').trim() ||
    resolveCategoryIdByFolderSegments(
      categories,
      options.folderSegments ?? PUSH_CHANNEL_FOLDER_SEGMENTS,
    )

  if (!categoryId) {
    throw new Error(
      `Could not resolve Content Builder folder "${PUSH_CHANNEL_FOLDER_LABEL}". Synchronize folders and verify the folder exists.`,
    )
  }

  return searchMceContentAssets({
    page: options.page ?? 1,
    pageSize: options.pageSize ?? 50,
    orderBy: options.orderBy ?? 'name asc',
    // Folder browser: all asset types (Code Snippets, etc.), not image-library defaults.
    assetType: options.assetType ?? 'any',
    assetTypeName: options.assetTypeName ?? '',
    categoryId,
    nameContains: options.nameContains ?? '',
    fields: 'id,customerKey,name,assetType,modifiedDate',
  })
}

export function getPushMessageApiUrl() {
  return getRepositoryApiUrl('content-builder/push-message')
}

export async function checkPushMessageInContentBuilder({
  customerKey = '',
  assetName = '',
  assetId = '',
} = {}) {
  const params = new URLSearchParams()
  const key = String(customerKey ?? '').trim()
  const name = String(assetName ?? '').trim()
  const id = String(assetId ?? '').trim()
  if (key) params.set('customerKey', key)
  if (name) params.set('assetName', name)
  if (id) params.set('assetId', id)
  const response = await fetch(
    appendApiQuery(getPushMessageApiUrl(), params.toString()),
    getApiFetchInit(),
  )
  return parseJsonResponse(response)
}

export async function createPushMessageInContentBuilder({
  messageType = 'Push',
  messageName = '',
  messageVariant = '',
  messageVariantId = '',
  folderId = '',
  referenceAssetId = '',
} = {}) {
  const response = await fetch(
    getPushMessageApiUrl(),
    getApiFetchInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageType,
        messageName,
        messageVariant,
        messageVariantId,
        folderId,
        referenceAssetId,
        referencePushAssetId: referenceAssetId,
      }),
    }),
  )
  return parseJsonResponse(response)
}
