import { LightningElement, api } from 'lwc';

/**
 * Dual-handle range slider with two synchronized number inputs.
 *
 * Bounds are [min, max]; the two handles carry the current low/high selection.
 * Dragging a handle updates its number input and vice versa. Values are
 * hard-clamped into [min, max] and kept ordered (low <= high), so the emitted
 * range can never exceed the bounds — this is what enforces the offer-cannot-
 * exceed-reference rule when the component is bounded by a reference range.
 *
 * Emits `change` with detail { min, max } on every committed adjustment.
 */
export default class RangeSlider extends LightningElement {
    @api label;
    @api unit;
    @api disabled = false;
    // Unbounded (definition) mode: number inputs accept ANY value — no outer
    // clamp — and the visual slider domain auto-scales to the entered values.
    // Used when an admin is DEFINING a reference range (there is no outer
    // envelope). Bounded mode (default) is the offer wizard, where the [min,max]
    // clamp is the whole point (offer cannot exceed reference). Coerced because a
    // bare `unbounded` attribute arrives as "" (falsy) without this.
    _unbounded = false;
    @api
    get unbounded() {
        return this._unbounded;
    }
    set unbounded(value) {
        this._unbounded = value === '' || value === true || value === 'true';
    }

    _min = 0;
    _max = 100;
    _step = 1;
    _low = 0;
    _high = 100;

    _dragging = null; // 'low' | 'high' | null
    // Domain snapshot captured at drag start. In unbounded mode the domain
    // auto-scales off the current selection; without this freeze, moving a
    // handle expands the domain, which shifts the handle's rendered percent
    // back — the handle appears stuck while the underlying value jumps.
    _dragDomainMin = null;
    _dragDomainMax = null;
    _boundMove;
    _boundUp;

    @api
    get min() {
        return this._min;
    }
    set min(value) {
        const n = this._toNumber(value);
        this._min = n === null ? 0 : n;
        this._clampSelection();
    }

    @api
    get max() {
        return this._max;
    }
    set max(value) {
        const n = this._toNumber(value);
        this._max = n === null ? 100 : n;
        this._clampSelection();
    }

    @api
    get step() {
        return this._step;
    }
    set step(value) {
        const n = this._toNumber(value);
        this._step = n === null || n <= 0 ? 1 : n;
    }

    @api
    get valueMin() {
        return this._low;
    }
    set valueMin(value) {
        const n = this._toNumber(value);
        this._low = n === null ? this._min : n;
        this._clampSelection();
    }

    @api
    get valueMax() {
        return this._high;
    }
    set valueMax(value) {
        const n = this._toNumber(value);
        this._high = n === null ? this._max : n;
        this._clampSelection();
    }

    // --- domain (visual track extent) -------------------------------------
    // Bounded: the fixed [min, max]. Unbounded: derived from the current
    // selection with headroom, so handles sit sensibly on the track and the
    // high handle can still be dragged upward past the current value.
    get _domainMin() {
        if (this._dragDomainMin !== null) return this._dragDomainMin;
        if (!this.unbounded) return this._min;
        return Math.min(0, this._low, this._high);
    }

    get _domainMax() {
        if (this._dragDomainMax !== null) return this._dragDomainMax;
        if (!this.unbounded) return this._max;
        const top = Math.max(this._high, this._low, this._step);
        return top > 0 ? top * 1.2 : this._step;
    }

    // Number-input HTML constraints: enforce [min,max] in bounded mode (good
    // wizard UX); drop them in unbounded mode so the admin can type any amount
    // without a spurious "value out of range" validation error.
    get inputMin() {
        return this.unbounded ? undefined : this._min;
    }

    get inputMax() {
        return this.unbounded ? undefined : this._max;
    }

    // --- rendering helpers -------------------------------------------------

    get lowPercent() {
        return this._percent(this._low);
    }

    get highPercent() {
        return this._percent(this._high);
    }

    get lowHandleStyle() {
        return `left: ${this.lowPercent}%;`;
    }

    get highHandleStyle() {
        return `left: ${this.highPercent}%;`;
    }

    get fillStyle() {
        const lo = this.lowPercent;
        const hi = this.highPercent;
        return `left: ${lo}%; width: ${Math.max(0, hi - lo)}%;`;
    }

    // --- number input handlers --------------------------------------------

    handleLowInput(event) {
        const n = this._toNumber(event.target.value);
        if (n === null) return;
        this._low = n;
        this._clampSelection();
        this._commit();
    }

    handleHighInput(event) {
        const n = this._toNumber(event.target.value);
        if (n === null) return;
        this._high = n;
        this._clampSelection();
        this._commit();
    }

    // --- keyboard on handles ----------------------------------------------

    handleLowKeydown(event) {
        this._handleKey(event, 'low');
    }

    handleHighKeydown(event) {
        this._handleKey(event, 'high');
    }

    _handleKey(event, which) {
        if (this.disabled) return;
        let delta = 0;
        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowUp':
                delta = this._step;
                break;
            case 'ArrowLeft':
            case 'ArrowDown':
                delta = -this._step;
                break;
            case 'Home':
                this._setBound(which, this._domainMin);
                event.preventDefault();
                this._commit();
                return;
            case 'End':
                this._setBound(which, this._domainMax);
                event.preventDefault();
                this._commit();
                return;
            default:
                return;
        }
        event.preventDefault();
        this._setBound(which, (which === 'low' ? this._low : this._high) + delta);
        this._commit();
    }

    // --- pointer drag ------------------------------------------------------

    handleLowPointerdown(event) {
        this._startDrag('low', event);
    }

    handleHighPointerdown(event) {
        this._startDrag('high', event);
    }

    _startDrag(which, event) {
        if (this.disabled) return;
        event.preventDefault();
        this._dragging = which;
        // Freeze the domain for this drag so auto-scaling doesn't fight the
        // pointer. Release to a new drag or a typed input to grow it further.
        this._dragDomainMin = this._domainMin;
        this._dragDomainMax = this._domainMax;
        this._boundMove = this._onPointerMove.bind(this);
        this._boundUp = this._onPointerUp.bind(this);
        window.addEventListener('mousemove', this._boundMove);
        window.addEventListener('mouseup', this._boundUp);
        window.addEventListener('touchmove', this._boundMove, { passive: false });
        window.addEventListener('touchend', this._boundUp);
    }

    _onPointerMove(event) {
        if (!this._dragging) return;
        event.preventDefault();
        const track = this.template.querySelector('.slider-track');
        if (!track) return;
        const rect = track.getBoundingClientRect();
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
        const raw = this._domainMin + ratio * (this._domainMax - this._domainMin);
        this._setBound(this._dragging, this._snap(raw));
        this._commit();
    }

    _onPointerUp() {
        this._dragging = null;
        this._dragDomainMin = null;
        this._dragDomainMax = null;
        window.removeEventListener('mousemove', this._boundMove);
        window.removeEventListener('mouseup', this._boundUp);
        window.removeEventListener('touchmove', this._boundMove);
        window.removeEventListener('touchend', this._boundUp);
    }

    disconnectedCallback() {
        this._onPointerUp();
    }

    // --- core math ---------------------------------------------------------

    _setBound(which, value) {
        if (which === 'low') {
            this._low = value;
        } else {
            this._high = value;
        }
        this._clampSelection();
    }

    _clampSelection() {
        if (this._max < this._min) {
            const t = this._max;
            this._max = this._min;
            this._min = t;
        }
        // Bounded mode clamps the selection into [min, max]; unbounded mode
        // lets typed values stand as-is (the admin is defining the range).
        if (!this.unbounded) {
            this._low = this._bound(this._low);
            this._high = this._bound(this._high);
        }
        if (this._low > this._high) {
            if (this._dragging === 'low') {
                this._low = this._high;
            } else if (this._dragging === 'high') {
                this._high = this._low;
            } else {
                const t = this._low;
                this._low = this._high;
                this._high = t;
            }
        }
    }

    // Clamp to the visual DOMAIN (== [min,max] when bounded). Used by drag,
    // snap and percent so handles never leave the track, regardless of mode.
    _bound(value) {
        const lo = this._domainMin;
        const hi = this._domainMax;
        if (value < lo) return lo;
        if (value > hi) return hi;
        return value;
    }

    _snap(value) {
        const base = this._domainMin;
        const snapped = Math.round((value - base) / this._step) * this._step + base;
        return this._bound(snapped);
    }

    _percent(value) {
        const span = this._domainMax - this._domainMin;
        if (span <= 0) return 0;
        return ((this._bound(value) - this._domainMin) / span) * 100;
    }

    _toNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isNaN(n) ? null : n;
    }

    _commit() {
        this.dispatchEvent(
            new CustomEvent('change', {
                detail: { min: this._low, max: this._high }
            })
        );
    }
}