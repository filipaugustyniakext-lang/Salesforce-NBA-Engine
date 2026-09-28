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
        Id firstShellId = uploadFile(firstId, 'first.html', '<html>{{CONTENT}}</html>');
        ChannelTemplateController.classifyUploadedFiles(
            firstId, new List<Id>{ firstShellId }, 'SHELL_HTML'
        );
        attachManifest(firstId, 'email.first', 'Email', 'email-preview@1');
        ChannelTemplateController.saveTemplate(
            new Channel_Template__c(Id = firstId, Name = 'First', Status__c = 'Active', Version__c = 1),
            channel.Id
        );
        Channel_Template__c second = new Channel_Template__c(
            Name = 'Second', Status__c = 'Draft', Version__c = 2
        );

        Test.startTest();
        Id secondId = ChannelTemplateController.saveTemplate(second, channel.Id);
        Id shellDocumentId = uploadFile(secondId, 'second.html', '<html>{{CONTENT}}</html>');
        ChannelTemplateController.classifyUploadedFiles(
            secondId, new List<Id>{ shellDocumentId }, 'SHELL_HTML'
        );
        attachManifest(secondId, 'email.second', 'Email', 'email-preview@1');
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

        ChannelTemplateController.saveTemplate(
            new Channel_Template__c(
                Id = secondId,
                Name = 'Second',
                Status__c = 'Archived',
                Version__c = 2,
                Description__c = ''
            ),
            channel.Id
        );
        System.assertEquals('Archived', [
            SELECT Status__c FROM Channel_Template__c WHERE Id = :secondId
        ].Status__c);
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
    static void validatesManifestAndPersistsPackageIdentity() {
        Marketing_Dictionary__c channel = [SELECT Id FROM Marketing_Dictionary__c LIMIT 1];
        Id templateId = createDraftTemplate(channel.Id, 'Validated Email', 1);
        Id shellId = uploadFile(templateId, 'validated.html', '<html>{{CONTENT}}</html>');
        ChannelTemplateController.classifyUploadedFiles(
            templateId, new List<Id>{ shellId }, 'SHELL_HTML'
        );
        attachManifest(templateId, 'email.validated', 'Email', 'email-preview@1');

        Test.startTest();
        ChannelTemplateController.ValidationResponse response =
            ChannelTemplateController.validateTemplate(templateId);
        Test.stopTest();

        Channel_Template__c template = [
            SELECT Package_Id__c, SemVer__c, Package_Hash__c,
                   Compiler_Version__c, Validation_Status__c
            FROM Channel_Template__c
            WHERE Id = :templateId
        ];
        System.assertEquals(true, response.valid);
        System.assertEquals('email.validated', template.Package_Id__c);
        System.assertEquals('1.0.0', template.SemVer__c);
        System.assertEquals(64, template.Package_Hash__c.length());
        System.assertEquals('email-preview@1', template.Compiler_Version__c);
        System.assertEquals('Valid', template.Validation_Status__c);
    }

    @IsTest
    static void nonEmailTemplateCanActivateWithoutHtmlShell() {
        Id channelRecordTypeId = Schema.SObjectType.Marketing_Dictionary__c
            .getRecordTypeInfosByDeveloperName().get('Channel').getRecordTypeId();
        Marketing_Dictionary__c bannerChannel = new Marketing_Dictionary__c(
            Name = 'Web Main Banner',
            RecordTypeId = channelRecordTypeId,
            Channel_Type__c = 'Banner',
            Is_Active__c = true
        );
        insert bannerChannel;

        Id templateId = ChannelTemplateController.saveTemplate(
            new Channel_Template__c(Name = 'Main Banner', Status__c = 'Draft', Version__c = 1),
            bannerChannel.Id
        );
        attachManifest(templateId, 'banner.main', 'webBanner', 'banner-lwc@1');

        Test.startTest();
        ChannelTemplateController.saveTemplate(
            new Channel_Template__c(
                Id = templateId, Name = 'Main Banner', Status__c = 'Active', Version__c = 1
            ),
            bannerChannel.Id
        );
        Test.stopTest();

        System.assertEquals('Active', [
            SELECT Status__c FROM Channel_Template__c WHERE Id = :templateId
        ].Status__c);
    }

    @IsTest
    static void activePackageRejectsDirectDeleteAndNewFileVersion() {
        Marketing_Dictionary__c channel = [SELECT Id FROM Marketing_Dictionary__c LIMIT 1];
        Id templateId = createDraftTemplate(channel.Id, 'Immutable Email', 1);
        Id shellDocumentId = uploadFile(
            templateId,
            'immutable.html',
            '<html>{{CONTENT}}</html>'
        );
        ChannelTemplateController.classifyUploadedFiles(
            templateId, new List<Id>{ shellDocumentId }, 'SHELL_HTML'
        );
        attachManifest(templateId, 'email.immutable', 'Email', 'email-preview@1');
        ChannelTemplateController.saveTemplate(
            new Channel_Template__c(
                Id = templateId,
                Name = 'Immutable Email',
                Status__c = 'Active',
                Version__c = 1
            ),
            channel.Id
        );
        Id externalDocumentId = uploadFile(
            channel.Id,
            'external-reference.html',
            '<html>external</html>'
        );
        ContentDocumentLink shellLink = [
            SELECT Id, LinkedEntityId, ContentDocumentId
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :templateId
              AND ContentDocumentId = :shellDocumentId
            LIMIT 1
        ];

        Boolean deleteRejected = false;
        Boolean fileVersionRejected = false;
        Boolean linkInsertRejected = false;
        Boolean linkDeleteRejected = false;
        Test.startTest();
        try {
            delete new Channel_Template__c(Id = templateId);
        } catch (DmlException error) {
            deleteRejected = true;
        }
        try {
            insert new ContentVersion(
                Title = 'immutable-v2',
                PathOnClient = 'immutable-v2.html',
                VersionData = Blob.valueOf('<html>changed</html>'),
                ContentDocumentId = shellDocumentId
            );
        } catch (DmlException error) {
            fileVersionRejected = true;
        }
        try {
            insert new ContentDocumentLink(
                LinkedEntityId = templateId,
                ContentDocumentId = externalDocumentId,
                ShareType = 'V'
            );
        } catch (DmlException error) {
            linkInsertRejected = true;
        }
        try {
            delete shellLink;
        } catch (DmlException error) {
            linkDeleteRejected = true;
        }
        Test.stopTest();

        System.assertEquals(true, deleteRejected);
        System.assertEquals(true, fileVersionRejected);
        System.assertEquals(true, linkInsertRejected);
        System.assertEquals(true, linkDeleteRejected);
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

    private static Id attachManifest(
        Id templateId,
        String packageId,
        String channelKind,
        String compilerVersion
    ) {
        String manifest = JSON.serialize(new Map<String, Object>{
            'schemaVersion' => '1.0',
            'packageId' => packageId,
            'semver' => '1.0.0',
            'channelKind' => channelKind,
            'runtime' => new Map<String, Object>{ 'previewCompiler' => compilerVersion },
            'masterShell' => new Map<String, Object>{
                'injection' => new Map<String, Object>{
                    'fallbackPlaceholder' => '{{CONTENT}}'
                }
            },
            'contentBlocks' => new List<Object>()
        });
        Id documentId = uploadFile(templateId, 'template.manifest.json', manifest);
        String error = ChannelTemplateController.classifyUploadedFiles(
            templateId, new List<Id>{ documentId }, 'MANIFEST'
        );
        System.assertEquals(null, error);
        return documentId;
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
