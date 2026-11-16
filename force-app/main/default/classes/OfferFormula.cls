/**
 * Parser and evaluator for attractiveness calculation formulas.
 *
 * Syntax follows Salesforce formulas: numbers, {Placeholder} names, + - * / ^,
 * brackets, comparisons (= == <> != < <= > >=, true = 1 and false = 0) and the
 * functions MIN, MAX, ABS, ROUND, IF, AND, OR, NOT. {Value} is the attribute's
 * own value; every other placeholder is filled per family attribute.
 */
public with sharing class OfferFormula {

    public static final String VALUE_PLACEHOLDER = 'Value';

    public class FormulaException extends Exception {}

    private static final Map<String, Integer> MIN_ARGS = new Map<String, Integer>{
        'MIN' => 1, 'MAX' => 1, 'ABS' => 1, 'ROUND' => 2, 'IF' => 3, 'AND' => 1, 'OR' => 1, 'NOT' => 1
    };
    private static final Map<String, Integer> MAX_ARGS = new Map<String, Integer>{
        'MIN' => 99, 'MAX' => 99, 'ABS' => 1, 'ROUND' => 2, 'IF' => 3, 'AND' => 99, 'OR' => 99, 'NOT' => 1
    };

    private class Token {
        String kind;   // num, var, ident, op, lparen, rparen, comma, end
        String text;
        Decimal num;
        Integer pos;
        Token(String kind, String text, Integer pos) { this.kind = kind; this.text = text; this.pos = pos; }
    }

    private class Node {
        String kind;   // num, var, unary, binary, call
        String op;
        Decimal num;
        String name;
        List<Node> args = new List<Node>();
    }

    private final Node root;

    private OfferFormula(Node root) {
        this.root = root;
    }

    public static OfferFormula parse(String formula) {
        if (String.isBlank(formula)) {
            throw new FormulaException('The formula is empty.');
        }
        Parser p = new Parser(tokenize(formula));
        Node n = p.parseComparison();
        p.expectEnd();
        return new OfferFormula(n);
    }

    /** Placeholder names used by the formula, in order of first use, excluding {Value}. */
    public static List<String> placeholders(String formula) {
        List<String> names = new List<String>();
        if (String.isBlank(formula)) return names;
        Set<String> seen = new Set<String>();
        Matcher m = Pattern.compile('\\{([^{}]*)\\}').matcher(formula);
        while (m.find()) {
            String name = m.group(1).trim();
            if (String.isBlank(name) || name.equalsIgnoreCase(VALUE_PLACEHOLDER)) continue;
            if (seen.add(name.toLowerCase())) names.add(name);
        }
        return names;
    }

    public static Boolean usesValue(String formula) {
        if (String.isBlank(formula)) return false;
        return Pattern.compile('(?i)\\{\\s*value\\s*\\}').matcher(formula).find();
    }

    /** Evaluates with placeholder values keyed case-insensitively. A missing value or division by zero throws. */
    public Decimal evaluate(Map<String, Decimal> vars) {
        Map<String, Decimal> lower = new Map<String, Decimal>();
        if (vars != null) {
            for (String k : vars.keySet()) {
                if (k != null) lower.put(k.trim().toLowerCase(), vars.get(k));
            }
        }
        return eval(root, lower);
    }

    private static Decimal eval(Node n, Map<String, Decimal> vars) {
        if (n.kind == 'num') return n.num;
        if (n.kind == 'var') {
            Decimal v = vars.get(n.name.toLowerCase());
            if (v == null) throw new FormulaException('No value for {' + n.name + '}.');
            return v;
        }
        if (n.kind == 'unary') {
            Decimal v = eval(n.args[0], vars);
            return n.op == '-' ? -v : v;
        }
        if (n.kind == 'binary') {
            Decimal a = eval(n.args[0], vars);
            Decimal b = eval(n.args[1], vars);
            switch on n.op {
                when '+' { return a + b; }
                when '-' { return a - b; }
                when '*' { return a * b; }
                when '/' {
                    if (b == 0) throw new FormulaException('Division by zero.');
                    return a.divide(b, 10, System.RoundingMode.HALF_UP);
                }
                when '^' { return Decimal.valueOf(Math.pow(a.doubleValue(), b.doubleValue())); }
                when '=', '==' { return bool(a == b); }
                when '<>', '!=' { return bool(a != b); }
                when '<' { return bool(a < b); }
                when '<=' { return bool(a <= b); }
                when '>' { return bool(a > b); }
                when '>=' { return bool(a >= b); }
            }
            throw new FormulaException('Unknown operator ' + n.op + '.');
        }
        return call(n, vars);
    }

    private static Decimal call(Node n, Map<String, Decimal> vars) {
        switch on n.name {
            when 'IF' {
                return eval(n.args[0], vars) != 0 ? eval(n.args[1], vars) : eval(n.args[2], vars);
            }
            when 'AND' {
                for (Node a : n.args) { if (eval(a, vars) == 0) return 0; }
                return 1;
            }
            when 'OR' {
                for (Node a : n.args) { if (eval(a, vars) != 0) return 1; }
                return 0;
            }
            when 'NOT' { return bool(eval(n.args[0], vars) == 0); }
            when 'ABS' { return eval(n.args[0], vars).abs(); }
            when 'ROUND' {
                return eval(n.args[0], vars).setScale(eval(n.args[1], vars).intValue(), System.RoundingMode.HALF_UP);
            }
            when 'MIN', 'MAX' {
                Decimal best = null;
                for (Node a : n.args) {
                    Decimal v = eval(a, vars);
                    if (best == null || (n.name == 'MIN' ? v < best : v > best)) best = v;
                }
                return best;
            }
        }
        throw new FormulaException('Unknown function ' + n.name + '.');
    }

    private static Decimal bool(Boolean b) {
        return b ? 1 : 0;
    }

    private static List<Token> tokenize(String s) {
        List<Token> out = new List<Token>();
        Integer i = 0;
        Integer len = s.length();
        while (i < len) {
            String c = s.substring(i, i + 1);
            if (c.isWhitespace()) { i++; continue; }
            if (c == '{') {
                Integer close = s.indexOf('}', i);
                if (close < 0) throw new FormulaException('A { at position ' + (i + 1) + ' is never closed.');
                String name = s.substring(i + 1, close).trim();
                if (String.isBlank(name)) throw new FormulaException('Empty placeholder {} at position ' + (i + 1) + '.');
                if (name.contains('{')) throw new FormulaException('Placeholder at position ' + (i + 1) + ' contains {.');
                out.add(new Token('var', name, i));
                i = close + 1;
                continue;
            }
            if (c.isNumeric() || c == '.') {
                Integer start = i;
                while (i < len && (s.substring(i, i + 1).isNumeric() || s.substring(i, i + 1) == '.')) i++;
                Token t = new Token('num', s.substring(start, i), start);
                try {
                    t.num = Decimal.valueOf(t.text);
                } catch (Exception e) {
                    throw new FormulaException('Invalid number ' + t.text + '.');
                }
                out.add(t);
                continue;
            }
            if (c.isAlpha()) {
                Integer start = i;
                while (i < len && (s.substring(i, i + 1).isAlphanumeric() || s.substring(i, i + 1) == '_')) i++;
                out.add(new Token('ident', s.substring(start, i).toUpperCase(), start));
                continue;
            }
            String two = i + 2 <= len ? s.substring(i, i + 2) : '';
            if (two == '<=' || two == '>=' || two == '<>' || two == '!=' || two == '==') {
                out.add(new Token('op', two, i));
                i += 2;
                continue;
            }
            if ('+-*/^=<>'.contains(c)) { out.add(new Token('op', c, i)); i++; continue; }
            if (c == '(') { out.add(new Token('lparen', c, i)); i++; continue; }
            if (c == ')') { out.add(new Token('rparen', c, i)); i++; continue; }
            if (c == ',') { out.add(new Token('comma', c, i)); i++; continue; }
            throw new FormulaException('Unexpected character ' + c + ' at position ' + (i + 1) + '.');
        }
        out.add(new Token('end', '', len));
        return out;
    }

    private class Parser {
        List<Token> tokens;
        Integer idx = 0;

        Parser(List<Token> tokens) { this.tokens = tokens; }

        Token peek() { return tokens[idx]; }
        Token next() { return tokens[idx++]; }

        Boolean isOp(Set<String> ops) {
            return peek().kind == 'op' && ops.contains(peek().text);
        }

        void expectEnd() {
            if (peek().kind != 'end') {
                throw new FormulaException('Unexpected ' + peek().text + ' at position ' + (peek().pos + 1) + '.');
            }
        }

        Node binary(String op, Node a, Node b) {
            Node n = new Node();
            n.kind = 'binary';
            n.op = op;
            n.args.add(a);
            n.args.add(b);
            return n;
        }

        Node parseComparison() {
            Node left = parseAdditive();
            if (isOp(new Set<String>{ '=', '==', '<>', '!=', '<', '<=', '>', '>=' })) {
                String op = next().text;
                left = binary(op, left, parseAdditive());
            }
            return left;
        }

        Node parseAdditive() {
            Node left = parseTerm();
            while (isOp(new Set<String>{ '+', '-' })) {
                String op = next().text;
                left = binary(op, left, parseTerm());
            }
            return left;
        }

        Node parseTerm() {
            Node left = parseUnary();
            while (isOp(new Set<String>{ '*', '/' })) {
                String op = next().text;
                left = binary(op, left, parseUnary());
            }
            return left;
        }

        Node parseUnary() {
            if (isOp(new Set<String>{ '+', '-' })) {
                Node n = new Node();
                n.kind = 'unary';
                n.op = next().text;
                n.args.add(parseUnary());
                return n;
            }
            return parsePower();
        }

        Node parsePower() {
            Node base = parsePrimary();
            if (isOp(new Set<String>{ '^' })) {
                next();
                return binary('^', base, parseUnary());
            }
            return base;
        }

        Node parsePrimary() {
            Token t = next();
            Node n = new Node();
            if (t.kind == 'num') {
                n.kind = 'num';
                n.num = t.num;
                return n;
            }
            if (t.kind == 'var') {
                n.kind = 'var';
                n.name = t.text;
                return n;
            }
            if (t.kind == 'lparen') {
                Node nested = parseComparison();
                if (next().kind != 'rparen') throw new FormulaException('Missing ) for ( at position ' + (t.pos + 1) + '.');
                return nested;
            }
            if (t.kind == 'ident') {
                if (t.text == 'TRUE' || t.text == 'FALSE') {
                    n.kind = 'num';
                    n.num = t.text == 'TRUE' ? 1 : 0;
                    return n;
                }
                if (!MIN_ARGS.containsKey(t.text)) {
                    throw new FormulaException('Unknown function ' + t.text + '. Use MIN, MAX, ABS, ROUND, IF, AND, OR or NOT, and put placeholders in {braces}.');
                }
                if (next().kind != 'lparen') throw new FormulaException(t.text + ' must be followed by (.');
                n.kind = 'call';
                n.name = t.text;
                if (peek().kind != 'rparen') {
                    n.args.add(parseComparison());
                    while (peek().kind == 'comma') {
                        next();
                        n.args.add(parseComparison());
                    }
                }
                if (next().kind != 'rparen') throw new FormulaException('Missing ) after ' + t.text + ' arguments.');
                if (n.args.size() < MIN_ARGS.get(t.text) || n.args.size() > MAX_ARGS.get(t.text)) {
                    throw new FormulaException(t.text + ' has the wrong number of arguments.');
                }
                return n;
            }
            if (t.kind == 'end') throw new FormulaException('The formula ends too early.');
            throw new FormulaException('Unexpected ' + t.text + ' at position ' + (t.pos + 1) + '.');
        }
    }
}