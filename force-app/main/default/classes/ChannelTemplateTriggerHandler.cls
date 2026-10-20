public with sharing class ChannelTemplateTriggerHandler {
    public static Boolean allowActiveDelete = false;
    /** Allows archiving the current Active template when a new version is activated in the same transaction. */
    public static Boolean allowSupersedingArchive = false;

    public static void beforeInsert(List<Channel_Template__c> newRecords) {
        for (Channel_Template__c record : newRecords) {
            if (record.Status__c == 'Active') {
                record.addError(
                    'Create the template as Draft, attach and validate its package, then activate it.'
                );
            }
        }
    }

    public static void beforeUpdate(
        List<Channel_Template__c> newRecords,
        Map<Id, Channel_Template__c> oldMap
    ) {
        Map<Id, String> channelTypes = loadChannelTypes(newRecords);
        Map<Id, Integer> activationsByChannel = new Map<Id, Integer>();

        for (Channel_Template__c record : newRecords) {
            Channel_Template__c oldRecord = oldMap.get(record.Id);
            if (oldRecord.Status__c != 'Active' && record.Status__c == 'Active') {
                Integer count = activationsByChannel.containsKey(record.Channel__c)
                    ? activationsByChannel.get(record.Channel__c)
                    : 0;
                activationsByChannel.put(record.Channel__c, count + 1);
            }
        }

        for (Channel_Template__c record : newRecords) {
            Channel_Template__c oldRecord = oldMap.get(record.Id);
            if (oldRecord.Status__c == 'Active') {
                if (record.Status__c != 'Archived' && record.Status__c != 'Active') {
                    record.addError('Active templates can only stay active or be archived.');
                } else if (record.Status__c == 'Active' && record.Channel__c != oldRecord.Channel__c) {
                    record.addError('An active template cannot be moved to another channel.');
                } else if (record.Status__c == 'Archived' && packageContentChanged(record, oldRecord)) {
                    record.addError('Archiving an Active package may only change its Status.');
                } else if (
                    !allowSupersedingArchive
                    && ChannelTemplateController.countPublishedVariantsUsingTemplate(record.Id) > 0
                ) {
                    record.addError(
                        'This active template is used by published message variants and cannot be archived. '
                        + 'Create a new template version and activate it instead; message variants will move to the new version.'
                    );
                }
                continue;
            }
            if (record.Status__c != 'Active') continue;
            if (activationsByChannel.get(record.Channel__c) > 1) {
                record.addError('Only one template can be activated per channel in a transaction.');
                continue;
            }
            ChannelTemplateManifestService.ValidationResult validation =
                ChannelTemplateManifestService.validate(
                    record.Id,
                    channelTypes.get(record.Channel__c)
                );
            if (!validation.valid) {
                record.addError('Template package validation failed:\n' + validation.message);
            } else {
                ChannelTemplateManifestService.applyToTemplate(record, validation);
            }
        }
    }

    public static void beforeDelete(List<Channel_Template__c> oldRecords) {
        if (allowActiveDelete) return;
        for (Channel_Template__c record : oldRecords) {
            if (record.Status__c == 'Active') {
                record.addError('Active template packages cannot be deleted. Archive this version first.');
            }
        }
    }

    public static void afterUpdate(
        List<Channel_Template__c> newRecords,
        Map<Id, Channel_Template__c> oldMap
    ) {
        Set<Id> activatedIds = new Set<Id>();
        Set<Id> channelIds = new Set<Id>();
        for (Channel_Template__c record : newRecords) {
            if (record.Status__c == 'Active'
                && oldMap.get(record.Id).Status__c != 'Active') {
                activatedIds.add(record.Id);
                channelIds.add(record.Channel__c);
            }
        }
        if (channelIds.isEmpty()) return;

        List<Channel_Template__c> priorActive = [
            SELECT Id, Status__c, Channel__c
            FROM Channel_Template__c
            WHERE Channel__c IN :channelIds
              AND Status__c = 'Active'
              AND Id NOT IN :activatedIds
        ];
        if (priorActive.isEmpty()) return;

        Map<Id, Id> successorBySuperseded = new Map<Id, Id>();
        for (Channel_Template__c record : newRecords) {
            if (!activatedIds.contains(record.Id)) continue;
            for (Channel_Template__c prior : priorActive) {
                if (prior.Channel__c == record.Channel__c) {
                    successorBySuperseded.put(prior.Id, record.Id);
                }
            }
        }

        for (Channel_Template__c record : priorActive) record.Status__c = 'Archived';
        allowSupersedingArchive = true;
        try {
            update priorActive;
        } finally {
            allowSupersedingArchive = false;
        }

        for (Id supersededId : successorBySuperseded.keySet()) {
            ChannelTemplateController.repointMessageVariants(
                new Set<Id>{ supersededId },
                successorBySuperseded.get(supersededId)
            );
        }
    }

    private static Map<Id, String> loadChannelTypes(List<Channel_Template__c> templates) {
        Set<Id> channelIds = new Set<Id>();
        for (Channel_Template__c template : templates) {
            if (template.Channel__c != null) channelIds.add(template.Channel__c);
        }
        Map<Id, String> result = new Map<Id, String>();
        for (Marketing_Dictionary__c channel : [
            SELECT Id, Channel_Type__c
            FROM Marketing_Dictionary__c
            WHERE Id IN :channelIds
        ]) {
            result.put(channel.Id, channel.Channel_Type__c);
        }
        return result;
    }

    private static Boolean packageContentChanged(
        Channel_Template__c current,
        Channel_Template__c previous
    ) {
        return current.Name != previous.Name
            || current.Channel__c != previous.Channel__c
            || current.Version__c != previous.Version__c
            || current.Description__c != previous.Description__c
            || current.Package_Id__c != previous.Package_Id__c
            || current.SemVer__c != previous.SemVer__c
            || current.Package_Hash__c != previous.Package_Hash__c
            || current.Compiler_Version__c != previous.Compiler_Version__c
            || current.Manifest_JSON__c != previous.Manifest_JSON__c
            || current.Validation_Status__c != previous.Validation_Status__c
            || current.Validation_Message__c != previous.Validation_Message__c
            || current.Validated_At__c != previous.Validated_At__c;
    }
}