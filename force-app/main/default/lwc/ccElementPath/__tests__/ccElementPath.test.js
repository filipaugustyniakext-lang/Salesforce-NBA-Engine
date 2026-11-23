import { createElement } from 'lwc';
import CcElementPath from 'c/ccElementPath';
import { inspectNode } from 'c/ccElementMarking';

const HTML = '<div class="body"><table><tr><td><p>One</p><img src="a.png"><span data-cc-content="richText" data-cc-key="k">x</span></td></tr></table></div>';
const flush = () => Promise.resolve();

function nodeOf(selector) {
    const holder = document.createElement('div');
    holder.innerHTML = HTML;
    return Array.from(holder.querySelectorAll('*')).indexOf(holder.querySelector(selector));
}

async function mount(selector, props = {}) {
    const element = createElement('c-cc-element-path', { is: CcElementPath });
    element.info = inspectNode(HTML, nodeOf(selector));
    Object.assign(element, props);
    document.body.appendChild(element);
    await flush();
    return element;
}

const crumbs = (element, row) => Array.from(element.shadowRoot.querySelectorAll(row === 1 ? 'nav .cc-path__crumb' : 'div.cc-path__row .cc-path__crumb'));

describe('c-cc-element-path', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    });

    it('shows the path with the picked element highlighted and the children below', async () => {
        const element = await mount('td');
        const path = crumbs(element, 1);
        expect(path.map(item => item.textContent)).toEqual(['div.body', 'table', 'tbody', 'tr', 'td']);
        expect(path[4].disabled).toBe(true);
        expect(path[4].className).toContain('cc-path__crumb_current');
        const inside = crumbs(element, 2);
        expect(inside.map(item => item.textContent)).toEqual(['p', 'img', 'span']);
        expect(inside[2].className).toContain('cc-path__crumb_marked');
    });

    it('emits the node of the clicked parent or child', async () => {
        const element = await mount('td');
        const picks = [];
        element.addEventListener('pick', event => picks.push(event.detail.node));
        crumbs(element, 1)[1].click();
        crumbs(element, 2)[1].click();
        expect(picks).toEqual([nodeOf('table'), nodeOf('img')]);
    });

    it('offers "Group all children" only when asked to and when there are several children', async () => {
        const plain = await mount('td');
        expect(plain.shadowRoot.querySelector('.cc-path__crumb_action')).toBeNull();
        const grouping = await mount('td', { allowGroup: true });
        const events = [];
        grouping.addEventListener('groupchildren', () => events.push('group'));
        grouping.shadowRoot.querySelector('.cc-path__crumb_action').click();
        expect(events).toEqual(['group']);
        const single = await mount('table', { allowGroup: true });
        expect(single.shadowRoot.querySelector('.cc-path__crumb_action')).toBeNull();
    });

    it('renders nothing without an element and says when children are not all shown', async () => {
        const empty = createElement('c-cc-element-path', { is: CcElementPath });
        document.body.appendChild(empty);
        await flush();
        expect(empty.shadowRoot.querySelector('.cc-path')).toBeNull();
        const many = createElement('c-cc-element-path', { is: CcElementPath });
        many.info = { path: [{ node: 0, label: 'ul', marked: false }], children: [{ node: 1, label: 'li', marked: false }], childCount: 20 };
        document.body.appendChild(many);
        await flush();
        expect(many.shadowRoot.textContent).toContain('+19 more');
    });
});
