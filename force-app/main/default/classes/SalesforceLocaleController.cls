/**
 * Salesforce's built-in locales (User.LocaleSidKey) for locale pickers.
 * Values keep the standard language_COUNTRY code (e.g. pl_PL); labels read "Language - Country".
 */
public with sharing class SalesforceLocaleController {

    public class LocaleOption implements Comparable {
        @AuraEnabled public String label;
        @AuraEnabled public String value;

        public LocaleOption(String label, String value) {
            this.label = label;
            this.value = value;
        }

        public Integer compareTo(Object other) {
            LocaleOption that = (LocaleOption) other;
            Integer byLabel = this.label.toLowerCase().compareTo(that.label.toLowerCase());
            return byLabel != 0 ? byLabel : this.value.compareTo(that.value);
        }
    }

    @AuraEnabled(cacheable=true)
    public static List<LocaleOption> getSalesforceLocales() {
        List<LocaleOption> options = new List<LocaleOption>();
        for (Schema.PicklistEntry entry : User.LocaleSidKey.getDescribe().getPicklistValues()) {
            if (!entry.isActive()) {
                continue;
            }
            String value = entry.getValue();
            String label = formatLocaleLabel(entry.getLabel());
            options.add(new LocaleOption(String.isBlank(label) ? value : label, value));
        }
        options.sort();
        return options;
    }

    /** True when the code is an active Salesforce locale (e.g. pl_PL). */
    public static Boolean isSupportedLocale(String code) {
        if (String.isBlank(code)) {
            return false;
        }
        for (Schema.PicklistEntry entry : User.LocaleSidKey.getDescribe().getPicklistValues()) {
            if (entry.isActive() && entry.getValue() == code) {
                return true;
            }
        }
        return false;
    }

    /**
     * "Polish (Poland)" -> "Polish - Poland".
     * "Serbian (Cyrillic) (Serbia)" -> "Serbian (Cyrillic) - Serbia" (the last group is the country).
     * "Chinese (Taiwan (Stroke))" -> "Chinese - Taiwan (Stroke)" (nested brackets stay inside the country).
     * A standalone language without brackets is returned as is.
     */
    public static String formatLocaleLabel(String rawLabel) {
        if (rawLabel == null) {
            return null;
        }
        String label = rawLabel.normalizeSpace();
        Integer firstOpen = label.indexOf('(');
        if (firstOpen < 0) {
            return label;
        }
        String language = label.substring(0, firstOpen).trim();

        List<String> groups = new List<String>();
        Integer depth = 0;
        Integer groupStart = -1;
        for (Integer i = firstOpen; i < label.length(); i++) {
            String ch = label.substring(i, i + 1);
            if (ch == '(') {
                if (depth == 0) {
                    groupStart = i + 1;
                }
                depth++;
            } else if (ch == ')' && depth > 0) {
                depth--;
                if (depth == 0) {
                    groups.add(label.substring(groupStart, i).trim());
                    groupStart = -1;
                }
            }
        }
        if (depth > 0 && groupStart >= 0) {
            groups.add(label.substring(groupStart).replace(')', '').trim());
        }

        List<String> parts = new List<String>();
        for (String g : groups) {
            if (String.isNotBlank(g)) {
                parts.add(g);
            }
        }
        if (parts.isEmpty()) {
            return String.isBlank(language) ? label : language;
        }
        if (String.isBlank(language)) {
            return String.join(parts, ' - ');
        }
        String country = parts.remove(parts.size() - 1);
        String qualifiers = '';
        for (String q : parts) {
            qualifiers += ' (' + q + ')';
        }
        return language + qualifiers + ' - ' + country;
    }
}
