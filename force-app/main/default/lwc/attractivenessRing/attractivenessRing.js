import { LightningElement, api } from 'lwc';

const R = 10; // matches viewBox="-10 -10 20 20"

export default class AttractivenessRing extends LightningElement {
    /** Raw attractiveness score 0–1 float. Null = empty. */
    @api score;
    /** 'large' (default ~56px) or 'small' (~36px) */
    @api size = 'large';

    get pct() {
        if (this.score == null) return 0;
        return Math.round(Math.min(Math.max(Number(this.score), 0), 1) * 100);
    }

    get scoreLabel() {
        if (this.score == null) return '—';
        return `${this.pct}%`;
    }

    get title() {
        return `Attractiveness score: ${this.scoreLabel}`;
    }

    // Show the head-dot only when there's a partial arc (0 < pct < 100)
    get showHead() {
        return this.pct > 0 && this.pct < 100;
    }

    // ─── SLDS modifier class ──────────────────────────────────────────────────

    get ringClass() {
        let cls = 'slds-progress-ring';
        if (this.size === 'large') cls += ' slds-progress-ring_large';
        // Map score tier to SLDS colour modifier
        const p = this.pct;
        if (this.score == null)   cls += '';               // neutral/empty
        else if (p >= 75)         cls += ' slds-progress-ring_complete';
        else if (p >= 40)         cls += ' slds-progress-ring_warning';
        else                      cls += ' slds-progress-ring_expired';
        return cls;
    }

    get scoreTextClass() {
        const p = this.pct;
        if (this.score == null)   return 'ring-score';
        if (p >= 75)              return 'ring-score ring-score_high';
        if (p >= 40)              return 'ring-score ring-score_mid';
        return 'ring-score ring-score_low';
    }

    // ─── SVG arc path (SLDS formula) ─────────────────────────────────────────
    // Starts at 12 o'clock (0, -R), sweeps clockwise.
    // x = sin(angle)*R,  y = -cos(angle)*R

    get arcPath() {
        const p = this.pct;
        if (p <= 0)  return `M 0 0`; // nothing
        if (p >= 100) {
            // Full circle: two half-arcs (single-arc degenerate when start===end)
            return `M 0 ${-R} A ${R} ${R} 0 1 1 0 ${R} A ${R} ${R} 0 1 1 0 ${-R} Z`;
        }
        const angle  = (p / 100) * 2 * Math.PI;
        const x      = +(Math.sin(angle) * R).toFixed(4);
        const y      = +(-Math.cos(angle) * R).toFixed(4);
        const large  = p > 50 ? 1 : 0;
        return `M 0 ${-R} A ${R} ${R} 0 ${large} 1 ${x} ${y} L 0 0 Z`;
    }

    get headX() {
        const angle = (this.pct / 100) * 2 * Math.PI;
        return +(Math.sin(angle) * R).toFixed(4);
    }

    get headY() {
        const angle = (this.pct / 100) * 2 * Math.PI;
        return +(-Math.cos(angle) * R).toFixed(4);
    }
}