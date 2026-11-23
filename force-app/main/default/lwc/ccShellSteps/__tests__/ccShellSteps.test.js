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

    it('shows the block steps: containers, settings, content', async () => {
        const make = async (progress, activeStep = 1) => {
            const element = createElement('c-cc-shell-steps', { is: CcShellSteps });
            element.variant = 'block';
            element.progress = progress;
            element.activeStep = activeStep;
            document.body.appendChild(element);
            await flush();
            return element;
        };
        const text = element => cards(element).map(card => card.textContent.replace(/\s+/g, ' ').trim());
        const fresh = await make(blockProgress({ sections: [], contentSlots: [] }));
        expect(text(fresh)).toEqual([
            '1. ContainersIdentify the parent container',
            '2. SettingsFinish step 1 first',
            '3. ContentFinish step 2 first'
        ]);
        expect(cards(fresh).map(card => card.disabled)).toEqual([false, true, true]);

        const rows = await make(blockProgress({ sections: [{ sectionId: 'a', level: 'container', binds: [] }], contentSlots: [] }));
        expect(cards(rows)[0].textContent).toContain('Identify the rows');

        const pending = await make(blockProgress({ sections: [{ sectionId: 'a', level: 'container', binds: ['padding', 'background'] }], contentSlots: [] }), 2);
        expect(text(pending)[1]).toContain('2 placeholders to place');
        expect(cards(pending).map(card => card.disabled)).toEqual([false, false, true]);

        const full = await make(blockProgress({ sections: [{ sectionId: 'a', level: 'container', binds: [] }, { sectionId: 'r', level: 'row', parentId: 'a', binds: [], asColumn: true }], contentSlots: [{ bindingKey: 'k' }] }), 3);
        expect(cards(full).map(card => card.disabled)).toEqual([false, false, false]);
        expect(text(full)[0]).toContain('1 row, 0 columns');
        expect(text(full)[2]).toContain('1 binding');

        const none = await make({ ...blockProgress({ sections: [], contentSlots: [], setup: { noSections: true } }) });
        expect(text(none)[0]).toContain('No layout settings');
        expect(cards(none)[1].disabled).toBe(false);
    });
});
