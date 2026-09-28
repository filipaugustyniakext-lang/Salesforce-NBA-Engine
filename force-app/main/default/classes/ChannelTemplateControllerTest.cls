@IsTest
private class ChannelTemplateControllerTest {
    @TestSetup
    static void setupData() {
        Id channelRecordTypeId = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Channel').getRecordTypeId();
        insert new Marketing_Dictionary__c(
            Name = 'Email Main',
            RecordTypeId = channelRecordTypeId,
            Channel_Type__c = 'Email',
            Is_Active__c = true
        );
    }

    @IsTest
    static void savesClassifiesAndReplacesShellFiles() {
        Marketing_Dictionary__c channel = [SELECT Id FROM Marketing_Dictionary__c LIMIT 1];
        Channel_Template__c template = new Channel_Template__c(
            Name = 'Standard Email',
            Status__c = 'Draft',
            Version__c = 1,
            Description__c = 'Default responsive shell'
        );

        Test.startTest();
        Id templateId = ChannelTemplateController.saveTemplate(template, channel.Id);
        Id firstDocumentId = uploadFile(templateId, 'email-shell.html', '<html>first</html>');
        String firstError = ChannelTemplateController.classifyUploadedFiles(
            templateId, new List<Id>{ firstDocumentId }, 'SHELL_HTML'
        );
        Id replacementDocumentId = uploadFile(templateId, 'email-shell-v2.html', '<html>second</html>');
        String replacementError = ChannelTemplateController.classifyUploadedFiles(
            templateId, new List<Id>{ replacementDocumentId }, 'SHELL_HTML'
        );
        List<ChannelTemplateController.TemplateDefinition> definitions =
            ChannelTemplateController.getChannelTemplates(channel.Id);
        Test.stopTest();

        System.assertEquals(null, firstError);
        System.assertEquals(null, replacementError);
        System.assertEquals(1, definitions.size());
        System.assertEquals(1, definitions[0].assets.size(), 'A replacement shell must remove the prior shell link.');
        System.assertEquals('SHELL_HTML', definitions[0].assets[0].assetType);
        System.assertEquals(replacementDocumentId, definitions[0].assets[0].documentId);
    }

    @IsTest
    static void activeTemplateArchivesPriorActiveTemplate() {
        Marketing_Dictionary__c channel = [SELECT Id FROM Marketing_Dictionary__c LIMIT 1];
        Id firstId = createDraftTemplate(channel.Id, 'First', 1);
        Id firstShellId = uploadFile(firstId, 'first.html', '<html>first</html>');
        ChannelTemplateController.classifyUploadedFiles(
            firstId, new List<Id>{ firstShellId }, 'SHELL_HTML'
        );
        ChannelTemplateController.saveTemplate(
            new Channel_Template__c(Id = firstId, Name = 'First', Status__c = 'Active', Version__c = 1),
            channel.Id
        );
        Channel_Template__c second = new Channel_Template__c(
            Name = 'Second', Status__c = 'Draft', Version__c = 2
        );

        Test.startTest();
        Id secondId = ChannelTemplateController.saveTemplate(second, channel.Id);
        Id shellDocumentId = uploadFile(secondId, 'second.html', '<html>second</html>');
        ChannelTemplateController.classifyUploadedFiles(
            secondId, new List<Id>{ shellDocumentId }, 'SHELL_HTML'
        );
        second.Id = secondId;
        second.Status__c = 'Active';
        ChannelTemplateController.saveTemplate(second, channel.Id);
        Test.stopTest();

        Set<Id> templateIds = new Set<Id>{ firstId, secondId };
        Map<Id, Channel_Template__c> records = new Map<Id, Channel_Template__c>([
            SELECT Id, Status__c FROM Channel_Template__c WHERE Id IN :templateIds
        ]);
        System.assertEquals('Archived', records.get(firstId).Status__c);
        System.assertEquals('Active', records.get(secondId).Status__c);
    }

    @IsTest
    static void invalidExtensionIsUnlinkedAndReturnsMessage() {
        Marketing_Dictionary__c channel = [SELECT Id FROM Marketing_Dictionary__c LIMIT 1];
        Id templateId = createDraftTemplate(channel.Id, 'Invalid Upload Test', 1);
        Id documentId = uploadFile(templateId, 'wrong.html', '<html></html>');

        Test.startTest();
        String errorMessage = ChannelTemplateController.classifyUploadedFiles(
            templateId, new List<Id>{ documentId }, 'SHELL_CSS'
        );
        Test.stopTest();

        System.assert(errorMessage.contains('.css'));
        System.assertEquals(0, [
            SELECT COUNT()
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :templateId
              AND ContentDocumentId = :documentId
        ]);
    }

    @IsTest
    static void rejectsActivationBeforeShellHtmlExists() {
        Marketing_Dictionary__c channel = [SELECT Id FROM Marketing_Dictionary__c LIMIT 1];
        Boolean rejected = false;
        Test.startTest();
        try {
            ChannelTemplateController.saveTemplate(
                new Channel_Template__c(Name = 'Incomplete Active', Status__c = 'Active', Version__c = 1),
                channel.Id
            );
        } catch (AuraHandledException error) {
            rejected = true;
        }
        Test.stopTest();
        System.assertEquals(true, rejected);
    }

    @IsTest
    static void deletesAssetAndTemplateWithoutDeletingSharedFiles() {
        Marketing_Dictionary__c channel = [SELECT Id FROM Marketing_Dictionary__c LIMIT 1];
        Id templateId = createDraftTemplate(channel.Id, 'Delete Test', 1);
        Id assetDocumentId = uploadFile(templateId, 'block.html', '<div>block</div>');
        ChannelTemplateController.classifyUploadedFiles(
            templateId, new List<Id>{ assetDocumentId }, 'CONTENT_BLOCK'
        );

        Test.startTest();
        ChannelTemplateController.deleteTemplateAsset(templateId, assetDocumentId);
        Id shellDocumentId = uploadFile(templateId, 'shell.css', 'body {}');
        ChannelTemplateController.classifyUploadedFiles(
            templateId, new List<Id>{ shellDocumentId }, 'SHELL_CSS'
        );
        ChannelTemplateController.deleteTemplate(templateId);
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Channel_Template__c WHERE Id = :templateId]);
        System.assertEquals(0, [SELECT COUNT() FROM ContentDocumentLink WHERE LinkedEntityId = :templateId]);
        System.assertEquals(0, [SELECT COUNT() FROM ContentDocument WHERE Id = :shellDocumentId]);
    }

    @IsTest
    static void deletingChannelCleansUpTemplateFileLinks() {
        Marketing_Dictionary__c channel = [SELECT Id FROM Marketing_Dictionary__c LIMIT 1];
        Id templateId = createDraftTemplate(channel.Id, 'Channel Cascade Test', 1);
        Id documentId = uploadFile(templateId, 'channel-shell.html', '<html></html>');
        ChannelTemplateController.classifyUploadedFiles(
            templateId, new List<Id>{ documentId }, 'SHELL_HTML'
        );

        Test.startTest();
        MarketingDictionaryManagerController.deleteDictionaryRecord(channel.Id);
        Test.stopTest();

        System.assertEquals(0, [SELECT COUNT() FROM Channel_Template__c WHERE Id = :templateId]);
        System.assertEquals(0, [SELECT COUNT() FROM ContentDocumentLink WHERE LinkedEntityId = :templateId]);
    }

    private static Id createDraftTemplate(Id channelId, String name, Decimal version) {
        return ChannelTemplateController.saveTemplate(
            new Channel_Template__c(Name = name, Status__c = 'Draft', Version__c = version),
            channelId
        );
    }

    private static Id uploadFile(Id templateId, String path, String body) {
        String title = path.contains('.') ? path.substring(0, path.lastIndexOf('.')) : path;
        ContentVersion version = new ContentVersion(
            Title = title,
            PathOnClient = path,
            VersionData = Blob.valueOf(body),
            FirstPublishLocationId = templateId
        );
        insert version;
        return [
            SELECT ContentDocumentId
            FROM ContentVersion
            WHERE Id = :version.Id
        ].ContentDocumentId;
    }
}
