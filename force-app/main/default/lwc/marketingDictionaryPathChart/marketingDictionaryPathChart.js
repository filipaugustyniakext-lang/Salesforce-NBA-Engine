import { LightningElement, api, track } from 'lwc';
import getFilterCount from '@salesforce/apex/PersonFilterCountController.getFilterCount';

const PALETTE = ['#3296ed', '#77b9f2', '#9d53f2', '#04844b', '#fe9339', '#e4a201', '#ea001e', '#0b827c'];
const LABEL_MIN_PERCENT = 8;
const number = new Intl.NumberFormat();

/**
 * Horizontal stacked bar per audience type: one segment per active activation path, as wide as its allocation.
 * Hovering (or focusing) a segment shows the path, its allocation and the approximate population it reaches:
 * the audience's size, counted live on Data360 with the filter defined for that audience type in the Person
 * section, times the allocation.
 */
export default class MarketingDictionaryPathChart extends LightningElement {
    @track counts = {};
    @track tip = null;
    _audienceTypes = [];
    _paths = [];
    _signature = '';
    _run = 0;

    /** [{ Id, Name, Data360_Filter_JSON__c }] from the Person section. */
    @api
    get audienceTypes() {
        return this._audienceTypes;
    }
    set audienceTypes(list) {
        this._audienceTypes = [...(list || [])].sort((a, b) => String(a.Name || '').localeCompare(String(b.Name || '')));
        const signature = this._audienceTypes.map(audience => `${audience.Id}:${audience.Data360_Filter_JSON__c || ''}`).join('|');
        if (signature !== this._signature) {
            this._signature = signature;
            this.loadCounts();
        }
    }

    /** [{ Id, Name, Is_Active__c, Distribution_Percent__c, Audience_Type_Dict__c }] */
    @api
    get paths() {
        return this._paths;
    }
    set paths(list) {
        this._paths = list || [];
        this.tip = null;
    }

    @api
    refresh() {
        this.loadCounts();
    }

    disconnectedCallback() {
        this._run += 1;
    }

    loadCounts() {
        const run = ++this._run;
        const next = {};
        const pending = [];
        this._audienceTypes.forEach(audience => {
            if (audience.Data360_Filter_JSON__c) {
                next[audience.Id] = { status: 'loading' };
                pending.push(audience);
            } else {
                next[audience.Id] = { status: 'none' };
            }
        });
        this.counts = next;
        pending.forEach(audience => {
            getFilterCount({ filterJson: audience.Data360_Filter_JSON__c })
                .then(count => {
                    if (run === this._run) this.counts = { ...this.counts, [audience.Id]: { status: 'ok', count } };
                })
                .catch(error => {
                    if (run === this._run) {
                        this.counts = {
                            ...this.counts,
                            [audience.Id]: { status: 'error', error: error?.body?.message || error?.message || 'The count failed.' }
                        };
                    }
                });
        });
    }

    // ─── View model ──────────────────────────────────────────────────────────

    get activePaths() {
        return this._paths
            .filter(path => path.Is_Active__c)
            .sort((a, b) => String(a.Name || '').localeCompare(String(b.Name || '')));
    }

    colorOf(pathId) {
        const index = this.activePaths.findIndex(path => path.Id === pathId);
        return PALETTE[(index < 0 ? 0 : index) % PALETTE.length];
    }

    populationOf(audienceId) {
        const entry = this.counts[audienceId] || { status: 'none' };
        return entry;
    }

    get legend() {
        return this.activePaths.map(path => ({
            key: path.Id,
            name: path.Name,
            style: `background:${this.colorOf(path.Id)}`
        }));
    }

    get hasActivePaths() {
        return this.activePaths.length > 0;
    }

    get rows() {
        return this._audienceTypes.map(audience => {
            const members = this.activePaths.filter(path => path.Audience_Type_Dict__c === audience.Id);
            const total = members.reduce((sum, path) => sum + (Number(path.Distribution_Percent__c) || 0), 0);
            const population = this.populationOf(audience.Id);
            const segments = members.map(path => {
                const percent = Number(path.Distribution_Percent__c) || 0;
                return {
                    key: path.Id,
                    pathId: path.Id,
                    audienceId: audience.Id,
                    percent,
                    label: percent >= LABEL_MIN_PERCENT ? `${percent}%` : '',
                    style: `flex-grow:${percent};background:${this.colorOf(path.Id)}`,
                    aria: `${path.Name}: ${percent}% of ${audience.Name}`
                };
            });
            const gap = Math.round((100 - total) * 100) / 100;
            return {
                key: audience.Id,
                name: audience.Name,
                hasSegments: segments.length > 0,
                segments,
                unallocatedStyle: gap > 0 && segments.length ? `flex-grow:${gap}` : '',
                hasUnallocated: gap > 0 && segments.length > 0,
                unallocatedLabel: `${gap}% unallocated`,
                populationText: population.status === 'ok'
                    ? `${number.format(population.count)} unified individuals`
                    : population.status === 'loading' ? 'counting...' : '',
                over: total > 100.005
            };
        });
    }

    get hasRows() {
        return this._audienceTypes.length > 0;
    }

    get tipStyle() {
        return this.tip ? `left:${this.tip.left}px;top:${this.tip.top}px` : '';
    }

    // ─── Tooltip ─────────────────────────────────────────────────────────────

    showTip(event) {
        const { audience: audienceId, path: pathId } = event.currentTarget.dataset;
        const audience = this._audienceTypes.find(item => item.Id === audienceId);
        const path = this._paths.find(item => item.Id === pathId);
        if (!audience || !path) return;
        const percent = Number(path.Distribution_Percent__c) || 0;
        const population = this.populationOf(audienceId);
        let populationLine;
        if (population.status === 'ok') {
            populationLine = `≈ ${number.format(Math.round((population.count * percent) / 100))} unified individuals`;
        } else if (population.status === 'loading') {
            populationLine = 'Counting the audience...';
        } else if (population.status === 'error') {
            populationLine = `Population unavailable: ${population.error}`;
        } else {
            populationLine = 'Population unavailable: define a Data360 filter for this audience type in the Person section.';
        }
        const segment = event.currentTarget.getBoundingClientRect();
        const host = this.template.querySelector('.path-chart').getBoundingClientRect();
        this.tip = {
            left: Math.round(segment.left - host.left + segment.width / 2),
            top: Math.round(segment.top - host.top),
            title: path.Name,
            audience: audience.Name,
            allocation: `${percent}% of ${audience.Name}`,
            population: populationLine,
            audiencePopulation: population.status === 'ok' ? `${audience.Name} audience: ${number.format(population.count)} unified individuals` : ''
        };
    }

    hideTip() {
        this.tip = null;
    }
}
