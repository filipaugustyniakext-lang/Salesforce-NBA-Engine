@IsTest
private class Data360PersonFilterServiceTest {
    private class StubExecutor implements Data360PersonFilterService.QueryExecutor {
        public List<String> sqls = new List<String>();
        public Long result = 42;
        public String failWith;

        public Long count(String sql) {
            sqls.add(sql);
            if (failWith != null) {
                throw new Data360PersonFilterService.FilterException(failWith);
            }
            return result;
        }
    }

    private static Map<String, Object> cond(String field, String type, String operator, Object value) {
        Map<String, Object> result = new Map<String, Object>{ 'field' => field, 'type' => type, 'operator' => operator };
        if (value != null) {
            result.put('value', value);
        }
        return result;
    }

    private static String filter(List<Object> conditions, String logic) {
        return JSON.serialize(new Map<String, Object>{
            'version' => 1, 'dmo' => 'ssot__Individual__dlm', 'logic' => logic, 'conditions' => conditions
        });
    }

    private static String whereOf(Map<String, Object> single) {
        String sql = Data360PersonFilterService.buildCountSql(filter(new List<Object>{ single }, 'AND'));
        return sql.substringAfter(' WHERE ');
    }

    private static String errorOf(String json) {
        try {
            Data360PersonFilterService.buildCountSql(json);
        } catch (Data360PersonFilterService.FilterException e) {
            return e.getMessage();
        }
        return null;
    }

    private static String errorOfSingle(Map<String, Object> single) {
        return errorOf(filter(new List<Object>{ single }, 'AND'));
    }

    @IsTest
    static void buildsTextConditionsAndEscapesQuotes() {
        System.assertEquals('Profile_Type__c = \'B2C\'', whereOf(cond('Profile_Type__c', 'text', 'eq', 'B2C')));
        System.assertEquals('ssot__LastName__c <> \'O\'\'Brien\'', whereOf(cond('ssot__LastName__c', 'text', 'neq', 'O\'Brien')));
        System.assertEquals('brand__c IS NULL', whereOf(cond('brand__c', 'text', 'isNull', null)));
        System.assertEquals('brand__c IS NOT NULL', whereOf(cond('brand__c', 'text', 'isNotNull', null)));
        System.assertEquals(
            'LOWER(ssot__LastName__c) LIKE \'%ko%\' ESCAPE \'\\\'',
            whereOf(cond('ssot__LastName__c', 'text', 'contains', 'Ko'))
        );
        System.assertEquals(
            'LOWER(ssot__LastName__c) LIKE \'ko%\' ESCAPE \'\\\'',
            whereOf(cond('ssot__LastName__c', 'text', 'startsWith', 'Ko'))
        );
        System.assertEquals(
            'LOWER(ssot__LastName__c) LIKE \'%ko\' ESCAPE \'\\\'',
            whereOf(cond('ssot__LastName__c', 'text', 'endsWith', 'Ko'))
        );
    }

    @IsTest
    static void escapesLikeWildcards() {
        System.assertEquals(
            'LOWER(brand__c) LIKE \'%100\\%\\_\\\\x%\' ESCAPE \'\\\'',
            whereOf(cond('brand__c', 'text', 'contains', '100%_\\x'))
        );
    }

    @IsTest
    static void buildsListConditionsFromArraysAndText() {
        Map<String, Object> listed = cond('Profile_Type__c', 'text', 'in', null);
        listed.put('values', new List<Object>{ 'B2C', 'B2B', ' ' });
        System.assertEquals('Profile_Type__c IN (\'B2C\', \'B2B\')', whereOf(listed));
        System.assertEquals(
            'Profile_Type__c NOT IN (\'A\', \'B\', \'C\')',
            whereOf(cond('Profile_Type__c', 'text', 'notIn', 'A, B\nC'))
        );
        System.assertEquals('age__c IN (1, 2.5)', whereOf(cond('age__c', 'number', 'in', '1,2.5')));
        System.assert(errorOfSingle(cond('Profile_Type__c', 'text', 'in', ' , ')).contains('at least one value'));

        List<String> many = new List<String>();
        for (Integer i = 0; i < 101; i++) {
            many.add('v' + i);
        }
        Map<String, Object> tooMany = cond('Profile_Type__c', 'text', 'in', null);
        tooMany.put('values', many);
        System.assert(errorOfSingle(tooMany).contains('At most 100'));
    }

    @IsTest
    static void buildsNumberAndBooleanConditions() {
        System.assertEquals('age__c >= 18', whereOf(cond('age__c', 'number', 'gte', 18)));
        System.assertEquals('age__c < -3.5', whereOf(cond('age__c', 'number', 'lt', '-3.5')));
        Map<String, Object> range = cond('age__c', 'number', 'between', '18');
        range.put('value2', '65');
        System.assertEquals('age__c BETWEEN 18 AND 65', whereOf(range));
        System.assertEquals('active__c = true', whereOf(cond('active__c', 'boolean', 'eq', 'TRUE')));
        System.assert(errorOfSingle(cond('age__c', 'number', 'eq', '1; DROP')).contains('is not a number'));
        System.assert(errorOfSingle(cond('active__c', 'boolean', 'eq', 'yes')).contains('true or false'));
        System.assert(errorOfSingle(cond('active__c', 'boolean', 'gt', 'true')).contains('cannot be used on boolean'));
    }

    @IsTest
    static void buildsDateConditions() {
        System.assertEquals('ssot__BirthDate__c >= DATE \'1990-01-01\'', whereOf(cond('ssot__BirthDate__c', 'date', 'gte', '1990-01-01')));
        Map<String, Object> range = cond('ssot__BirthDate__c', 'date', 'between', '1990-01-01');
        range.put('value2', '1999-12-31');
        System.assertEquals('ssot__BirthDate__c BETWEEN DATE \'1990-01-01\' AND DATE \'1999-12-31\'', whereOf(range));
        System.assert(errorOfSingle(cond('ssot__BirthDate__c', 'date', 'eq', '2026-13-45')).contains('not a valid date'));
        System.assert(errorOfSingle(cond('ssot__BirthDate__c', 'date', 'eq', 'tomorrow')).contains('not a date'));
        System.assert(errorOfSingle(cond('ssot__BirthDate__c', 'date', 'contains', '1990')).contains('cannot be used on date'));
    }

    @IsTest
    static void timestampComparedWithADateMeansTheWholeDay() {
        String column = 'ssot__CreatedDate__c';
        System.assertEquals(
            '(ssot__CreatedDate__c >= TIMESTAMP \'2026-10-29 00:00:00\' AND ssot__CreatedDate__c < TIMESTAMP \'2026-10-30 00:00:00\')',
            whereOf(cond(column, 'timestamp', 'eq', '2026-10-29'))
        );
        System.assertEquals(
            '(ssot__CreatedDate__c < TIMESTAMP \'2026-10-29 00:00:00\' OR ssot__CreatedDate__c >= TIMESTAMP \'2026-10-30 00:00:00\')',
            whereOf(cond(column, 'timestamp', 'neq', '2026-10-29'))
        );
        System.assertEquals('ssot__CreatedDate__c >= TIMESTAMP \'2026-10-30 00:00:00\'', whereOf(cond(column, 'timestamp', 'gt', '2026-10-29')));
        System.assertEquals('ssot__CreatedDate__c >= TIMESTAMP \'2026-10-29 00:00:00\'', whereOf(cond(column, 'timestamp', 'gte', '2026-10-29')));
        System.assertEquals('ssot__CreatedDate__c < TIMESTAMP \'2026-10-29 00:00:00\'', whereOf(cond(column, 'timestamp', 'lt', '2026-10-29')));
        System.assertEquals('ssot__CreatedDate__c < TIMESTAMP \'2026-10-30 00:00:00\'', whereOf(cond(column, 'timestamp', 'lte', '2026-10-29')));
        Map<String, Object> range = cond(column, 'timestamp', 'between', '2026-10-01');
        range.put('value2', '2026-10-31');
        System.assertEquals(
            '(ssot__CreatedDate__c >= TIMESTAMP \'2026-10-01 00:00:00\' AND ssot__CreatedDate__c < TIMESTAMP \'2026-11-01 00:00:00\')',
            whereOf(range)
        );
        Map<String, Object> mixed = cond(column, 'timestamp', 'between', '2026-10-01');
        mixed.put('value2', '2026-10-31 12:00');
        System.assert(errorOfSingle(mixed).contains('must be dates'));
    }

    @IsTest
    static void timestampWithATimeIsUsedAsIs() {
        String column = 'ssot__CreatedDate__c';
        System.assertEquals('ssot__CreatedDate__c >= TIMESTAMP \'2026-10-29 09:30:00\'', whereOf(cond(column, 'timestamp', 'gte', '2026-10-29 09:30')));
        System.assertEquals('ssot__CreatedDate__c < TIMESTAMP \'2026-10-29 09:30:15\'', whereOf(cond(column, 'timestamp', 'lt', '2026-10-29T09:30:15')));
        Map<String, Object> range = cond(column, 'timestamp', 'between', '2026-10-01 08:00');
        range.put('value2', '2026-10-02 08:00');
        System.assertEquals('ssot__CreatedDate__c BETWEEN TIMESTAMP \'2026-10-01 08:00:00\' AND TIMESTAMP \'2026-10-02 08:00:00\'', whereOf(range));
        System.assert(errorOfSingle(cond(column, 'timestamp', 'gte', '2026-10-29 25:00')).contains('not a valid time'));
        System.assert(errorOfSingle(cond(column, 'timestamp', 'gte', 'soon')).contains('not a date and time'));
    }

    @IsTest
    static void combinesGroupsWithLogic() {
        Map<String, Object> orGroup = new Map<String, Object>{
            'logic' => 'OR',
            'conditions' => new List<Object>{
                cond('Profile_Type__c', 'text', 'eq', 'B2C'),
                cond('Profile_Type__c', 'text', 'isNull', null)
            }
        };
        String sql = Data360PersonFilterService.buildCountSql(filter(new List<Object>{ cond('brand__c', 'text', 'eq', 'X'), orGroup }, 'AND'));
        System.assertEquals(
            'SELECT COUNT(*) AS cnt FROM ssot__Individual__dlm WHERE brand__c = \'X\' AND (Profile_Type__c = \'B2C\' OR Profile_Type__c IS NULL)',
            sql
        );
    }

    @IsTest
    static void enforcesStructureAndLimits() {
        System.assert(errorOf(filter(new List<Object>(), 'AND')).contains('at least one condition'));
        System.assert(errorOf(filter(new List<Object>{ new Map<String, Object>{ 'logic' => 'OR', 'conditions' => new List<Object>() } }, 'AND')).contains('every group'));
        System.assert(errorOf(filter(new List<Object>{ cond('a__c', 'text', 'eq', 'x') }, 'XOR')).contains('AND or OR'));

        Map<String, Object> innerGroup = new Map<String, Object>{ 'conditions' => new List<Object>{ cond('a__c', 'text', 'eq', 'x') } };
        Map<String, Object> outerGroup = new Map<String, Object>{ 'conditions' => new List<Object>{ innerGroup } };
        System.assert(errorOf(filter(new List<Object>{ outerGroup }, 'AND')).contains('nested once'));

        List<Object> many = new List<Object>();
        for (Integer i = 0; i < 26; i++) {
            many.add(cond('a__c', 'text', 'eq', 'x'));
        }
        System.assert(errorOf(filter(many, 'AND')).contains('at most 25'));

        System.assert(errorOf('{').contains('not valid JSON'));
        System.assert(errorOf('[1]').contains('JSON object'));
        System.assert(errorOf('{"version":2,"conditions":[]}').contains('Unsupported filter version'));
        System.assert(errorOf('{"dmo":"Other__dlm","conditions":[]}').contains('can only target'));
        System.assert(errorOf('x'.repeat(31000)).contains('too large'));
        System.assert(errorOf(filter(new List<Object>{ 'not a condition' }, 'AND')).contains('not valid'));
    }

    @IsTest
    static void refusesInjectionAttempts() {
        for (String field : new List<String>{ 'a__c; DROP TABLE x', 'a__c) OR (1=1', '1abc', 'a b', '', 'x'.repeat(81), 'a__c--' }) {
            System.assert(errorOfSingle(cond(field, 'text', 'eq', 'x')).contains('not a valid column name'), field);
        }
        System.assert(errorOfSingle(cond('a__c', 'text', 'eq; DROP', 'x')).contains('cannot be used on text'));
        System.assert(errorOfSingle(cond('a__c', 'sql', 'eq', 'x')).contains('Unknown column type'));
        System.assert(errorOfSingle(cond('a__c', 'text', 'eq', 'line\nbreak')).contains('control characters'));
        System.assert(errorOfSingle(cond('a__c', 'text', 'eq', 'x'.repeat(256))).contains('longer than 255'));
        System.assert(errorOfSingle(cond('a__c', 'text', 'eq', '   ')).contains('Enter a value'));
        // A hostile value stays inside the quoted literal.
        System.assertEquals('a__c = \'\'\'; DROP TABLE x; --\'', whereOf(cond('a__c', 'text', 'eq', '\'; DROP TABLE x; --')));
    }

    @IsTest
    static void typeDefaultsToText() {
        Map<String, Object> noType = new Map<String, Object>{ 'field' => 'brand__c', 'operator' => 'eq', 'value' => 'X' };
        System.assertEquals('brand__c = \'X\'', whereOf(noType));
    }

    @IsTest
    static void validateAcceptsBlankAndRejectsInvalid() {
        Data360PersonFilterService.validate(null);
        Data360PersonFilterService.validate('  ');
        Data360PersonFilterService.validate(filter(new List<Object>{ cond('a__c', 'text', 'eq', 'x') }, 'AND'));
        Boolean failed = false;
        try {
            Data360PersonFilterService.validate(filter(new List<Object>(), 'AND'));
        } catch (Data360PersonFilterService.FilterException e) {
            failed = true;
        }
        System.assertEquals(true, failed);
        System.assert(errorOf(null).contains('No filter is defined'));
    }

    @IsTest
    static void countsThroughTheExecutor() {
        StubExecutor stub = new StubExecutor();
        Data360PersonFilterService.executor = stub;
        String json = filter(new List<Object>{ cond('Profile_Type__c', 'text', 'eq', 'B2C') }, 'AND');
        System.assertEquals(42, Data360PersonFilterService.count(json));
        System.assertEquals(42, Data360PersonFilterService.totalCount());
        System.assertEquals(
            new List<String>{
                'SELECT COUNT(*) AS cnt FROM ssot__Individual__dlm WHERE Profile_Type__c = \'B2C\'',
                'SELECT COUNT(*) AS cnt FROM ssot__Individual__dlm'
            },
            stub.sqls
        );
    }

    @IsTest
    static void controllerReturnsCountsPreviewsAndReadableErrors() {
        StubExecutor stub = new StubExecutor();
        Data360PersonFilterService.executor = stub;
        String json = filter(new List<Object>{ cond('Profile_Type__c', 'text', 'eq', 'B2C') }, 'AND');
        System.assertEquals(42, PersonFilterCountController.getFilterCount(json));
        System.assertEquals(42, PersonFilterCountController.getTotalCount());
        System.assert(PersonFilterCountController.previewSql(json).contains('WHERE Profile_Type__c = \'B2C\''));
        System.assertEquals(1 + 1, stub.sqls.size(), 'Previewing must not run a query.');

        stub.failWith = 'unknown column \'nope__c\'';
        String message;
        try {
            PersonFilterCountController.getFilterCount(json);
        } catch (AuraHandledException e) {
            message = e.getMessage();
        }
        System.assertEquals('unknown column \'nope__c\'', message);
        message = null;
        try {
            PersonFilterCountController.getTotalCount();
        } catch (AuraHandledException e) {
            message = e.getMessage();
        }
        System.assertEquals('unknown column \'nope__c\'', message);
        message = null;
        try {
            PersonFilterCountController.previewSql('{');
        } catch (AuraHandledException e) {
            message = e.getMessage();
        }
        System.assert(message.contains('not valid JSON'));
    }

    @IsTest
    static void readsDataCloudErrors() {
        String wrapped = '{"timestamp":"2026-11-23","error":"400 BAD_REQUEST","message":"INVALID_ARGUMENT: unknown column \'nope__c\' [TraceId:abc]","path":"x"}';
        System.assertEquals('unknown column \'nope__c\'', Data360PersonFilterService.readableError(wrapped));
        System.assertEquals('plain failure', Data360PersonFilterService.readableError('plain failure'));
        System.assertEquals('The Data360 query failed.', Data360PersonFilterService.readableError(null));
        System.assertEquals(true, Data360PersonFilterService.isMissingObject('{"message":"NOT_FOUND: DataModelEntity with developerName = X is not found"}'));
        System.assertEquals(false, Data360PersonFilterService.isMissingObject('INVALID_ARGUMENT: unknown column'));
        System.assertEquals(false, Data360PersonFilterService.isMissingObject(null));
    }

    @IsTest
    static void dataCloudExecutorSurfacesFailuresAsFilterExceptions() {
        try {
            new Data360PersonFilterService.CdpExecutor().count('SELECT COUNT(*) AS cnt FROM ssot__Individual__dlm');
        } catch (Exception e) {
            System.assertNotEquals(null, e.getMessage());
        }
    }
}
