# Copy Center field map (after the schema v1 refactor)

## Target design names and the fields that hold them

| Target design | Core field | Notes |
| --- | --- | --- |
| MasterTemplateDefinitionId | `CC_Message_Metadata__c.Source_Template__c` | Existing lookup to `Channel_Template__c`; no second lookup was added. |
| MCE / MCN master template asset + path | `MCE_MasterTemplateAssetId__c`, `MCE_MasterTemplateAssetPath__c`, `MCN_MasterTemplateAssetId__c`, `MCN_MasterTemplateAssetPath__c` | Template level values live on `Channel_Template__c.MCE_Asset_*` / `MCN_Asset_*`. |
| CurrentMessageVariantVersionId / Number | `CurrentMessageVariantVersionId__c` (+ legacy `Current_Message_Variant_Version_Id__c`), `CurrentMessageVariantVersionNumber__c` | `Draft_Version_Id__c` holds the unpublished "Create New Variant Version" draft. |
| MessagePropertiesJSON(2) | `Message_Settings_JSON__c` | The four MessageProperties fields were deleted. The MCE DE column `MessagePropertiesJSON` maps to this field (`CcMirrorObjectMap.FIELD_OVERRIDES`, `MarketingCloudCopySync`). |
| isActive | `IsActive__c` and `Is_Active__c` | Derived from `Status__c = 'Live'` in `CC_Message_Metadata_Trigger` (a Checkbox cannot be converted to a formula). During an inbound MCE sync the MCE value is kept. |
| Published At / Inactivated At | `Published_At__c` / `Deactivated_At__c` (+ camel duplicates) | Stamped by the trigger on status changes. |
| messageBlockOrder | `CC_Message_Blocks__c.ContentBlockOrder__c` | Existing field reused. |
| MCE block template asset + path | `CC_Message_Blocks__c.ContentBuilderAssetId__c` / `ContentBlockPath__c` | Existing fields reused; MCN uses `MCN_BlockTemplateAsset*__c`. |
| messageBlockId | `CC_Message_Blocks__c.MessageBlockId__c` | Unique external id. |
| CC_ContentBlocks_All__c | `CC_Message_Blocks_All__c` | MCE mirror only. Authoring happens in `CC_Message_Blocks__c`; `CcMessageLifecycleService.syncAuthoringToMirror` writes the mirror, which pushes to MCE. |
| CC_Message_History__c | `CC_Message_History__c` | One row per block per activated version (`History_Key__c = variantId|versionId|order`). `CC_Message_VersionHistoryLog__c` was migrated and deleted. |
| CC_Message_Scheduled__c | `CC_Message_Scheduled__c` | Executed by the `CC_Scheduled_Publication` flow (scheduled path at `Run_At__c`) through `CcScheduledPublicationExecutor`. |
| Status values | Draft, Ready, Live, Inactive, Archived | `Published` was removed; MCE values `Published` are normalized to `Live` before save. |

## Duplicate camelCase / snake_case pairs on CC_Message_Metadata__c

All pairs are still written: the camelCase field by the MCE mirror REST (`CcMirrorService` maps DE column `X` to `X__c`) and by `MarketingCloudCopySync`, the snake_case field by Copy Center code. None is unused, so none was deleted. The snake_case field is canonical for Core code; the camelCase field is the MCE column copy.

| Canonical (Core) | MCE column copy |
| --- | --- |
| `Block_Count__c` | `BlockCount__c` |
| `Cancelled_At__c` | `CancelledAt__c` |
| `Content_Builder_Message_Id__c` | `ContentBuilderMessageId__c` |
| `Content_Builder_Message_Path__c` | `ContentBuilderMessagePath__c` |
| `Current_Message_Variant_Version_Id__c` | `CurrentMessageVariantVersionId__c` (used by the new services as the version key) |
| `Deactivated_At__c` | `DeactivatedAt__c` |
| `Display_Probability__c` | `DisplayProbability__c` |
| `Display_Probability_Manual__c` (Number) | `DisplayProbabilityManual__c` (Checkbox, type mismatch) |
| `Is_Active__c` | `IsActive__c` |
| `Message_Type__c` | `MessageType__c` |
| `Message_Variant__c` (Text) | `MessageVariant__c` (Number) |
| `Message_Variant_Id__c` | `MessageVariantId__c` (MCE primary key) |
| `Published_At__c` | `PublishedAt__c` |
| `Scheduled_*__c` (Action, At, At_Local, Cancelled_At, Change_Id, Created_At, From_Status, Note, Status, To_Status, Updated_At) | `Scheduled*__c` |
| `Staged_Only__c` | `StagedOnly__c` |
| `Topic_Goal_Id__c` | `TopicGoalId__c` |

To remove a camelCase copy later:

1. Add it to `CcMirrorObjectMap.FIELD_OVERRIDES` so the DE column lands in the snake_case field.
2. Remove its `putText` / `putNumber` line from `MarketingCloudCopySync` and `CcMirrorMetadataSync`.
3. Replace remaining reads (`rg -w FieldName__c force-app`).
4. Copy the data, then delete the field with a destructive deploy. For `DisplayProbabilityManual__c` and `MessageVariant__c`, check the type mismatch first.

## Kept on purpose

- `Canvas_Blocks_JSON__c` is empty in the sandbox but is still the save target of the legacy editor (`copyCockpitEditor`), which edits messages whose source template has no v1 definition. Delete it after the legacy templates are upgraded to v1 in the template wizard and the legacy editor is retired.
- `contentBindingModel`, `copyTemplatePreview` legacy paths, and `ChannelTemplateController` file-based templates serve the same legacy templates.

## Destructive manifests

`manifest/destructive/copy-center-phase6/` holds the destructive changes applied to the sandbox. Before running it in another org:

1. Run `CcMessageBlocksMigrationBatch`.
2. Copy `MessagePropertiesJSON__c` into `Message_Settings_JSON__c`.
3. Migrate `CC_Message_VersionHistoryLog__c` rows into `CC_Message_History__c`.
