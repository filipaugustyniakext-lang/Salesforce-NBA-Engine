@IsTest
private class SalesforceLocaleControllerTest {

    private static User englishUser() {
        User u = new User(
            ProfileId = UserInfo.getProfileId(),
            Alias = 'loctest',
            Email = 'locale.test@example.com',
            EmailEncodingKey = 'UTF-8',
            LastName = 'Locale Test',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            TimeZoneSidKey = 'Europe/Warsaw',
            Username = 'locale.test.' + String.valueOf(Crypto.getRandomInteger()).replace('-', '') + '@example.com'
        );
        insert u;
        return u;
    }

    private static Map<String, String> labelsByValue(List<SalesforceLocaleController.LocaleOption> options) {
        Map<String, String> result = new Map<String, String>();
        for (SalesforceLocaleController.LocaleOption opt : options) {
            result.put(opt.value, opt.label);
        }
        return result;
    }

    @IsTest
    static void returnsActiveLocalesWithStandardCodes() {
        Set<String> active = new Set<String>();
        for (Schema.PicklistEntry entry : User.LocaleSidKey.getDescribe().getPicklistValues()) {
            if (entry.isActive()) {
                active.add(entry.getValue());
            }
        }

        List<SalesforceLocaleController.LocaleOption> options;
        System.runAs(englishUser()) {
            Test.startTest();
            options = SalesforceLocaleController.getSalesforceLocales();
            Test.stopTest();
        }

        System.assertEquals(active.size(), options.size(), 'Every active locale must be returned once.');
        Pattern code = Pattern.compile('^[a-z]{2,3}(_[A-Za-z0-9]+)+$');
        for (SalesforceLocaleController.LocaleOption opt : options) {
            System.assert(active.contains(opt.value), 'Only active locales: ' + opt.value);
            System.assert(code.matcher(opt.value).matches(), 'Expected language_COUNTRY code, got ' + opt.value);
            System.assert(String.isNotBlank(opt.label), 'Label missing for ' + opt.value);
        }
        Map<String, String> labels = labelsByValue(options);
        System.assertEquals('Polish - Poland', labels.get('pl_PL'));
        System.assertEquals('English - United Kingdom', labels.get('en_GB'));
        System.assertEquals('Italian - Italy', labels.get('it_IT'));
    }

    @IsTest
    static void sortsAlphabeticallyByLabel() {
        List<SalesforceLocaleController.LocaleOption> options;
        System.runAs(englishUser()) {
            options = SalesforceLocaleController.getSalesforceLocales();
        }
        for (Integer i = 1; i < options.size(); i++) {
            System.assert(
                options[i - 1].label.toLowerCase().compareTo(options[i].label.toLowerCase()) <= 0,
                options[i - 1].label + ' should sort before ' + options[i].label
            );
        }
    }

    @IsTest
    static void formatsLabelsAsLanguageDashCountry() {
        System.assertEquals('Polish - Poland', SalesforceLocaleController.formatLocaleLabel('Polish (Poland)'));
        System.assertEquals('English - United States', SalesforceLocaleController.formatLocaleLabel('English (United States)'));
        System.assertEquals('Spanish - Latin America', SalesforceLocaleController.formatLocaleLabel('Spanish (Latin America)'));
        System.assertEquals(
            'Serbian (Cyrillic) - Serbia',
            SalesforceLocaleController.formatLocaleLabel('Serbian (Cyrillic) (Serbia)')
        );
        System.assertEquals('Chinese - Taiwan (Stroke)', SalesforceLocaleController.formatLocaleLabel('Chinese (Taiwan (Stroke))'));
        System.assertEquals('Esperanto', SalesforceLocaleController.formatLocaleLabel('Esperanto'));
        System.assertEquals('German - Austria', SalesforceLocaleController.formatLocaleLabel('German  (Austria'));
        System.assertEquals('Basque', SalesforceLocaleController.formatLocaleLabel('Basque ()'));
        System.assertEquals(null, SalesforceLocaleController.formatLocaleLabel(null));
    }

    @IsTest
    static void recognisesSupportedCodes() {
        System.assertEquals(true, SalesforceLocaleController.isSupportedLocale('pl_PL'));
        System.assertEquals(false, SalesforceLocaleController.isSupportedLocale('pl-PL'));
        System.assertEquals(false, SalesforceLocaleController.isSupportedLocale(''));
    }
}
