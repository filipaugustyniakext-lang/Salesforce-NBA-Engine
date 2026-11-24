import { createElement } from 'lwc';
import MarketingDictionaryValueId from 'c/marketingDictionaryValueId';

const ID = 'a0Vds000006l6CzEAI';
const flush = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
};
const q = (element, selector) => element.shadowRoot.querySelector(selector);

function mount(recordId = ID) {
    const element = createElement('c-marketing-dictionary-value-id', { is: MarketingDictionaryValueId });
    element.recordId = recordId;
    document.body.appendChild(element);
    return element;
}

describe('c-marketing-dictionary-value-id', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        if (original) Object.defineProperty(navigator, 'clipboard', original);
        else delete navigator.clipboard;
        document.execCommand = undefined;
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it('shows the value ID with a copy button, and nothing without an ID', async () => {
        const element = mount();
        await flush();
        expect(q(element, '.value-id__text').textContent).toBe(ID);
        expect(q(element, 'lightning-button-icon').iconName).toBe('utility:copy');
        expect(q(element, 'lightning-button-icon').alternativeText).toBe('Copy value ID');

        const empty = mount(null);
        await flush();
        expect(q(empty, '.value-id')).toBeNull();
    });

    it('copies the ID, confirms it for a moment, and does not trigger the row it sits in', async () => {
        jest.useFakeTimers();
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const element = mount();
        const rowClicks = jest.fn();
        document.body.addEventListener('click', rowClicks);
        await flush();

        q(element, 'lightning-button-icon').dispatchEvent(new CustomEvent('click', { bubbles: true, composed: true }));
        await flush();
        expect(writeText).toHaveBeenCalledWith(ID);
        expect(q(element, 'lightning-button-icon').iconName).toBe('utility:check');
        expect(q(element, 'lightning-button-icon').title).toBe('Copied');
        expect(q(element, '[aria-live]').textContent).toBe('Value ID copied');
        expect(rowClicks).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1600);
        await flush();
        expect(q(element, 'lightning-button-icon').iconName).toBe('utility:copy');
        document.body.removeEventListener('click', rowClicks);
    });

    it('falls back to the browser copy command when the clipboard API is missing', async () => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        document.execCommand = jest.fn().mockReturnValue(true);
        const element = mount();
        await flush();
        q(element, 'lightning-button-icon').click();
        await flush();
        expect(document.execCommand).toHaveBeenCalledWith('copy');
        expect(q(element, 'lightning-button-icon').iconName).toBe('utility:check');
    });

    it('warns instead of failing silently when copying is not possible', async () => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: jest.fn().mockRejectedValue(new Error('Denied')) }, configurable: true });
        const element = mount();
        const toasts = [];
        element.addEventListener('lightning__showtoast', event => toasts.push(event.detail));
        await flush();
        q(element, 'lightning-button-icon').click();
        await flush();
        expect(toasts).toHaveLength(1);
        expect(toasts[0]).toMatchObject({ variant: 'warning', message: 'Denied' });
        expect(q(element, 'lightning-button-icon').iconName).toBe('utility:copy');
    });
});
