import { createElement } from 'lwc';
import CcShellSteps from 'c/ccShellSteps';
import { shellProgress, blockProgress } from 'c/ccElementMarking';

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

    it('shows the block steps: layout sections, content, settings and presets', async () => {
        const make = async (definition, activeStep = 1) => {
            const element = createElement('c-cc-shell-steps', { is: CcShellSteps });
            element.variant = 'block';
            element.progress = blockProgress(definition);
            element.activeStep = activeStep;
            document.body.appendChild(element);
            await flush();
            return element;
        };
        const fresh = await make({ sections: [], contentSlots: [] });
        expect(cards(fresh).map(card => card.textContent.replace(/\s+/g, ' ').trim())).toEqual([
            '1. Layout sectionsMark container, rows and columns',
            '2. ContentFinish step 1 first',
            '3. Settings and presets (optional)Finish steps 1 and 2 first'
        ]);
        expect(cards(fresh).map(card => card.disabled)).toEqual([false, true, true]);

        const sections = await make({ sections: [{ sectionId: 'a' }, { sectionId: 'b' }], contentSlots: [] }, 2);
        expect(cards(sections)[0].textContent).toContain('2 sections');
        expect(cards(sections).map(card => card.disabled)).toEqual([false, false, true]);
        expect(cards(sections)[1].textContent).toContain('Mark text, images, lists and buttons');

        const full = await make({ sections: [{ sectionId: 'a' }], contentSlots: [{ bindingKey: 'k' }] }, 3);
        expect(cards(full).map(card => card.disabled)).toEqual([false, false, false]);
        expect(cards(full)[1].textContent).toContain('1 binding');
        expect(cards(full)[2].textContent).toContain('Defaults, color presets, editor levels');

        const none = await make({ sections: [], contentSlots: [], setup: { noSections: true } });
        expect(cards(none)[0].textContent).toContain('No layout settings');
        expect(cards(none)[1].disabled).toBe(false);
    });
});
