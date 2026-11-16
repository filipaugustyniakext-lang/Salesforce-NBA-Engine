@IsTest
private class OfferFormulaTest {

    private static Decimal run(String formula, Map<String, Decimal> vars) {
        return OfferFormula.parse(formula).evaluate(vars);
    }

    private static void eq(Decimal expected, Decimal actual) {
        System.assert(expected == actual, 'Expected ' + expected + ' but got ' + actual);
    }

    @IsTest
    static void arithmetic_followsPrecedence() {
        eq(14, run('2 + 3 * 4', null));
        eq(20, run('(2 + 3) * 4', null));
        eq(-5, run('-(2 + 3)', null));
        eq(8, run('2 ^ 3', null));
        eq(Decimal.valueOf('2.5'), run('5 / 2', null));
    }

    @IsTest
    static void placeholders_areFilledCaseInsensitively() {
        Decimal z = run('({Value} - {Floor}) / ({Ceiling} - {Floor})',
            new Map<String, Decimal>{ 'value' => 120000, 'FLOOR' => 1000, 'Ceiling' => 250000 });
        eq(Decimal.valueOf('0.4779116466'), z);
        System.assertEquals(new List<String>{ 'Floor', 'Ceiling' },
            OfferFormula.placeholders('({Value} - {Floor}) / ({Ceiling} - { floor })'));
        System.assert(OfferFormula.usesValue('{ value } * 2'));
        System.assert(!OfferFormula.usesValue('{Floor}'));
    }

    @IsTest
    static void functions_work() {
        eq(1, run('MIN(5, 1, 3)', null));
        eq(5, run('MAX(5, 1, 3)', null));
        eq(3, run('ABS(-3)', null));
        eq(Decimal.valueOf('1.23'), run('ROUND(1.2345, 2)', null));
        eq(10, run('IF({Value} >= 5, 10, 20)', new Map<String, Decimal>{ 'Value' => 5 }));
        eq(20, run('IF({Value} <> 5, 10, 20)', new Map<String, Decimal>{ 'Value' => 5 }));
        eq(1, run('AND(1 < 2, 2 <= 2, NOT(FALSE))', null));
        eq(0, run('OR(1 > 2, 2 != 2, 3 = 4)', null));
    }

    @IsTest
    static void badInput_throwsReadableErrors() {
        for (String bad : new List<String>{ '', '1 +', '(1 + 2', '{Floor', 'FOO(1)', 'MIN()', '1 $ 2', '{}' }) {
            try {
                OfferFormula.parse(bad);
                System.assert(false, 'Expected a parse error for ' + bad);
            } catch (OfferFormula.FormulaException e) {
                System.assert(String.isNotBlank(e.getMessage()));
            }
        }
        try {
            run('{Value} / {Zero}', new Map<String, Decimal>{ 'Value' => 1, 'Zero' => 0 });
            System.assert(false, 'Expected division by zero');
        } catch (OfferFormula.FormulaException e) {
            System.assert(e.getMessage().contains('zero'));
        }
        try {
            run('{Missing} + 1', new Map<String, Decimal>());
            System.assert(false, 'Expected a missing value');
        } catch (OfferFormula.FormulaException e) {
            System.assert(e.getMessage().contains('Missing'));
        }
    }
}