import { createElement } from 'lwc';
import CcShellSteps from 'c/ccShellSteps';
import { shellProgress } from 'c/ccElementMarking';

const flush = () => Promise.resolve();

async function mount(definition, activeStep = 1) {
    const element = createElement('c-cc-shell-steps', { is: CcShellSteps });
    element.progress = shellProgress(definition);
    element.activeStep = activeStep;
    document.body.appendChild(element);
    await flush();
    return element;
}

const cards = element => Array.from(element.shadowRoot.querySelectorAll('.cc-steps__card'));

describe('c-cc-shell-steps', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('locks later steps until the earlier ones are done', async () => {
        const element = await mount({ regions: [] });
        expect(cards(element).map(card => card.disabled)).toEqual([false, true, true]);
        expect(cards(element)[1].textContent).toContain('Finish step 1 first');
        expect(cards(element)[2].textContent).toContain('Finish steps 1 and 2 first');
        const events = [];
        element.addEventListener('stepselect', event => events.push(event.detail.step));
        cards(element)[1].click();
        expect(events).toEqual([]);
        cards(element)[0].click();
        expect(events).toEqual([1]);
    });

    it('unlocks step 2 after areas, step 3 after the dropzone, and lets done steps be reopened', async () => {
        const areas = await mount({ regions: [{ regionId: 'h', kind: 'fixed-read' }, { regionId: 'f', kind: 'fixed-edit' }] }, 2);
        expect(cards(areas).map(card => card.disabled)).toEqual([false, false, true]);
        expect(cards(areas)[0].textContent).toContain('2 areas');
        expect(cards(areas)[1].getAttribute('aria-current')).toBe('step');

        const complete = await mount({
            regions: [{ regionId: 'h', kind: 'fixed-read' }, { regionId: 'f', kind: 'fixed-edit' }, { regionId: 'c', kind: 'blocks' }],
            contentSlots: [{ bindingKey: 'a' }]
        }, 3);
        expect(cards(complete).map(card => card.disabled)).toEqual([false, false, false]);
        expect(cards(complete)[1].textContent).toContain('Placed');
        expect(cards(complete)[2].textContent).toContain('1 binding');
        const events = [];
        complete.addEventListener('stepselect', event => events.push(event.detail.step));
        cards(complete)[0].click();
        expect(events).toEqual([1]);
    });

    it('accepts "no fixed areas" as a finished step 1 and says when nothing can be edited', async () => {
        const element = await mount({ regions: [{ regionId: 'c', kind: 'blocks' }], setup: { noFixedAreas: true } });
        expect(cards(element)[0].textContent).toContain('No fixed areas');
        expect(cards(element)[2].textContent).toContain('Nothing to edit');
        const editable = await mount({ regions: [{ regionId: 'e', kind: 'fixed-edit' }, { regionId: 'c', kind: 'blocks' }] });
        expect(cards(editable)[2].textContent).toContain('Mark what marketers can edit');
    });
});
