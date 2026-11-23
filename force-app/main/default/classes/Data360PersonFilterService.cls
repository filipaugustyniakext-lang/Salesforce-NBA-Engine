/**
 * Person values (Customer Type and Audience Type) are defined by a filter on the Data360 DMO UnifiedIndividual__dlm,
 * which has one row per unified person (the Individual DMO holds a row per source record, so customers coming from
 * GCP_CUSTOMER, their CRM Person Accounts and Contacts would be counted several times).
 * The filter is stored as JSON on Marketing_Dictionary__c.Data360_Filter_JSON__c:
 *   { "version": 1, "dmo": "UnifiedIndividual__dlm", "logic": "AND|OR", "conditions": [
 *       { "field": "Profile_Type__c", "type": "text", "operator": "eq", "value": "B2C" },
 *       { "logic": "OR", "conditions": [ ... ] } ] }
 * Operators: eq neq gt gte lt lte between in notIn contains startsWith endsWith isNull isNotNull.
 * Types: text number date timestamp boolean. Values are never concatenated raw: each is parsed for its declared
 * type and rendered as a literal, so the generated SQL is safe whatever the JSON contains.
 */
public with sharing class Data360PersonFilterService {
    public static final String DEFAULT_DMO = 'UnifiedIndividual__dlm';
    public static final Integer MAX_CONDITIONS = 25;
    public static final Integer MAX_VALUES = 100;
    public static final Integer MAX_VALUE_LENGTH = 255;
    public static final Integer MAX_JSON_LENGTH = 30000;

    public class FilterException extends Exception {}

    /** Runs a COUNT(*) statement against Data360. Replaced in tests, because ConnectApi cannot be mocked. */
    public interface QueryExecutor {
        Long count(String sql);
    }

    @TestVisible private static QueryExecutor executor = new CdpExecutor();

    private static final Pattern COLUMN_PATTERN = Pattern.compile('^[A-Za-z][A-Za-z0-9_]{0,79}$');
    private static final Pattern NUMBER_PATTERN = Pattern.compile('^-?\\d{1,18}(\\.\\d{1,10})?$');
    private static final Pattern DATE_PATTERN = Pattern.compile('^(\\d{4})-(\\d{2})-(\\d{2})$');
    private static final Pattern DATE_TIME_PATTERN = Pattern.compile('^(\\d{4}-\\d{2}-\\d{2})[ T](\\d{2}):(\\d{2})(?::(\\d{2}))?$');
    private static final String LIKE_ESCAPE = ' ESCAPE \'\\\'';

    private static final Set<String> TEXT_OPERATORS = new Set<String>{
        'eq', 'neq', 'in', 'notIn', 'contains', 'startsWith', 'endsWith', 'isNull', 'isNotNull'
    };
    private static final Set<String> NUMBER_OPERATORS = new Set<String>{
        'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn', 'isNull', 'isNotNull'
    };
    private static final Set<String> DATE_OPERATORS = new Set<String>{
        'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull', 'isNotNull'
    };
    private static final Set<String> BOOLEAN_OPERATORS = new Set<String>{ 'eq', 'isNull', 'isNotNull' };
    private static final Map<String, String> COMPARISON_SQL = new Map<String, String>{
        'eq' => '=', 'neq' => '<>', 'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<='
    };

    private class Counter {
        Integer conditions = 0;
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /** Throws FilterException when the filter is not valid. A blank filter is valid (no filter). */
    public static void validate(String filterJson) {
        if (String.isNotBlank(filterJson)) {
            buildCountSql(filterJson);
        }
    }

    public static String buildCountSql(String filterJson) {
        Map<String, Object> root = parseRoot(filterJson);
        Counter counter = new Counter();
        String clause = buildGroup(root, 0, counter);
        return 'SELECT COUNT(*) AS cnt FROM ' + DEFAULT_DMO + ' WHERE ' + clause;
    }

    public static Long count(String filterJson) {
        return executor.count(buildCountSql(filterJson));
    }

    public static Long totalCount() {
        return executor.count('SELECT COUNT(*) AS cnt FROM ' + DEFAULT_DMO);
    }

    // ─── Parsing ─────────────────────────────────────────────────────────────

    private static Map<String, Object> parseRoot(String filterJson) {
        if (String.isBlank(filterJson)) {
            throw new FilterException('No filter is defined.');
        }
        if (filterJson.length() > MAX_JSON_LENGTH) {
            throw new FilterException('The filter is too large.');
        }
        Object parsed;
        try {
            parsed = JSON.deserializeUntyped(filterJson);
        } catch (Exception e) {
            throw new FilterException('The filter is not valid JSON.');
        }
        if (!(parsed instanceof Map<String, Object>)) {
            throw new FilterException('The filter must be a JSON object.');
        }
        Map<String, Object> root = (Map<String, Object>) parsed;
        Object version = root.get('version');
        if (version != null && String.valueOf(version) != '1') {
            throw new FilterException('Unsupported filter version ' + version + '.');
        }
        Object dmo = root.get('dmo');
        if (dmo != null && String.valueOf(dmo) != DEFAULT_DMO) {
            throw new FilterException(
                'This filter was built on ' + safeLabel(String.valueOf(dmo)) + '. Filters now use ' + DEFAULT_DMO
                + ' (one row per unified person): open the value and rebuild the filter.'
            );
        }
        return root;
    }

    private static String buildGroup(Map<String, Object> node, Integer depth, Counter counter) {
        String logic = node.get('logic') == null ? 'AND' : String.valueOf(node.get('logic')).toUpperCase();
        if (logic != 'AND' && logic != 'OR') {
            throw new FilterException('Group logic must be AND or OR.');
        }
        Object rawConditions = node.get('conditions');
        if (!(rawConditions instanceof List<Object>) || ((List<Object>) rawConditions).isEmpty()) {
            throw new FilterException('Add at least one condition' + (depth > 0 ? ' to every group.' : '.'));
        }
        List<String> parts = new List<String>();
        for (Object item : (List<Object>) rawConditions) {
            if (!(item instanceof Map<String, Object>)) {
                throw new FilterException('A condition is not valid.');
            }
            Map<String, Object> child = (Map<String, Object>) item;
            if (child.containsKey('conditions')) {
                if (depth >= 1) {
                    throw new FilterException('Groups can only be nested once.');
                }
                parts.add('(' + buildGroup(child, depth + 1, counter) + ')');
            } else {
                counter.conditions++;
                if (counter.conditions > MAX_CONDITIONS) {
                    throw new FilterException('A filter can have at most ' + MAX_CONDITIONS + ' conditions.');
                }
                parts.add(buildCondition(child));
            }
        }
        return String.join(parts, ' ' + logic + ' ');
    }

    // ─── Conditions ──────────────────────────────────────────────────────────

    private static String buildCondition(Map<String, Object> node) {
        String field = text(node.get('field'));
        if (String.isBlank(field) || !COLUMN_PATTERN.matcher(field).matches()) {
            throw new FilterException('"' + safeLabel(field) + '" is not a valid column name.');
        }
        String type = String.isBlank(text(node.get('type'))) ? 'text' : text(node.get('type')).toLowerCase();
        Set<String> allowed = operatorsFor(type);
        String operator = text(node.get('operator'));
        if (!allowed.contains(operator)) {
            throw new FilterException('The operator "' + safeLabel(operator) + '" cannot be used on ' + type + ' column ' + field + '.');
        }
        if (operator == 'isNull') {
            return field + ' IS NULL';
        }
        if (operator == 'isNotNull') {
            return field + ' IS NOT NULL';
        }
        if (operator == 'in' || operator == 'notIn') {
            List<String> values = listValues(node);
            List<String> literals = new List<String>();
            for (String raw : values) {
                literals.add(literal(type, raw, field));
            }
            return field + (operator == 'in' ? ' IN (' : ' NOT IN (') + String.join(literals, ', ') + ')';
        }
        String value = requiredValue(node.get('value'), field);
        if (operator == 'contains' || operator == 'startsWith' || operator == 'endsWith') {
            String pattern = escapeLike(value.toLowerCase());
            String sqlPattern = operator == 'contains' ? '%' + pattern + '%' : operator == 'startsWith' ? pattern + '%' : '%' + pattern;
            return 'LOWER(' + field + ') LIKE ' + quote(sqlPattern) + LIKE_ESCAPE;
        }
        if (type == 'timestamp' && isDateOnly(value)) {
            return timestampByDay(field, operator, value, operator == 'between' ? requiredValue(node.get('value2'), field) : null);
        }
        if (operator == 'between') {
            String upper = requiredValue(node.get('value2'), field);
            return field + ' BETWEEN ' + literal(type, value, field) + ' AND ' + literal(type, upper, field);
        }
        return field + ' ' + COMPARISON_SQL.get(operator) + ' ' + literal(type, value, field);
    }

    private static Set<String> operatorsFor(String type) {
        if (type == 'text') return TEXT_OPERATORS;
        if (type == 'number') return NUMBER_OPERATORS;
        if (type == 'date' || type == 'timestamp') return DATE_OPERATORS;
        if (type == 'boolean') return BOOLEAN_OPERATORS;
        throw new FilterException('Unknown column type "' + safeLabel(type) + '".');
    }

    /** A timestamp compared with a date means the whole day, not midnight. */
    private static String timestampByDay(String field, String operator, String value, String upperValue) {
        Date day = parseDate(value, field);
        String start = timestampLiteral(day, '00:00:00');
        String next = timestampLiteral(day.addDays(1), '00:00:00');
        if (operator == 'eq') return '(' + field + ' >= ' + start + ' AND ' + field + ' < ' + next + ')';
        if (operator == 'neq') return '(' + field + ' < ' + start + ' OR ' + field + ' >= ' + next + ')';
        if (operator == 'gt') return field + ' >= ' + next;
        if (operator == 'gte') return field + ' >= ' + start;
        if (operator == 'lt') return field + ' < ' + start;
        if (operator == 'lte') return field + ' < ' + next;
        Date lastDay = isDateOnly(upperValue) ? parseDate(upperValue, field) : null;
        if (lastDay == null) {
            throw new FilterException('Both values of a range on ' + field + ' must be dates, or both date and time.');
        }
        return '(' + field + ' >= ' + start + ' AND ' + field + ' < ' + timestampLiteral(lastDay.addDays(1), '00:00:00') + ')';
    }

    // ─── Literals ────────────────────────────────────────────────────────────

    private static String literal(String type, String raw, String field) {
        if (type == 'text') {
            return quote(raw);
        }
        if (type == 'number') {
            if (!NUMBER_PATTERN.matcher(raw).matches()) {
                throw new FilterException('"' + safeLabel(raw) + '" is not a number (column ' + field + ').');
            }
            return Decimal.valueOf(raw).toPlainString();
        }
        if (type == 'boolean') {
            String lower = raw.toLowerCase();
            if (lower != 'true' && lower != 'false') {
                throw new FilterException('"' + safeLabel(raw) + '" is not true or false (column ' + field + ').');
            }
            return lower;
        }
        if (type == 'date') {
            Date day = parseDate(raw, field);
            return 'DATE \'' + dateText(day) + '\'';
        }
        return timestampFromText(raw, field);
    }

    private static String timestampFromText(String raw, String field) {
        if (isDateOnly(raw)) {
            return timestampLiteral(parseDate(raw, field), '00:00:00');
        }
        Matcher matcher = DATE_TIME_PATTERN.matcher(raw);
        if (!matcher.matches()) {
            throw new FilterException('"' + safeLabel(raw) + '" is not a date and time such as 2026-10-01 08:30 (column ' + field + ').');
        }
        Integer hours = Integer.valueOf(matcher.group(2));
        Integer minutes = Integer.valueOf(matcher.group(3));
        Integer seconds = matcher.group(4) == null ? 0 : Integer.valueOf(matcher.group(4));
        if (hours > 23 || minutes > 59 || seconds > 59) {
            throw new FilterException('"' + safeLabel(raw) + '" is not a valid time (column ' + field + ').');
        }
        Date day = parseDate(matcher.group(1), field);
        return timestampLiteral(day, pad(hours) + ':' + pad(minutes) + ':' + pad(seconds));
    }

    private static Boolean isDateOnly(String value) {
        return value != null && DATE_PATTERN.matcher(value).matches();
    }

    private static Date parseDate(String raw, String field) {
        if (!isDateOnly(raw)) {
            throw new FilterException('"' + safeLabel(raw) + '" is not a date such as 2026-10-01 (column ' + field + ').');
        }
        try {
            return Date.valueOf(raw);
        } catch (Exception e) {
            throw new FilterException('"' + safeLabel(raw) + '" is not a valid date (column ' + field + ').');
        }
    }

    private static String timestampLiteral(Date day, String clock) {
        return 'TIMESTAMP \'' + dateText(day) + ' ' + clock + '\'';
    }

    private static String dateText(Date day) {
        return String.valueOf(day.year()).leftPad(4, '0') + '-' + pad(day.month()) + '-' + pad(day.day());
    }

    private static String pad(Integer value) {
        return String.valueOf(value).leftPad(2, '0');
    }

    /** Single-quoted text literal: quotes are doubled, control characters are refused. */
    private static String quote(String raw) {
        if (raw == null) {
            return '\'\'';
        }
        if (raw.length() > MAX_VALUE_LENGTH) {
            throw new FilterException('A value is longer than ' + MAX_VALUE_LENGTH + ' characters.');
        }
        for (Integer index = 0; index < raw.length(); index++) {
            if (raw.charAt(index) < 32) {
                throw new FilterException('Values cannot contain line breaks or control characters.');
            }
        }
        return '\'' + raw.replace('\'', '\'\'') + '\'';
    }

    private static String escapeLike(String raw) {
        return raw.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_');
    }

    // ─── Value helpers ───────────────────────────────────────────────────────

    private static String text(Object value) {
        return value == null ? null : String.valueOf(value).trim();
    }

    private static String requiredValue(Object value, String field) {
        String result = text(value);
        if (String.isBlank(result)) {
            throw new FilterException('Enter a value for ' + field + '.');
        }
        return result;
    }

    private static List<String> listValues(Map<String, Object> node) {
        List<String> values = new List<String>();
        Object rawValues = node.get('values');
        if (rawValues instanceof List<Object>) {
            for (Object item : (List<Object>) rawValues) {
                String entry = text(item);
                if (String.isNotBlank(entry)) values.add(entry);
            }
        } else if (String.isNotBlank(text(node.get('value')))) {
            for (String entry : text(node.get('value')).split('[,\\n]')) {
                if (String.isNotBlank(entry.trim())) values.add(entry.trim());
            }
        }
        if (values.isEmpty()) {
            throw new FilterException('Enter at least one value for ' + text(node.get('field')) + '.');
        }
        if (values.size() > MAX_VALUES) {
            throw new FilterException('At most ' + MAX_VALUES + ' values can be listed.');
        }
        return values;
    }

    private static String safeLabel(String value) {
        if (value == null) return '';
        String clean = value.replaceAll('[\\r\\n]', ' ');
        return clean.length() > 40 ? clean.substring(0, 40) + '...' : clean;
    }

    // ─── Data360 ─────────────────────────────────────────────────────────────

    /** Default data space first; other data spaces only when the object is not found there. */
    public class CdpExecutor implements QueryExecutor {
        public Long count(String sql) {
            try {
                return run(sql, null);
            } catch (ConnectApi.ConnectApiException e) {
                if (!isMissingObject(e.getMessage())) {
                    throw new FilterException(readableError(e.getMessage()));
                }
            }
            for (String space : MarketingDictionaryManagerController.dataSpaceApiNames()) {
                if (space == null || space.equalsIgnoreCase('default')) {
                    continue;
                }
                try {
                    return run(sql, space);
                } catch (ConnectApi.ConnectApiException e) {
                    if (!isMissingObject(e.getMessage())) {
                        throw new FilterException(readableError(e.getMessage()));
                    }
                }
            }
            throw new FilterException(DEFAULT_DMO + ' was not found in any data space.');
        }

        private Long run(String sql, String spaceName) {
            ConnectApi.CdpQueryInput input = new ConnectApi.CdpQueryInput();
            input.sql = sql;
            ConnectApi.CdpQueryOutputV2 output = spaceName == null
                ? ConnectApi.CdpQuery.queryAnsiSqlV2(input)
                : ConnectApi.CdpQuery.queryAnsiSqlV2(input, spaceName);
            if (output == null || output.data == null || output.data.isEmpty()) {
                throw new FilterException('Data360 returned no result.');
            }
            ConnectApi.CdpQueryV2Row row = (ConnectApi.CdpQueryV2Row) output.data[0];
            if (row == null || row.rowData == null || row.rowData.isEmpty() || !(row.rowData[0] instanceof Decimal)) {
                throw new FilterException('Data360 returned an unexpected result.');
            }
            return ((Decimal) row.rowData[0]).longValue();
        }
    }

    @TestVisible
    private static Boolean isMissingObject(String message) {
        return message != null && message.contains('NOT_FOUND') && message.contains('DataModelEntity');
    }

    /** Data360 wraps the reason in a JSON document with trace ids; keep only the reason. */
    @TestVisible
    private static String readableError(String message) {
        String reason = message == null ? 'The Data360 query failed.' : message;
        try {
            Object parsed = JSON.deserializeUntyped(message);
            if (parsed instanceof Map<String, Object> && ((Map<String, Object>) parsed).get('message') != null) {
                reason = String.valueOf(((Map<String, Object>) parsed).get('message'));
            }
        } catch (Exception e) {
            // Not a JSON document: keep the text as it is.
        }
        Integer trace = reason.indexOf(' [TraceId');
        if (trace > 0) {
            reason = reason.substring(0, trace);
        }
        return reason.replace('INVALID_ARGUMENT: ', '').left(300);
    }
}
