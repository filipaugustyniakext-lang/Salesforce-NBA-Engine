public with sharing class ChannelTemplateManifestService {
    private static final String MANIFEST_PREFIX = '[MANIFEST]';
    private static final String SHELL_HTML_PREFIX = '[SHELL_HTML]';
    private static final Set<String> SOURCE_EXTENSIONS =
        new Set<String>{ 'json', 'html', 'css', 'js' };
    private static final Integer MAX_SOURCE_FILE_BYTES = 500000;
    private static final Integer MAX_PACKAGE_BYTES = 1500000;

    public class ValidationResult {
        public Boolean valid = false;
        public String message = '';
        public String manifestJson = '';
        public String packageId = '';
        public String semVer = '';
        public String compilerVersion = '';
        public String packageHash = '';
    }

    private class SourceAsset {
        Id documentId;
        Id versionId;
        String title;
        String extension;
        String fullName;
        Integer contentSize;
        String body;
    }

    public static ValidationResult validate(Id templateId, String channelType) {
        ValidationResult result = new ValidationResult();
        List<String> errors = new List<String>();
        if (templateId == null) {
            result.message = 'Template is required.';
            return result;
        }

        List<SourceAsset> assets = loadSourceAssets(templateId, errors);
        SourceAsset manifestAsset;
        SourceAsset shellHtmlAsset;
        Map<String, SourceAsset> assetsByName = new Map<String, SourceAsset>();
        Integer packageBytes = 0;

        for (SourceAsset asset : assets) {
            packageBytes += asset.contentSize == null ? 0 : asset.contentSize;
            assetsByName.put(asset.fullName.toLowerCase(), asset);
            if (asset.title.startsWith(MANIFEST_PREFIX)) {
                if (manifestAsset != null) errors.add('Only one template.manifest.json file is allowed.');
                manifestAsset = asset;
            }
            if (asset.title.startsWith(SHELL_HTML_PREFIX)) shellHtmlAsset = asset;
            if ((asset.extension == 'html' || asset.extension == 'css')
                && containsExecutableMarkup(asset.body)) {
                errors.add('Executable markup is not allowed in ' + asset.fullName + '.');
            }
        }
        if (packageBytes > MAX_PACKAGE_BYTES) {
            errors.add('Template package source files exceed the 1.5 MB validation limit.');
        }
        if (manifestAsset == null) {
            errors.add('Attach template.manifest.json before validating or activating this template.');
            return finish(result, errors, assets);
        }

        result.manifestJson = manifestAsset.body;
        Map<String, Object> manifest;
        try {
            manifest = (Map<String, Object>) JSON.deserializeUntyped(manifestAsset.body);
        } catch (Exception error) {
            errors.add('template.manifest.json is not valid JSON: ' + error.getMessage());
            return finish(result, errors, assets);
        }

        String schemaVersion = firstString(manifest, new List<String>{ 'schemaVersion', 'manifestVersion' });
        if (String.isBlank(schemaVersion) || !schemaVersion.startsWith('1.')) {
            errors.add('schemaVersion must use the supported 1.x contract.');
        }
        result.packageId = firstString(manifest, new List<String>{ 'packageId', 'templateKey' });
        if (String.isBlank(result.packageId)) errors.add('packageId is required.');
        result.semVer = firstString(manifest, new List<String>{ 'semver', 'version' });
        if (String.isBlank(result.semVer)
            || !Pattern.matches('^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$', result.semVer)) {
            errors.add('semver must use a value such as 1.0.0.');
        }

        String declaredChannel = firstString(manifest, new List<String>{ 'channelKind', 'channel' });
        if (String.isBlank(declaredChannel)) {
            errors.add('channelKind is required.');
        } else if (!channelMatches(channelType, declaredChannel)) {
            errors.add(
                'Manifest channel "' + declaredChannel + '" does not match dictionary channel type "'
                + channelType + '".'
            );
        }

        result.compilerVersion = nestedString(manifest, 'runtime', 'previewCompiler');
        if (String.isBlank(result.compilerVersion)) {
            result.compilerVersion = firstString(manifest, new List<String>{ 'compilerVersion', 'previewAdapter' });
        }
        if (!compilerAllowed(channelType, result.compilerVersion)) {
            errors.add('previewCompiler is missing or is not approved for this channel.');
        }

        String normalizedChannel = normalizeChannel(channelType);
        if (normalizedChannel == 'email') {
            validateEmailManifest(manifest, shellHtmlAsset, errors);
        }
        validateContentBlocks(manifest, assetsByName, errors);

        return finish(result, errors, assets);
    }

    public static void applyToTemplate(
        Channel_Template__c template,
        ValidationResult validation
    ) {
        template.Package_Id__c = validation.packageId;
        template.SemVer__c = validation.semVer;
        template.Package_Hash__c = validation.packageHash;
        template.Compiler_Version__c = validation.compilerVersion;
        template.Manifest_JSON__c = validation.manifestJson;
        template.Validation_Status__c = validation.valid ? 'Valid' : 'Invalid';
        template.Validation_Message__c = validation.message;
        template.Validated_At__c = System.now();
    }

    private static List<SourceAsset> loadSourceAssets(Id templateId, List<String> errors) {
        List<ContentDocumentLink> links = [
            SELECT ContentDocumentId, ContentDocument.Title,
                   ContentDocument.LatestPublishedVersionId,
                   ContentDocument.LatestPublishedVersion.FileExtension,
                   ContentDocument.LatestPublishedVersion.ContentSize
            FROM ContentDocumentLink
            WHERE LinkedEntityId = :templateId
            ORDER BY ContentDocument.Title ASC
        ];
        Set<Id> versionIds = new Set<Id>();
        for (ContentDocumentLink link : links) {
            String extension = String.valueOf(
                link.ContentDocument.LatestPublishedVersion.FileExtension
            ).toLowerCase();
            if (SOURCE_EXTENSIONS.contains(extension)) {
                versionIds.add(link.ContentDocument.LatestPublishedVersionId);
            }
        }
        Map<Id, ContentVersion> versions = versionIds.isEmpty()
            ? new Map<Id, ContentVersion>()
            : new Map<Id, ContentVersion>([
                SELECT Id, VersionData
                FROM ContentVersion
                WHERE Id IN :versionIds
            ]);

        List<SourceAsset> assets = new List<SourceAsset>();
        for (ContentDocumentLink link : links) {
            String extension = String.valueOf(
                link.ContentDocument.LatestPublishedVersion.FileExtension
            ).toLowerCase();
            if (!SOURCE_EXTENSIONS.contains(extension)) continue;
            Integer contentSize = link.ContentDocument.LatestPublishedVersion.ContentSize;
            if (contentSize != null && contentSize > MAX_SOURCE_FILE_BYTES) {
                errors.add(link.ContentDocument.Title + '.' + extension + ' exceeds the 1 MB source-file limit.');
                continue;
            }
            ContentVersion version = versions.get(link.ContentDocument.LatestPublishedVersionId);
            if (version == null || version.VersionData == null) continue;
            SourceAsset asset = new SourceAsset();
            asset.documentId = link.ContentDocumentId;
            asset.versionId = version.Id;
            asset.title = link.ContentDocument.Title;
            asset.extension = extension;
            asset.fullName = stripPrefix(asset.title) + '.' + extension;
            asset.contentSize = contentSize;
            try {
                asset.body = version.VersionData.toString();
            } catch (Exception error) {
                errors.add('Could not read ' + asset.fullName + ' as UTF-8 text.');
                asset.body = '';
            }
            assets.add(asset);
        }
        return assets;
    }

    private static void validateEmailManifest(
        Map<String, Object> manifest,
        SourceAsset shellHtmlAsset,
        List<String> errors
    ) {
        if (shellHtmlAsset == null || String.isBlank(shellHtmlAsset.body)) {
            errors.add('Email packages require one Shell HTML file.');
            return;
        }
        Map<String, Object> master = asMap(manifest.get('masterShell'));
        Map<String, Object> injection = asMap(master.get('injection'));
        String bodySlotKey = stringValue(injection.get('bodySlotKey'));
        String fallbackPlaceholder = stringValue(injection.get('fallbackPlaceholder'));
        if (String.isBlank(fallbackPlaceholder)) fallbackPlaceholder = '{{CONTENT}}';
        Boolean hasDeclaredSlot = String.isNotBlank(bodySlotKey)
            && shellHtmlAsset.body.contains('data-key="' + bodySlotKey + '"');
        Boolean hasFallback = shellHtmlAsset.body.contains(fallbackPlaceholder);
        if (!hasDeclaredSlot && !hasFallback) {
            errors.add('Email Shell HTML does not contain its declared BODY slot or fallback placeholder.');
        }
    }

    private static void validateContentBlocks(
        Map<String, Object> manifest,
        Map<String, SourceAsset> assetsByName,
        List<String> errors
    ) {
        Object rawBlocks = manifest.containsKey('contentBlocks')
            ? manifest.get('contentBlocks')
            : manifest.get('blocks');
        List<Object> blocks = rawBlocks instanceof List<Object>
            ? (List<Object>) rawBlocks
            : new List<Object>();
        Set<String> blockTypes = new Set<String>();
        for (Object rawBlock : blocks) {
            Map<String, Object> block = asMap(rawBlock);
            String type = firstString(block, new List<String>{ 'type', 'id' });
            String fileName = firstString(block, new List<String>{ 'fileName', 'shell', 'markup' });
            String rendererId = firstString(block, new List<String>{ 'rendererId', 'renderer' });
            if (String.isBlank(type)) {
                errors.add('Every content block requires a type.');
                continue;
            }
            if (blockTypes.contains(type.toLowerCase())) {
                errors.add('Content block type "' + type + '" is declared more than once.');
            }
            blockTypes.add(type.toLowerCase());
            if (String.isBlank(fileName)) {
                errors.add('Content block "' + type + '" requires a fileName.');
                continue;
            }
            SourceAsset asset = assetsByName.get(baseName(fileName).toLowerCase());
            if (asset == null) {
                errors.add('Content block "' + type + '" references missing file "' + fileName + '".');
                continue;
            }
            if (String.isBlank(rendererId)) {
                errors.add('Content block "' + type + '" requires a trusted rendererId.');
            }
            validatePlaceholders(type, block, asset.body, errors);
        }
    }

    private static void validatePlaceholders(
        String blockType,
        Map<String, Object> block,
        String source,
        List<String> errors
    ) {
        Set<String> declared = new Set<String>();
        Object rawPlaceholders = block.get('placeholders');
        if (rawPlaceholders instanceof List<Object>) {
            for (Object item : (List<Object>) rawPlaceholders) {
                String token = stringValue(item);
                if (String.isNotBlank(token)) declared.add(token);
            }
        }
        Matcher matcher = Pattern.compile('\\{\\{[A-Za-z0-9_.:\\-]+\\}\\}').matcher(source);
        while (matcher.find()) {
            String token = matcher.group(0);
            if (!declared.contains(token)) {
                errors.add('Block "' + blockType + '" uses undeclared placeholder ' + token + '.');
            }
        }
        for (String token : declared) {
            if (!source.contains(token)) {
                errors.add('Block "' + blockType + '" declares placeholder ' + token + ' but its file does not use it.');
            }
        }
    }

    private static ValidationResult finish(
        ValidationResult result,
        List<String> errors,
        List<SourceAsset> assets
    ) {
        result.valid = errors.isEmpty();
        result.message = result.valid ? 'Package is valid.' : String.join(errors, '\n');
        if (result.valid) result.packageHash = packageHash(assets);
        return result;
    }

    private static String packageHash(List<SourceAsset> assets) {
        List<String> digestLines = new List<String>();
        for (SourceAsset asset : assets) {
            String fileHash = EncodingUtil.convertToHex(
                Crypto.generateDigest('SHA-256', Blob.valueOf(asset.body))
            ).toLowerCase();
            digestLines.add(asset.fullName.toLowerCase() + ':' + fileHash);
        }
        digestLines.sort();
        Blob digest = Crypto.generateDigest(
            'SHA-256',
            Blob.valueOf(String.join(digestLines, '\n'))
        );
        return EncodingUtil.convertToHex(digest).toLowerCase();
    }

    private static Boolean containsExecutableMarkup(String source) {
        String value = String.valueOf(source);
        return Pattern.compile('(?i)<\\s*script\\b').matcher(value).find()
            || Pattern.compile('(?i)\\son[a-z]+\\s*=').matcher(value).find()
            || Pattern.compile('(?i)javascript\\s*:').matcher(value).find();
    }

    private static Boolean compilerAllowed(String channelType, String compilerVersion) {
        String channel = normalizeChannel(channelType);
        Map<String, Set<String>> allowed = new Map<String, Set<String>>{
            'email' => new Set<String>{ 'email-preview@1' },
            'banner' => new Set<String>{ 'banner-lwc@1' },
            'push' => new Set<String>{ 'push-device@1' },
            'sms' => new Set<String>{ 'sms-preview@1' }
        };
        if (!allowed.containsKey(channel)) return compilerVersion == 'generic-preview@1';
        return allowed.get(channel).contains(compilerVersion);
    }

    private static Boolean channelMatches(String channelType, String declaredChannel) {
        String expected = normalizeChannel(channelType);
        String actual = normalizeChannel(declaredChannel);
        if (expected == 'banner') return actual == 'banner' || actual == 'webbanner';
        return expected == actual;
    }

    private static String normalizeChannel(String value) {
        String normalized = String.valueOf(value).toLowerCase().replaceAll('[^a-z0-9]', '');
        if (normalized == 'webbanner') return 'banner';
        return normalized;
    }

    private static String firstString(Map<String, Object> values, List<String> keys) {
        for (String key : keys) {
            String value = stringValue(values.get(key));
            if (String.isNotBlank(value)) return value;
        }
        return '';
    }

    private static String nestedString(Map<String, Object> values, String parent, String child) {
        return stringValue(asMap(values.get(parent)).get(child));
    }

    private static Map<String, Object> asMap(Object value) {
        return value instanceof Map<String, Object>
            ? (Map<String, Object>) value
            : new Map<String, Object>();
    }

    private static String stringValue(Object value) {
        return value == null ? '' : String.valueOf(value).trim();
    }

    private static String stripPrefix(String title) {
        String value = String.valueOf(title);
        Integer close = value.indexOf(']');
        return value.startsWith('[') && close >= 0
            ? value.substring(close + 1).trim()
            : value.trim();
    }

    private static String baseName(String path) {
        String normalized = String.valueOf(path).replace('\\', '/');
        Integer slash = normalized.lastIndexOf('/');
        return slash >= 0 ? normalized.substring(slash + 1) : normalized;
    }
}
