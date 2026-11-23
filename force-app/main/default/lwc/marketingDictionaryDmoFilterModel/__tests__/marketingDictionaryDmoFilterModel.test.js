import { filterTypeOf, modelFromJson, modelToJson, newCondition, newGroup, countConditions, OPERATORS_BY_TYPE } from 'c/marketingDictionaryDmoFilterModel';

describe('marketingDictionaryDmoFilterModel', () => {
    it('maps Data360 column types to filter types', () => {
        expect(filterTypeOf('VARCHAR')).toBe('text');
        expect(filterTypeOf('TIMESTAMP WITH TIME ZONE')).toBe('timestamp');
        expect(filterTypeOf('DATE')).toBe('date');
        expect(filterTypeOf('BOOLEAN')).toBe('boolean');
        expect(filterTypeOf('BIGINT')).toBe('number');
        expect(filterTypeOf('DECIMAL(18,2)')).toBe('number');
        expect(filterTypeOf('')).toBe('text');
        expect(filterTypeOf(undefined)).toBe('text');
    });

    it('offers the same operators per type as the server accepts', () => {
        expect(OPERATORS_BY_TYPE.boolean).toEqual(['eq', 'isNull', 'isNotNull']);
        expect(OPERATORS_BY_TYPE.text).toContain('contains');
        expect(OPERATORS_BY_TYPE.number).not.toContain('contains');
        expect(OPERATORS_BY_TYPE.date).toEqual(OPERATORS_BY_TYPE.timestamp);
    });

    it('has no JSON for an empty filter and reads blank or broken JSON as empty', () => {
        expect(modelToJson({ logic: 'AND', items: [] })).toBe('');
        expect(modelFromJson('')).toEqual({ logic: 'AND', items: [] });
        expect(modelFromJson('{nope')).toEqual({ logic: 'AND', items: [] });
    });

    it('round-trips conditions, lists and groups', () => {
        const json = JSON.stringify({
            version: 1,
            dmo: 'ssot__Individual__dlm',
            logic: 'OR',
            conditions: [
                { field: 'Profile_Type__c', type: 'text', operator: 'in', values: ['B2C', 'B2B'] },
                { field: 'age__c', type: 'number', operator: 'between', value: '18', value2: '65' },
                { logic: 'AND', conditions: [{ field: 'brand__c', type: 'text', operator: 'isNull' }] }
            ]
        });
        const model = modelFromJson(json);
        expect(model.logic).toBe('OR');
        expect(model.items).toHaveLength(3);
        expect(model.items[0].valuesText).toBe('B2C, B2B');
        expect(model.items[2].kind).toBe('group');
        expect(countConditions(model)).toBe(3);
        expect(JSON.parse(modelToJson(model))).toEqual(JSON.parse(json));
    });

    it('serialises list values from comma or line separated text and drops values of operators that take none', () => {
        const condition = newCondition({ field: 'a__c', operator: 'in', valuesText: 'x, y\nz,, ' });
        const empty = newCondition({ field: 'b__c', operator: 'isNull', value: 'ignored' });
        const json = JSON.parse(modelToJson({ logic: 'AND', items: [condition, newGroup([empty])] }));
        expect(json.conditions[0].values).toEqual(['x', 'y', 'z']);
        expect(json.conditions[1].conditions[0]).toEqual({ field: 'b__c', type: 'text', operator: 'isNull' });
    });

    it('reads an in-list stored as plain text and an unknown type as text', () => {
        const model = modelFromJson(JSON.stringify({ conditions: [{ field: 'a__c', type: 'weird', operator: 'in', value: 'a, b' }] }));
        expect(model.items[0].type).toBe('text');
        expect(model.items[0].valuesText).toBe('a, b');
    });
});
