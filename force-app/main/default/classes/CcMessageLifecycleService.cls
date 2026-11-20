/**
 * Copy Center message variant lifecycle: status rules, variant versions, source template changes,
 * scheduled publication and guarded deletes. Every content change of a variant goes through
 * CC_Message_Blocks__c (see CcMessageContentService) and is mirrored to CC_Message_Blocks_All__c
 * for the MCE push.
 */
public with sharing class CcMessageLifecycleService {
    public static final String DRAFT = 'Draft';
    public static final String READY = 'Ready';
    public static final String LIVE = 'Live';
    public static final String INACTIVE = 'Inactive';
    public static final String ARCHIVED = 'Archived';
    public static final String LEGACY_PUBLISHED = 'Published';

    private static final Map<String, Set<String>> TRANSITIONS = new Map<String, Set<String>>{
        DRAFT => new Set<String>{ DRAFT, READY, ARCHIVED },
        READY => new Set<String>{ READY, DRAFT, LIVE, ARCHIVED },
        LIVE => new Set<String>{ LIVE, INACTIVE },
        INACTIVE => new Set<String>{ INACTIVE, DRAFT, READY, LIVE, ARCHIVED },
        ARCHIVED => new Set<String>{ ARCHIVED }
    };

    public static final Map<String, String> SCHEDULE_TARGET = new Map<String, String>{
        'Publish' => LIVE,
        'Unpublish' => INACTIVE,
        'Publish Changes' => LIVE,
        'Archive' => ARCHIVED
    };
    private static final Map<String, String> SCHEDULE_STATUS_LABEL = new Map<String, String>{
        'Publish' => 'Scheduled for Activation',
        'Unpublish' => 'Scheduled for Deactivation',
        'Publish Changes' => 'Scheduled for Update',
        'Archive' => 'Scheduled for Archivization'
    };

    public class VersionSummary {
        @AuraEnabled public String versionId;
        @AuraEnabled public Decimal versionNumber;
        @AuraEnabled public Integer blockCount = 0;
        @AuraEnabled public Datetime activatedAt;
        @AuraEnabled public String action;
        @AuraEnabled public Boolean isCurrent = false;
    }

    public class TemplateCompatibility {
        @AuraEnabled public Boolean compatible = true;
        @AuraEnabled public List<String> issues = new List<String>();
        @AuraEnabled public Map<String, String> blockMapping = new Map<String, String>();
    }

    // ─── Status ──────────────────────────────────────────────────────────────

    public static Boolean isLive(String status) {
        return status == LIVE || status == LEGACY_PUBLISHED;
    }

    public static String normalizeStatus(String status) {
        if (String.isBlank(status)) return DRAFT;
        return status == LEGACY_PUBLISHED ? LIVE : status;
    }

    public static Set<String> allowedTargets(String fromStatus) {
        Set<String> targets = TRANSITIONS.get(normalizeStatus(fromStatus));
        return targets == null ? new Set<String>{ DRAFT } : targets;
    }

    public static void assertTransition(String fromStatus, String toStatus) {
        String target = normalizeStatus(toStatus);
        if (!TRANSITIONS.containsKey(target)) {
            throw error('Status must be one of: Draft, Ready, Live, Inactive or Archived.');
        }
        if (!allowedTargets(fromStatus).contains(target)) {
            String fromValue = normalizeStatus(fromStatus);
            String reason = fromValue == LIVE ? 'Live messages can only be set to Inactive.'
                : fromValue == ARCHIVED ? 'Archived messages cannot be reactivated. Clone them as a new variant instead.'
                : fromValue == DRAFT ? 'Draft messages must be set to Ready (validated) before they can go Live.'
                : 'That status change is not allowed.';
            throw error(reason);
        }
    }

    /**
     * Before-save trigger logic: legacy Published becomes Live, IsActive follows Live, timestamps are stamped.
     * During an inbound MCE sync only the status is normalized; MCE values for IsActive and dates are kept.
     */
    public static void applyStatusDerivations(List<CC_Message_Metadata__c> rows, Map<Id, CC_Message_Metadata__c> oldById) {
        Boolean inbound = MarketingCloudCopySync.isInboundSyncActive();
        for (CC_Message_Metadata__c row : rows) {
            if (row.Status__c == LEGACY_PUBLISHED) row.Status__c = LIVE;
            if (inbound) continue;
            Boolean liveNow = row.Status__c == LIVE;
            row.IsActive__c = liveNow;
            row.Is_Active__c = liveNow;
            CC_Message_Metadata__c prior = oldById == null ? null : oldById.get(row.Id);
            String priorStatus = prior == null ? null : normalizeStatus(prior.Status__c);
            Boolean publishedProvided = prior == null ? row.Published_At__c != null : row.Published_At__c != prior.Published_At__c;
            Boolean deactivatedProvided = prior == null ? row.Deactivated_At__c != null : row.Deactivated_At__c != prior.Deactivated_At__c;
            if (liveNow && priorStatus != LIVE && !publishedProvided) {
                row.Published_At__c = Datetime.now();
                row.PublishedAt__c = row.Published_At__c;
            }
            if (!liveNow && priorStatus == LIVE && !deactivatedProvided) {
                row.Deactivated_At__c = Datetime.now();
                row.DeactivatedAt__c = row.Deactivated_At__c;
            }
        }
    }

    @AuraEnabled
    public static void changeStatus(Id messageId, String targetStatus) {
        CC_Message_Metadata__c message = CcMessageContentService.queryMessage(messageId);
        String target = normalizeStatus(targetStatus);
        assertTransition(message.Status__c, target);
        if (target == normalizeStatus(message.Status__c)) return;
        if (target == READY || target == LIVE) {
            CcTemplateValidator.Result validation = CcMessageContentService.validateVersion(message.Id, message.CurrentMessageVariantVersionId__c);
            if (!validation.valid) {
                throw error('The message content is not valid yet:\n' + validation.summary());
            }
        }
        CC_Message_Metadata__c changes = CcMessageContentService.partialUpdate(message);
        changes.Status__c = target;
        CopyCockpitModificationService.updateMetadata(changes);
    }

    // ─── Content copies and versions ─────────────────────────────────────────

    /** Copies the current version content of one variant into a new variant (new version 1, new block ids). */
    public static void copyCurrentContent(Id sourceId, Id targetId) {
        CC_Message_Metadata__c source = CcMessageContentService.queryMessage(sourceId);
        CC_Message_Metadata__c target = CcMessageContentService.queryMessage(targetId);
        if (String.isBlank(source.CurrentMessageVariantVersionId__c)) return;
        List<CC_Message_Blocks__c> sourceRows = CcMessageContentService.queryBlocks(source.Id, source.CurrentMessageVariantVersionId__c);
        String versionId = CcMessageContentService.newGuid();
        List<CC_Message_Blocks__c> copies = cloneRows(sourceRows, target, versionId, 1);
        if (!copies.isEmpty()) insert copies;
        insertHistory(target, copies, 'Created', 'Copied from ' + source.Name);
        CC_Message_Metadata__c changes = CcMessageContentService.partialUpdate(target);
        changes.CurrentMessageVariantVersionId__c = versionId;
        changes.Current_Message_Variant_Version_Id__c = versionId;
        changes.CurrentMessageVariantVersionNumber__c = 1;
        changes.Draft_Version_Id__c = null;
        changes.Block_Count__c = copies.size();
        changes.Message_Settings_JSON__c = source.Message_Settings_JSON__c;
        changes.Source_Template__c = source.Source_Template__c;
        CopyCockpitModificationService.updateMetadata(changes);
        syncAuthoringToMirror(new Set<Id>{ target.Id });
    }

    /** "Create New Variant Version": edits go to a draft version; live content stays untouched until activation. */
    @AuraEnabled
    public static CcMessageContentService.MessageContent createVariantVersion(Id messageId) {
        CC_Message_Metadata__c message = CcMessageContentService.queryMessage(messageId);
        if (message.Status__c == ARCHIVED) throw error('Archived messages cannot get new versions. Clone them as a new variant instead.');
        if (String.isNotBlank(message.Draft_Version_Id__c)) {
            return CcMessageContentService.getMessageContent(messageId);
        }
        String draftId = CcMessageContentService.newGuid();
        Decimal draftNumber = (message.CurrentMessageVariantVersionNumber__c == null ? 1 : message.CurrentMessageVariantVersionNumber__c) + 1;
        List<CC_Message_Blocks__c> copies = String.isBlank(message.CurrentMessageVariantVersionId__c)
            ? new List<CC_Message_Blocks__c>()
            : cloneRows(CcMessageContentService.queryBlocks(message.Id, message.CurrentMessageVariantVersionId__c), message, draftId, draftNumber);
        if (!copies.isEmpty()) insert copies;
        CC_Message_Metadata__c changes = CcMessageContentService.partialUpdate(message);
        changes.Draft_Version_Id__c = draftId;
        changes.Scheduled_Status__c = message.Status__c == LIVE ? 'Draft changes' : null;
        CopyCockpitModificationService.updateMetadata(changes);
        return CcMessageContentService.getMessageContent(messageId);
    }

    /** Activates the draft version ("Publish Changes"): snapshots it to history and makes it current. */
    @AuraEnabled
    public static void activateVariantVersion(Id messageId) {
        CC_Message_Metadata__c message = CcMessageContentService.queryMessage(messageId);
        if (String.isBlank(message.Draft_Version_Id__c)) throw error('There is no draft version to activate.');
        CcTemplateValidator.Result validation = CcMessageContentService.validateVersion(message.Id, message.Draft_Version_Id__c);
        if (!validation.valid) throw error('The draft version is not valid yet:\n' + validation.summary());
        List<CC_Message_Blocks__c> draftRows = CcMessageContentService.queryBlocks(message.Id, message.Draft_Version_Id__c);
        Decimal nextNumber = (message.CurrentMessageVariantVersionNumber__c == null ? 1 : message.CurrentMessageVariantVersionNumber__c) + 1;
        insertHistory(message, draftRows, 'Activated', null);
        if (String.isNotBlank(message.CurrentMessageVariantVersionId__c)) {
            delete CcMessageContentService.queryBlocks(message.Id, message.CurrentMessageVariantVersionId__c);
        }
        CC_Message_Metadata__c changes = CcMessageContentService.partialUpdate(message);
        changes.CurrentMessageVariantVersionId__c = message.Draft_Version_Id__c;
        changes.Current_Message_Variant_Version_Id__c = message.Draft_Version_Id__c;
        changes.CurrentMessageVariantVersionNumber__c = nextNumber;
        changes.Draft_Version_Id__c = null;
        changes.Block_Count__c = draftRows.size();
        changes.Scheduled_Status__c = null;
        CopyCockpitModificationService.updateMetadata(changes);
        syncAuthoringToMirror(new Set<Id>{ message.Id });
    }

    @AuraEnabled
    public static void discardVariantVersion(Id messageId) {
        CC_Message_Metadata__c message = CcMessageContentService.queryMessage(messageId);
        if (String.isBlank(message.Draft_Version_Id__c)) return;
        delete CcMessageContentService.queryBlocks(message.Id, message.Draft_Version_Id__c);
        CC_Message_Metadata__c changes = CcMessageContentService.partialUpdate(message);
        changes.Draft_Version_Id__c = null;
        changes.Scheduled_Status__c = null;
        CopyCockpitModificationService.updateMetadata(changes);
    }

    @AuraEnabled
    public static List<VersionSummary> getVersionHistory(Id messageId) {
        CC_Message_Metadata__c message = CcMessageContentService.queryMessage(messageId);
        Map<String, VersionSummary> byVersion = new Map<String, VersionSummary>();
        for (CC_Message_History__c row : [
            SELECT MessageVariantVersionId__c, MessageVariantVersionNumber__c, Action__c, Activated_At__c, CreatedDate
            FROM CC_Message_History__c
            WHERE Message_Metadata__c = :messageId
            ORDER BY MessageVariantVersionNumber__c DESC, CreatedDate DESC
        ]) {
            VersionSummary summary = byVersion.get(row.MessageVariantVersionId__c);
            if (summary == null) {
                summary = new VersionSummary();
                summary.versionId = row.MessageVariantVersionId__c;
                summary.versionNumber = row.MessageVariantVersionNumber__c;
                summary.action = row.Action__c;
                summary.activatedAt = row.Activated_At__c != null ? row.Activated_At__c : row.CreatedDate;
                summary.isCurrent = row.MessageVariantVersionId__c == message.CurrentMessageVariantVersionId__c;
                byVersion.put(row.MessageVariantVersionId__c, summary);
            }
            summary.blockCount++;
        }
        return byVersion.values();
    }

    /** Restores an earlier version from history into a new draft version. */
    @AuraEnabled
    public static CcMessageContentService.MessageContent restoreVersion(Id messageId, String versionId) {
        CC_Message_Metadata__c message = CcMessageContentService.queryMessage(messageId);
        List<CC_Message_History__c> snapshot = [
            SELECT ContentBlockOrder__c, BlockTemplateDefinitionId__c, BlockTemplateDefinitionName__c, BlockType__c,
                   ContentJson__c, ContentJsonPart2__c
            FROM CC_Message_History__c
            WHERE Message_Metadata__c = :messageId AND MessageVariantVersionId__c = :versionId
            ORDER BY ContentBlockOrder__c ASC
        ];
        if (snapshot.isEmpty()) throw error('That version was not found in the message history.');
        discardVariantVersion(messageId);
        message = CcMessageContentService.queryMessage(messageId);
        String draftId = CcMessageContentService.newGuid();
        Decimal draftNumber = (message.CurrentMessageVariantVersionNumber__c == null ? 1 : message.CurrentMessageVariantVersionNumber__c) + 1;
        List<CC_Message_Blocks__c> rows = new List<CC_Message_Blocks__c>();
        for (CC_Message_History__c entry : snapshot) {
            CC_Message_Blocks__c row = baseRow(message, draftId, draftNumber, entry.ContentBlockOrder__c);
            row.BlockTemplateDefinitionId__c = validBlockDefinitionId(entry.BlockTemplateDefinitionId__c);
            row.BlockTemplateDefinitionName__c = entry.BlockTemplateDefinitionName__c;
            row.BlockType__c = entry.BlockType__c;
            setJsonWithBlockId(row, CcMessageContentService.joinJson(entry.ContentJson__c, entry.ContentJsonPart2__c));
            rows.add(row);
        }
        insert rows;
        CC_Message_Metadata__c changes = CcMessageContentService.partialUpdate(message);
        changes.Draft_Version_Id__c = draftId;
        CopyCockpitModificationService.updateMetadata(changes);
        return CcMessageContentService.getMessageContent(messageId);
    }

    // ─── Source template ─────────────────────────────────────────────────────

    /**
     * A template is compatible when every content block of the message (current and draft version)
     * has an Active block with the same name in the new template supporting at least the same content types.
     */
    @AuraEnabled
    public static TemplateCompatibility checkTemplateChange(Id messageId, Id templateId) {
        return checkTemplateChanges(new Set<Id>{ messageId }, templateId).get(messageId);
    }

    /**
     * A template is compatible when every content block of the message (current and draft version)
     * has an Active block with the same name in the new template supporting at least the same content types.
     */
    public static Map<Id, TemplateCompatibility> checkTemplateChanges(Set<Id> messageIds, Id templateId) {
        Map<Id, TemplateCompatibility> results = new Map<Id, TemplateCompatibility>();
        for (Id messageId : messageIds) results.put(messageId, new TemplateCompatibility());
        List<Channel_Template__c> templates = [
            SELECT Id, Status__c, Definition_JSON__c, Template_Mode__c
            FROM Channel_Template__c WHERE Id = :templateId LIMIT 1
        ];
        if (templates.isEmpty() || templates[0].Status__c != 'Active') {
            for (TemplateCompatibility result : results.values()) {
                result.compatible = false;
                result.issues.add('Only Active templates can be assigned.');
            }
            return results;
        }
        Channel_Template__c template = templates[0];
        Boolean multiV1 = String.isNotBlank(template.Definition_JSON__c) && template.Template_Mode__c != 'Single Block';
        Map<String, Channel_Template_Block__c> activeByName = new Map<String, Channel_Template_Block__c>();
        for (Channel_Template_Block__c block : [
            SELECT Id, Name, Content_Types__c FROM Channel_Template_Block__c
            WHERE Channel_Template__c = :templateId AND Status__c = 'Active'
        ]) {
            activeByName.put(block.Name.toLowerCase(), block);
        }
        Map<Id, Set<String>> versionsByMessage = new Map<Id, Set<String>>();
        Set<String> allVersions = new Set<String>();
        for (CC_Message_Metadata__c message : [
            SELECT Id, CurrentMessageVariantVersionId__c, Draft_Version_Id__c FROM CC_Message_Metadata__c WHERE Id IN :messageIds
        ]) {
            Set<String> versions = new Set<String>{ message.CurrentMessageVariantVersionId__c, message.Draft_Version_Id__c };
            versions.remove(null);
            versionsByMessage.put(message.Id, versions);
            allVersions.addAll(versions);
        }
        for (CC_Message_Blocks__c row : [
            SELECT Message_Metadata__c, MessageVariantVersionId__c, BlockTemplateDefinitionId__c, BlockTemplateDefinitionName__c,
                   BlockTemplateDefinitionContentTypes__c, ContentBlockOrder__c
            FROM CC_Message_Blocks__c
            WHERE Message_Metadata__c IN :messageIds AND MessageVariantVersionId__c IN :allVersions
        ]) {
            if (!versionsByMessage.get(row.Message_Metadata__c).contains(row.MessageVariantVersionId__c)) continue;
            TemplateCompatibility result = results.get(row.Message_Metadata__c);
            if (row.BlockTemplateDefinitionId__c == null) {
                if (multiV1) {
                    result.compatible = false;
                    result.issues.add('Block ' + row.ContentBlockOrder__c + ' (' + row.BlockTemplateDefinitionName__c
                        + ') was created without a template block and cannot be moved to a multi-block template.');
                }
                continue;
            }
            Channel_Template_Block__c match = activeByName.get(String.valueOf(row.BlockTemplateDefinitionName__c).toLowerCase());
            if (match == null) {
                result.compatible = false;
                result.issues.add('The new template has no Active block named "' + row.BlockTemplateDefinitionName__c + '".');
                continue;
            }
            Set<String> needed = splitTypes(row.BlockTemplateDefinitionContentTypes__c);
            Set<String> offered = splitTypes(match.Content_Types__c);
            if (!offered.containsAll(needed)) {
                needed.removeAll(offered);
                result.compatible = false;
                result.issues.add('Block "' + row.BlockTemplateDefinitionName__c + '" in the new template does not support: '
                    + String.join(new List<String>(needed), ', ') + '.');
                continue;
            }
            result.blockMapping.put(row.BlockTemplateDefinitionId__c, match.Id);
        }
        return results;
    }

    @AuraEnabled
    public static TemplateCompatibility changeSourceTemplate(Id messageId, Id templateId) {
        return changeSourceTemplates(new Set<Id>{ messageId }, templateId).get(messageId);
    }

    public static Map<Id, TemplateCompatibility> changeSourceTemplates(Set<Id> messageIds, Id templateId) {
        List<CC_Message_Metadata__c> messages = [
            SELECT Id, Name, Status__c, MessageVariantId__c, Message_Variant_Id__c, CurrentMessageVariantVersionId__c, Draft_Version_Id__c
            FROM CC_Message_Metadata__c WHERE Id IN :messageIds
        ];
        for (CC_Message_Metadata__c message : messages) {
            if (isLive(message.Status__c)) throw error(message.Name + ' is Live. Set it to Inactive before changing the source template.');
        }
        Map<Id, TemplateCompatibility> results = checkTemplateChanges(messageIds, templateId);
        List<String> issues = new List<String>();
        Map<String, String> mapping = new Map<String, String>();
        for (TemplateCompatibility result : results.values()) {
            issues.addAll(result.issues);
            mapping.putAll(result.blockMapping);
        }
        if (!issues.isEmpty()) {
            throw error('This template is not compatible with the message content:\n' + String.join(issues, '\n'));
        }
        Set<String> versions = new Set<String>();
        List<CC_Message_Metadata__c> updates = new List<CC_Message_Metadata__c>();
        for (CC_Message_Metadata__c message : messages) {
            if (message.CurrentMessageVariantVersionId__c != null) versions.add(message.CurrentMessageVariantVersionId__c);
            if (message.Draft_Version_Id__c != null) versions.add(message.Draft_Version_Id__c);
            CC_Message_Metadata__c changes = CcMessageContentService.partialUpdate(message);
            changes.Source_Template__c = templateId;
            updates.add(changes);
        }
        List<CC_Message_Blocks__c> rows = [
            SELECT Id, BlockTemplateDefinitionId__c, ContentJson__c, ContentJsonPart2__c
            FROM CC_Message_Blocks__c
            WHERE Message_Metadata__c IN :messageIds AND MessageVariantVersionId__c IN :versions AND BlockTemplateDefinitionId__c != null
        ];
        for (CC_Message_Blocks__c row : rows) {
            String newId = mapping.get(row.BlockTemplateDefinitionId__c);
            Map<String, Object> block = (Map<String, Object>) JSON.deserializeUntyped(CcMessageContentService.joinJson(row.ContentJson__c, row.ContentJsonPart2__c));
            block.put('blockTemplateDefinitionId', newId);
            row.BlockTemplateDefinitionId__c = newId;
            CcMessageContentService.putJson(row, JSON.serialize(block));
        }
        if (!rows.isEmpty()) update rows;
        CopyCockpitModificationService.updateMetadata(updates);
        syncAuthoringToMirror(messageIds);
        return results;
    }

    // ─── Scheduling ──────────────────────────────────────────────────────────

    public static String scheduleActionFor(CC_Message_Metadata__c message, String requested) {
        String status = normalizeStatus(message.Status__c);
        if (status == DRAFT) throw error('Draft messages cannot be scheduled. Set the message to Ready first.');
        if (status == ARCHIVED) throw error('Archived messages cannot be scheduled.');
        if (!SCHEDULE_TARGET.containsKey(requested)) throw error('Unknown scheduled action ' + requested + '.');
        if (requested == 'Publish Changes' && String.isBlank(message.Draft_Version_Id__c)) {
            throw error('There is no draft version to publish. Use Create New Variant Version first.');
        }
        if (requested == 'Publish' && status != READY && status != INACTIVE) throw error('Only Ready or Inactive messages can be scheduled for activation.');
        if (requested == 'Unpublish' && status != LIVE) throw error('Only Live messages can be scheduled for deactivation.');
        if (requested == 'Archive' && status == LIVE) throw error('Live messages must be deactivated before they can be archived.');
        return requested;
    }

    @AuraEnabled
    public static Id schedulePublication(Id messageId, String action, Datetime runAt, String note) {
        CC_Message_Metadata__c message = CcMessageContentService.queryMessage(messageId);
        String scheduledAction = scheduleActionFor(message, action);
        if (runAt == null || runAt <= Datetime.now()) throw error('Choose a date and time in the future.');
        Integer pending = [SELECT COUNT() FROM CC_Message_Scheduled__c WHERE Message_Metadata__c = :messageId AND Status__c = 'Pending'];
        if (pending > 0) throw error('This message already has a pending scheduled change. Cancel it first.');
        if (scheduledAction == 'Publish' || scheduledAction == 'Publish Changes') {
            String versionId = scheduledAction == 'Publish Changes' ? message.Draft_Version_Id__c : message.CurrentMessageVariantVersionId__c;
            CcTemplateValidator.Result validation = CcMessageContentService.validateVersion(message.Id, versionId);
            if (!validation.valid) throw error('The message content is not valid yet:\n' + validation.summary());
        }
        CC_Message_Scheduled__c schedule = new CC_Message_Scheduled__c(
            Message_Metadata__c = message.Id,
            MessageVariantId__c = CcMessageContentService.variantIdOf(message),
            Scheduled_Action__c = scheduledAction,
            Status__c = 'Pending',
            Run_At__c = runAt,
            From_Status__c = normalizeStatus(message.Status__c),
            To_Status__c = SCHEDULE_TARGET.get(scheduledAction),
            Target_Version_Id__c = scheduledAction == 'Publish Changes' ? message.Draft_Version_Id__c : null,
            Note__c = note == null ? null : note.left(255)
        );
        insert schedule;
        CC_Message_Metadata__c changes = CcMessageContentService.partialUpdate(message);
        changes.Scheduled_Change_Id__c = schedule.Id;
        changes.Scheduled_Action__c = scheduledAction;
        changes.Scheduled_Status__c = SCHEDULE_STATUS_LABEL.get(scheduledAction);
        changes.Scheduled_At__c = runAt;
        changes.Scheduled_From_Status__c = schedule.From_Status__c;
        changes.Scheduled_To_Status__c = schedule.To_Status__c;
        changes.Scheduled_Note__c = note;
        CopyCockpitModificationService.updateMetadata(changes);
        return schedule.Id;
    }

    @AuraEnabled
    public static void cancelSchedule(Id messageId) {
        CC_Message_Metadata__c message = CcMessageContentService.queryMessage(messageId);
        List<CC_Message_Scheduled__c> pending = [
            SELECT Id FROM CC_Message_Scheduled__c WHERE Message_Metadata__c = :messageId AND Status__c = 'Pending'
        ];
        for (CC_Message_Scheduled__c schedule : pending) schedule.Status__c = 'Cancelled';
        update pending;
        CopyCockpitModificationService.updateMetadata(clearSchedule(message, 'cancelled'));
    }

    /** Runs due Pending schedules. Called by the CC_Scheduled_Publication flow (scheduled path at Run_At__c). */
    public static void executeSchedules(List<Id> scheduleIds) {
        for (CC_Message_Scheduled__c schedule : [
            SELECT Id, Message_Metadata__c, Scheduled_Action__c, Status__c, Run_At__c, Target_Version_Id__c
            FROM CC_Message_Scheduled__c
            WHERE Id IN :scheduleIds AND Status__c = 'Pending'
        ]) {
            if (schedule.Run_At__c != null && schedule.Run_At__c > Datetime.now().addMinutes(1)) continue;
            Savepoint sp = Database.setSavepoint();
            try {
                if (schedule.Message_Metadata__c == null) throw error('The scheduled message no longer exists.');
                CC_Message_Metadata__c message = CcMessageContentService.queryMessage(schedule.Message_Metadata__c);
                if (schedule.Scheduled_Action__c == 'Publish Changes') {
                    if (message.Draft_Version_Id__c != schedule.Target_Version_Id__c) {
                        throw error('The draft version changed after scheduling. Schedule the update again.');
                    }
                    activateVariantVersion(message.Id);
                    if (!isLive(message.Status__c)) changeStatus(message.Id, LIVE);
                } else {
                    changeStatus(message.Id, SCHEDULE_TARGET.get(schedule.Scheduled_Action__c));
                }
                schedule.Status__c = 'Done';
                schedule.Executed_At__c = Datetime.now();
                update schedule;
                CopyCockpitModificationService.updateMetadata(clearSchedule(CcMessageContentService.queryMessage(message.Id), 'executed'));
            } catch (Exception e) {
                Database.rollback(sp);
                update new CC_Message_Scheduled__c(
                    Id = schedule.Id,
                    Status__c = 'Failed',
                    Executed_At__c = Datetime.now(),
                    Error_Message__c = e.getMessage().left(32768)
                );
            }
        }
    }

    private static CC_Message_Metadata__c clearSchedule(CC_Message_Metadata__c message, String outcome) {
        CC_Message_Metadata__c changes = CcMessageContentService.partialUpdate(message);
        changes.Scheduled_Status__c = outcome;
        changes.Scheduled_Change_Id__c = null;
        changes.Scheduled_Action__c = null;
        changes.Scheduled_At__c = null;
        changes.Scheduled_To_Status__c = null;
        changes.Scheduled_From_Status__c = null;
        return changes;
    }

    // ─── Delete guard ────────────────────────────────────────────────────────

    /** Live messages, messages used by active campaigns and messages with pending schedules cannot be deleted. */
    public static List<String> deleteBlockers(Set<Id> messageIds) {
        List<String> blockers = new List<String>();
        if (messageIds == null || messageIds.isEmpty()) return blockers;
        for (CC_Message_Metadata__c message : [
            SELECT Id, Name, Status__c, Campaign__c, Campaign__r.Name, Campaign__r.IsActive
            FROM CC_Message_Metadata__c WHERE Id IN :messageIds
        ]) {
            if (isLive(message.Status__c)) blockers.add(message.Name + ' is Live. Set it to Inactive first.');
            if (message.Campaign__c != null && message.Campaign__r.IsActive) {
                blockers.add(message.Name + ' is assigned to the active campaign ' + message.Campaign__r.Name + '.');
            }
        }
        for (Campaign_Copy_Variant__c link : [
            SELECT Message_Variant__r.Name, Campaign__r.Name
            FROM Campaign_Copy_Variant__c
            WHERE Message_Variant__c IN :messageIds AND Campaign__r.IsActive = true
        ]) {
            blockers.add(link.Message_Variant__r.Name + ' is assigned to the active campaign ' + link.Campaign__r.Name + '.');
        }
        for (CC_Message_Scheduled__c schedule : [
            SELECT Message_Metadata__r.Name, Scheduled_Action__c, Run_At__c
            FROM CC_Message_Scheduled__c
            WHERE Message_Metadata__c IN :messageIds AND Status__c = 'Pending'
        ]) {
            blockers.add(schedule.Message_Metadata__r.Name + ' has a pending ' + schedule.Scheduled_Action__c
                + ' scheduled for ' + schedule.Run_At__c.format() + '. Cancel it first.');
        }
        return blockers;
    }

    public static void assertDeletable(Set<Id> messageIds) {
        List<String> blockers = deleteBlockers(messageIds);
        if (!blockers.isEmpty()) {
            throw error('These message variants cannot be deleted until their dependencies are resolved:\n' + String.join(blockers, '\n'));
        }
    }

    /** Removes authoring rows, history and schedules of deleted variants (lookups, so not cascaded). */
    public static void deleteRelatedRecords(Set<Id> messageIds) {
        delete [SELECT Id FROM CC_Message_Blocks__c WHERE Message_Metadata__c IN :messageIds];
        delete [SELECT Id FROM CC_Message_History__c WHERE Message_Metadata__c IN :messageIds];
        delete [SELECT Id FROM CC_Message_Scheduled__c WHERE Message_Metadata__c IN :messageIds];
    }

    // ─── MCE mirror ──────────────────────────────────────────────────────────

    /**
     * Mirrors the current version of each message into CC_Message_Blocks_All__c (the MCE mirror); the
     * mirror trigger schedules the DE push. Migrated legacy blocks push their original payload so the
     * existing AMPscript keeps rendering them.
     */
    public static void syncAuthoringToMirror(Set<Id> messageIds) {
        if (messageIds == null || messageIds.isEmpty()) return;
        Map<Id, CC_Message_Metadata__c> messages = new Map<Id, CC_Message_Metadata__c>([
            SELECT Id, MessageVariantId__c, Message_Variant_Id__c, CurrentMessageVariantVersionId__c
            FROM CC_Message_Metadata__c WHERE Id IN :messageIds
        ]);
        Set<String> variantIds = new Set<String>();
        Set<String> versionIds = new Set<String>();
        for (CC_Message_Metadata__c message : messages.values()) {
            String variantId = CcMessageContentService.variantIdOf(message);
            if (String.isNotBlank(variantId)) variantIds.add(variantId);
            if (String.isNotBlank(message.CurrentMessageVariantVersionId__c)) versionIds.add(message.CurrentMessageVariantVersionId__c);
        }
        if (variantIds.isEmpty()) return;
        Map<String, CC_Message_Blocks_All__c> existing = new Map<String, CC_Message_Blocks_All__c>();
        for (CC_Message_Blocks_All__c row : [
            SELECT Id, MessageVariantId__c, ContentBlockOrder__c, CC_External_Key__c
            FROM CC_Message_Blocks_All__c WHERE MessageVariantId__c IN :variantIds
        ]) {
            existing.put(mirrorKey(row.MessageVariantId__c, row.ContentBlockOrder__c), row);
        }
        List<CC_Message_Blocks_All__c> upserts = new List<CC_Message_Blocks_All__c>();
        Set<String> keep = new Set<String>();
        for (CC_Message_Blocks__c row : [
            SELECT Message_Metadata__c, MessageVariantId__c, MessageVariantVersionId__c, MessageName__c, MessageType__c,
                   MessageVariant__c, ContentBlockOrder__c, BlockType__c, ContentBlockPath__c, ContentBuilderAssetId__c,
                   ContentJson__c, ContentJsonPart2__c
            FROM CC_Message_Blocks__c
            WHERE Message_Metadata__c IN :messageIds AND MessageVariantVersionId__c IN :versionIds
        ]) {
            CC_Message_Metadata__c message = messages.get(row.Message_Metadata__c);
            if (message == null || row.MessageVariantVersionId__c != message.CurrentMessageVariantVersionId__c) continue;
            String key = mirrorKey(row.MessageVariantId__c, row.ContentBlockOrder__c);
            keep.add(key);
            CC_Message_Blocks_All__c mirror = existing.containsKey(key)
                ? new CC_Message_Blocks_All__c(Id = existing.get(key).Id)
                : new CC_Message_Blocks_All__c();
            mirror.CC_External_Key__c = key;
            mirror.MessageVariantId__c = row.MessageVariantId__c;
            mirror.ContentBlockOrder__c = row.ContentBlockOrder__c;
            mirror.MessageName__c = row.MessageName__c;
            mirror.MessageType__c = row.MessageType__c;
            mirror.MessageVariant__c = row.MessageVariant__c;
            mirror.BlockType__c = row.BlockType__c;
            mirror.ContentBlockPath__c = row.ContentBlockPath__c;
            mirror.ContentBuilderAssetId__c = row.ContentBuilderAssetId__c;
            CcMessageContentService.putJson(mirror, mcePayload(CcMessageContentService.joinJson(row.ContentJson__c, row.ContentJsonPart2__c)));
            upserts.add(mirror);
        }
        List<CC_Message_Blocks_All__c> removals = new List<CC_Message_Blocks_All__c>();
        for (String key : existing.keySet()) {
            if (!keep.contains(key)) removals.add(existing.get(key));
        }
        if (!upserts.isEmpty()) CopyCockpitModificationService.upsertBlocks(upserts);
        if (!removals.isEmpty()) delete removals;
    }

    /**
     * After an inbound "Sync with MCE", messages whose content only exists as migrated legacy blocks are
     * rebuilt from the refreshed mirror. Messages with schema v1 blocks or a draft version are left alone,
     * because Core is the source of truth for them.
     */
    public static void refreshLegacyAuthoring(Set<String> variantIds) {
        if (variantIds == null || variantIds.isEmpty()) return;
        List<CC_Message_Metadata__c> messages = [
            SELECT Id, Name, MessageName__c, MessageVariantId__c, Message_Variant_Id__c, MessageVariant__c, Version__c,
                   Channel_Type__c, Message_Type__c, Canvas_Blocks_JSON__c, CurrentMessageVariantVersionId__c,
                   Current_Message_Variant_Version_Id__c, CurrentMessageVariantVersionNumber__c, Block_Count__c, Draft_Version_Id__c
            FROM CC_Message_Metadata__c
            WHERE MessageVariantId__c IN :variantIds OR Message_Variant_Id__c IN :variantIds
        ];
        if (messages.isEmpty()) return;
        Set<Id> authoredInCore = new Set<Id>();
        for (CC_Message_Blocks__c row : [
            SELECT Message_Metadata__c FROM CC_Message_Blocks__c
            WHERE Message_Metadata__c IN :messages AND BlockTemplateDefinitionId__c != null
        ]) {
            authoredInCore.add(row.Message_Metadata__c);
        }
        List<CC_Message_Metadata__c> legacy = new List<CC_Message_Metadata__c>();
        for (CC_Message_Metadata__c message : messages) {
            if (!authoredInCore.contains(message.Id) && String.isBlank(message.Draft_Version_Id__c)) legacy.add(message);
        }
        if (legacy.isEmpty()) return;
        delete [SELECT Id FROM CC_Message_Blocks__c WHERE Message_Metadata__c IN :legacy];
        new CcMessageBlocksMigrationBatch(false).migrate(legacy);
    }

    public static String mcePayload(String contentJson) {
        try {
            Map<String, Object> block = (Map<String, Object>) JSON.deserializeUntyped(contentJson);
            Map<String, Object> config = block.get('blockConfig') instanceof Map<String, Object>
                ? (Map<String, Object>) block.get('blockConfig') : new Map<String, Object>();
            List<Object> rows = config.get('rows') instanceof List<Object> ? (List<Object>) config.get('rows') : new List<Object>();
            if (block.containsKey('legacy') && rows.isEmpty()) {
                Object legacy = block.get('legacy');
                return legacy instanceof String ? (String) legacy : JSON.serialize(legacy);
            }
        } catch (Exception e) {
            return contentJson;
        }
        return contentJson;
    }

    private static String mirrorKey(String variantId, Decimal order) {
        return variantId + '#' + (order == null ? '' : String.valueOf(order.intValue()));
    }

    // ─── Row helpers ─────────────────────────────────────────────────────────

    private static List<CC_Message_Blocks__c> cloneRows(List<CC_Message_Blocks__c> sources, CC_Message_Metadata__c target, String versionId, Decimal versionNumber) {
        List<CC_Message_Blocks__c> copies = new List<CC_Message_Blocks__c>();
        for (CC_Message_Blocks__c source : sources) {
            CC_Message_Blocks__c row = baseRow(target, versionId, versionNumber, source.ContentBlockOrder__c);
            row.BlockTemplateDefinitionId__c = source.BlockTemplateDefinitionId__c;
            row.BlockTemplateDefinitionName__c = source.BlockTemplateDefinitionName__c;
            row.BlockTemplateDefinitionContentTypes__c = source.BlockTemplateDefinitionContentTypes__c;
            row.BlockType__c = source.BlockType__c;
            row.ContentBuilderAssetId__c = source.ContentBuilderAssetId__c;
            row.ContentBlockPath__c = source.ContentBlockPath__c;
            row.MCN_BlockTemplateAssetId__c = source.MCN_BlockTemplateAssetId__c;
            row.MCN_BlockTemplateAssetPath__c = source.MCN_BlockTemplateAssetPath__c;
            setJsonWithBlockId(row, CcMessageContentService.joinJson(source.ContentJson__c, source.ContentJsonPart2__c));
            copies.add(row);
        }
        return copies;
    }

    private static CC_Message_Blocks__c baseRow(CC_Message_Metadata__c message, String versionId, Decimal versionNumber, Decimal order) {
        Decimal variantNumber = message.MessageVariant__c != null ? message.MessageVariant__c : message.Version__c;
        return new CC_Message_Blocks__c(
            MessageBlockId__c = CcMessageContentService.newGuid(),
            Message_Metadata__c = message.Id,
            MessageName__c = message.MessageName__c,
            MessageType__c = String.isNotBlank(message.Message_Type__c) ? message.Message_Type__c : message.Channel_Type__c,
            MessageVariantId__c = CcMessageContentService.variantIdOf(message),
            MessageVariantNumber__c = variantNumber,
            MessageVariant__c = variantNumber,
            MessageVariantVersionId__c = versionId,
            MessageVariantVersionNumber__c = versionNumber,
            ContentBlockOrder__c = order,
            UpdatedAt__c = Datetime.now(),
            UpdatedBy__c = UserInfo.getName()
        );
    }

    private static void setJsonWithBlockId(CC_Message_Blocks__c row, String contentJson) {
        String jsonText = contentJson;
        try {
            Map<String, Object> block = (Map<String, Object>) JSON.deserializeUntyped(contentJson);
            block.put('messageBlockId', row.MessageBlockId__c);
            jsonText = JSON.serialize(block);
        } catch (Exception e) {
            jsonText = contentJson;
        }
        CcMessageContentService.putJson(row, jsonText);
    }

    private static Id validBlockDefinitionId(String rawId) {
        if (String.isBlank(rawId)) return null;
        List<Channel_Template_Block__c> rows = [SELECT Id FROM Channel_Template_Block__c WHERE Id = :rawId AND Status__c != 'Archived' LIMIT 1];
        return rows.isEmpty() ? null : rows[0].Id;
    }

    private static void insertHistory(CC_Message_Metadata__c message, List<CC_Message_Blocks__c> rows, String action, String comment) {
        List<CC_Message_History__c> history = new List<CC_Message_History__c>();
        for (CC_Message_Blocks__c row : rows) {
            CC_Message_History__c entry = new CC_Message_History__c(
                Message_Metadata__c = message.Id,
                History_Key__c = (row.MessageVariantId__c + '|' + row.MessageVariantVersionId__c + '|' + row.ContentBlockOrder__c).left(255),
                MessageName__c = row.MessageName__c,
                MessageType__c = row.MessageType__c,
                MessageVariantId__c = row.MessageVariantId__c,
                MessageVariantNumber__c = row.MessageVariantNumber__c,
                MessageVariantVersionId__c = row.MessageVariantVersionId__c,
                MessageVariantVersionNumber__c = row.MessageVariantVersionNumber__c,
                ContentBlockOrder__c = row.ContentBlockOrder__c,
                MessageBlockId__c = row.MessageBlockId__c,
                BlockTemplateDefinitionId__c = row.BlockTemplateDefinitionId__c,
                BlockTemplateDefinitionName__c = row.BlockTemplateDefinitionName__c,
                BlockType__c = row.BlockType__c,
                Action__c = action,
                Commit_Comment__c = comment == null ? null : comment.left(255),
                Activated_At__c = Datetime.now()
            );
            CcMessageContentService.putJson(entry, CcMessageContentService.joinJson(row.ContentJson__c, row.ContentJsonPart2__c));
            history.add(entry);
        }
        if (!history.isEmpty()) upsert history History_Key__c;
    }

    private static Set<String> splitTypes(String value) {
        return String.isBlank(value) ? new Set<String>() : new Set<String>(value.split(';'));
    }

    private static AuraHandledException error(String message) {
        return CcMessageContentService.error(message);
    }
}
