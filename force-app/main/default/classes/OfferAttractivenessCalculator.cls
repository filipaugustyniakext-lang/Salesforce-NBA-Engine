/**
 * Computes offer attractiveness on a 0-1 scale as a weighted sum of per-parameter
 * sub-scores. Weights, categorical dictionaries and rate buckets come from the
 * business "Atrakcyjność oferty" spec. Numeric params (amount / tenure) are min-max
 * normalized; deposit/saving promotional amounts use absolute buckets; rate is a
 * bucketed difference versus a per-family reference rate.
 *
 * The GLOBAL reference table (min/max/reference rate) is intentionally centralized
 * here so it stays modifiable. Productionization note: move REFERENCE into Custom
 * Metadata so admins can edit reference rates (e.g. tied to the NBP base rate).
 */
public with sharing class OfferAttractivenessCalculator {

    // --- Global reference values per product family ---
    public class FamilyRef {
        public Decimal amountMin;
        public Decimal amountMax;
        public Decimal tenureMin;
        public Decimal tenureMax;
        public Decimal refRate; // reference nominal interest rate (%)
        public FamilyRef(Decimal aMin, Decimal aMax, Decimal tMin, Decimal tMax, Decimal r) {
            amountMin = aMin; amountMax = aMax; tenureMin = tMin; tenureMax = tMax; refRate = r;
        }
    }

    private static final Map<String, FamilyRef> REFERENCE = new Map<String, FamilyRef>{
        'Cash Loan'          => new FamilyRef(1000, 250000, 0, 120, 14.5),
        'Consolidation Loan' => new FamilyRef(1000, 250000, 0, 120, 14.5),
        'Credit Card'        => new FamilyRef(0, 100000, 0, 0, 14.5),
        'Mortgage'           => new FamilyRef(0, 0, 0, 360, 14.5),
        'Home Equity Loan'   => new FamilyRef(0, 0, 0, 360, 14.5),
        'Term Deposit'       => new FamilyRef(0, 0, 0, 0, 3.75),
        'Term Deposit FX'    => new FamilyRef(0, 0, 0, 0, 3.75),
        'Saving Account'     => new FamilyRef(0, 0, 0, 0, 3.75),
        'Saving Account FX'  => new FamilyRef(0, 0, 0, 0, 3.75)
    };

    // --- Per-family weights (must sum to 1) ---
    private static final Map<String, Map<String, Decimal>> WEIGHTS = new Map<String, Map<String, Decimal>>{
        'Cash Loan' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.45, 'Sales_Process__c' => 0.15,
            'Maximum_Amount__c' => 0.10, 'Maximum_Tenure__c' => 0.10,
            'Earlier_Repayment_Fee__c' => 0.10, 'Interest_Type__c' => 0.10
        },
        'Consolidation Loan' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.45, 'Sales_Process__c' => 0.15,
            'Maximum_Amount__c' => 0.10, 'Maximum_Tenure__c' => 0.10,
            'Earlier_Repayment_Fee__c' => 0.10, 'Interest_Type__c' => 0.10
        },
        'Credit Card' => new Map<String, Decimal>{
            'NO_Fees_Conditions_Simplicity__c' => 0.35, 'Grace_Period_Days__c' => 0.20,
            'Sales_Process__c' => 0.15, 'Additional_VAS__c' => 0.15,
            'Nominal_Interest_Rate__c' => 0.10, 'Maximum_Amount__c' => 0.05
        },
        'Mortgage' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.50, 'Earlier_Repayment_Fee__c' => 0.15,
            'Own_Input_Percentage__c' => 0.15, 'Interest_Type__c' => 0.10,
            'Sales_Process__c' => 0.05, 'Maximum_Tenure__c' => 0.05
        },
        'Home Equity Loan' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.65, 'Earlier_Repayment_Fee__c' => 0.15,
            'Interest_Type__c' => 0.10, 'Sales_Process__c' => 0.05, 'Maximum_Tenure__c' => 0.05
        },
        'Term Deposit' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.65, 'Maximum_Promotional_Amount__c' => 0.25,
            'Interest_Type__c' => 0.10
        },
        'Term Deposit FX' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.65, 'Maximum_Promotional_Amount__c' => 0.25,
            'Interest_Type__c' => 0.10
        },
        'Saving Account' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.65, 'Maximum_Promotional_Amount__c' => 0.35
        },
        'Saving Account FX' => new Map<String, Decimal>{
            'Nominal_Interest_Rate__c' => 0.65, 'Maximum_Promotional_Amount__c' => 0.35
        }
    };

    // --- Categorical dictionaries ---
    private static final Map<String, Decimal> EARLIER_REPAYMENT = new Map<String, Decimal>{ 'YES' => 0, 'NO' => 1 };
    private static final Map<String, Decimal> INTEREST_TYPE = new Map<String, Decimal>{ 'variable' => 0.5, 'fixed' => 1 };
    private static final Map<String, Decimal> SALES_PROCESS = new Map<String, Decimal>{ 'branch' => 0.5, 'omnichannel' => 0.75, 'online' => 1 };
    private static final Map<String, Decimal> GRACE_PERIOD = new Map<String, Decimal>{ 'short' => 0.25, 'standard' => 0.5, 'long' => 0.75 };
    private static final Map<String, Decimal> ADDITIONAL_VAS = new Map<String, Decimal>{
        'none' => 0, 'poor' => 0.2, 'fair' => 0.4, 'good' => 0.6, 'excellent' => 0.8, 'outstanding' => 1
    };
    private static final Map<String, Decimal> NO_FEES_SIMPLICITY = new Map<String, Decimal>{
        'no fee' => 1, 'easy' => 0.75, 'medium' => 0.5, 'difficult' => 0.25, 'not possible' => 0
    };
    private static final Map<String, Decimal> OWN_INPUT = new Map<String, Decimal>{ '10%' => 1, '10-20%' => 0.75, '20%+' => 0.25 };

    @AuraEnabled(cacheable=false)
    public static Decimal scoreOffer(String family, Map<String, Object> params) {
        return calculate(family, params);
    }

    public static Decimal calculate(String family, Map<String, Object> data) {
        if (family == null || !WEIGHTS.containsKey(family) || data == null) {
            return null;
        }
        Map<String, Decimal> weights = WEIGHTS.get(family);
        FamilyRef ref = REFERENCE.get(family);
        Boolean isDepositLike = family.startsWith('Term Deposit') || family.startsWith('Saving Account');

        Decimal total = 0;
        for (String field : weights.keySet()) {
            Decimal sub = subScore(field, data.get(field), ref, isDepositLike);
            if (sub == null) {
                sub = 0;
            }
            total += weights.get(field) * sub;
        }
        return total.setScale(6, System.RoundingMode.HALF_UP);
    }

    private static Decimal subScore(String field, Object raw, FamilyRef ref, Boolean isDepositLike) {
        if (field == 'Earlier_Repayment_Fee__c') return EARLIER_REPAYMENT.get(toStr(raw));
        if (field == 'Interest_Type__c') return INTEREST_TYPE.get(toStr(raw));
        if (field == 'Sales_Process__c') return SALES_PROCESS.get(toStr(raw));
        if (field == 'Grace_Period_Days__c') return GRACE_PERIOD.get(toStr(raw));
        if (field == 'Additional_VAS__c') return ADDITIONAL_VAS.get(toStr(raw));
        if (field == 'NO_Fees_Conditions_Simplicity__c') return NO_FEES_SIMPLICITY.get(toStr(raw));
        if (field == 'Own_Input_Percentage__c') return OWN_INPUT.get(toStr(raw));

        if (field == 'Nominal_Interest_Rate__c') {
            return rateScore(toDecimal(raw), ref, isDepositLike);
        }
        if (field == 'Maximum_Amount__c') {
            return minMax(toDecimal(raw), ref.amountMin, ref.amountMax);
        }
        if (field == 'Maximum_Tenure__c') {
            return minMax(toDecimal(raw), ref.tenureMin, ref.tenureMax);
        }
        if (field == 'Maximum_Promotional_Amount__c') {
            return depositAmountBucket(toDecimal(raw));
        }
        return null;
    }

    // Min-max normalization: Z = (X - min) / (max - min), clamped to [0,1].
    private static Decimal minMax(Decimal x, Decimal lo, Decimal hi) {
        if (x == null || hi == null || lo == null || hi <= lo) return 0;
        Decimal z = (x - lo) / (hi - lo);
        if (z < 0) return 0;
        if (z > 1) return 1;
        return z;
    }

    // Rate = bucketed difference versus the reference rate.
    // Loans/cards: cheaper than reference is better (diff = ref - offered).
    // Deposits/savings: higher than reference is better (diff = offered - ref), inverted table.
    private static Decimal rateScore(Decimal offered, FamilyRef ref, Boolean isDepositLike) {
        if (offered == null || ref == null) return 0;
        Decimal diff = isDepositLike ? (offered - ref.refRate) : (ref.refRate - offered);
        return isDepositLike ? depositRateBucket(diff) : loanRateBucket(diff);
    }

    private static Decimal loanRateBucket(Decimal d) {
        if (d <= 1) return 0.1;
        if (d <= 2) return 0.2;
        if (d <= 3) return 0.3;
        if (d <= 4) return 0.4;
        if (d <= 5) return 0.5;
        if (d <= 6) return 0.6;
        if (d <= 7) return 0.7;
        if (d <= 8) return 0.8;
        if (d <= 9) return 0.9;
        return 1;
    }

    private static Decimal depositRateBucket(Decimal d) {
        if (d < 0) return 0;
        if (d == 0) return 0.1;
        if (d <= 1) return 0.2;
        if (d <= 2) return 0.3;
        if (d <= 3) return 0.4;
        if (d <= 4) return 0.6;
        if (d <= 5) return 0.8;
        return 1;
    }

    private static Decimal depositAmountBucket(Decimal a) {
        if (a == null) return 0;
        if (a <= 25000) return 0.1;
        if (a <= 50000) return 0.2;
        if (a <= 100000) return 0.3;
        if (a <= 150000) return 0.4;
        if (a <= 200000) return 0.5;
        if (a <= 300000) return 0.6;
        if (a <= 400000) return 0.7;
        if (a <= 500000) return 0.8;
        return 1;
    }

    private static String toStr(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static Decimal toDecimal(Object o) {
        if (o == null) return null;
        try {
            return Decimal.valueOf(String.valueOf(o));
        } catch (Exception e) {
            return null;
        }
    }
}