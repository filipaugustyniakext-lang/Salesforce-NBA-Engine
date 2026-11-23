import { createElement } from 'lwc';
import CcBackgroundInput from 'c/ccBackgroundInput';
import { defaultBackground } from 'c/ccTemplateSchema';

jest.mock('@salesforce/apex/ChannelTemplateController.listCmsImages', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/ChannelTemplateController.contentVersionDownloadUrl', () => ({ default: jest.fn() }), { virtual: true });

const flush = () => Promise.resolve();

async function mount(props = {}) {
    const element = createElement('c-cc-background-input', { is: CcBackgroundInput });
    Object.assign(element, props);
    document.body.appendChild(element);
    await flush();
    return element;
}

const q = (element, selector) => element.shadowRoot.querySelector(selector);

describe('c-cc-background-input', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('offers only the background kinds the template binds', async () => {
        const all = await mount({ allowCustom: true });
        expect(q(all, 'lightning-radio-group').options.map(option => option.value)).toEqual(['none', 'color', 'gradient', 'image']);
        const imageOnly = await mount({ modes: ['image'] });
        expect(q(imageOnly, 'lightning-radio-group').options.map(option => option.value)).toEqual(['none', 'image']);
        const colorAndGradient = await mount({ modes: ['color', 'gradient'] });
        expect(q(colorAndGradient, 'lightning-radio-group').options.map(option => option.value)).toEqual(['none', 'color', 'gradient']);
    });

    it('sets separate images for desktop, mobile, and dark mode with the same inheritance rules', async () => {
        const element = await mount({ modes: ['image'], value: { ...defaultBackground(), mode: 'image' } });
        const changes = [];
        element.addEventListener('change', event => changes.push(event.detail.value));
        const sources = () => Array.from(element.shadowRoot.querySelectorAll('c-cc-image-source-input')).map(item => item.dataset.device);
        expect(sources()).toEqual(['desktop']);

        const desktop = q(element, 'c-cc-image-source-input[data-device="desktop"]');
        desktop.dispatchEvent(new CustomEvent('change', { detail: { value: { source: 'url', url: 'https://example.com/d.jpg', contentId: null } } }));
        expect(changes[0].image.desktop.url).toBe('https://example.com/d.jpg');
        expect(changes[0].image.mobile.url).toBe('https://example.com/d.jpg');

        const mobileInherit = Array.from(element.shadowRoot.querySelectorAll('lightning-input')).find(item => item.label === 'Mobile uses the desktop image');
        mobileInherit.checked = false;
        mobileInherit.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(sources()).toEqual(['desktop', 'mobile']);

        const dark = Array.from(element.shadowRoot.querySelectorAll('lightning-input')).find(item => item.label === 'Use different images in dark mode');
        dark.checked = true;
        dark.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(sources()).toEqual(['desktop', 'mobile', 'dark.desktop']);
        q(element, 'c-cc-image-source-input[data-device="dark.desktop"]').dispatchEvent(new CustomEvent('change', { detail: { value: { source: 'cms', url: 'https://example.com/dark.jpg', contentId: '069x' } } }));
        const last = changes[changes.length - 1];
        expect(last.image.dark.inheritFromLight).toBe(false);
        expect(last.image.dark.desktop).toMatchObject({ source: 'cms', url: 'https://example.com/dark.jpg', contentId: '069x' });
        expect(last.image.dark.mobile.url).toBe('https://example.com/dark.jpg');

        const darkMobile = Array.from(element.shadowRoot.querySelectorAll('lightning-input')).find(item => item.label === 'Dark mode mobile uses the dark desktop image');
        darkMobile.checked = false;
        darkMobile.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(sources()).toEqual(['desktop', 'mobile', 'dark.desktop', 'dark.mobile']);
    });
});
