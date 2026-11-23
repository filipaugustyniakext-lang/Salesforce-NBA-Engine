import { annotateNodes, inspectNode, applyMarking, isUnmarked, nodeElement } from 'c/ccElementMarking';
import { parseTemplate, parseHtml, describeMarked } from 'c/ccTemplateParser';

const RAW = `<html><head><style>.cc-hide-dsk{} .cc-hide-mob{}</style></head><body>
<table class="outer" width="100%"><tr><td class="body">
  <h1>Spring savings</h1>
  <p>Open the account today.</p>
  <img src="https://example.com/hero.png" alt="Hero image" />
  <ul><li>No fees</li><li>Mobile access</li></ul>
  <hr />
  <a href="https://example.com">Open account</a>
</td></tr></table>
<div class="legal">Legal footer</div>
</body></html>`;

function indexOfSelector(html, selector) {
    const { doc } = parseHtml(html);
    const target = doc.body.querySelector(selector);
    return Array.from(doc.body.querySelectorAll('*')).indexOf(target);
}

describe('annotateNodes / inspectNode', () => {
    it('stamps one index per body element and describes any element', () => {
        const annotated = annotateNodes(RAW);
        const { doc } = parseHtml(annotated);
        const stamped = Array.from(doc.body.querySelectorAll('*')).map(element => element.getAttribute('data-cc-node'));
        expect(stamped[0]).toBe('0');
        expect(stamped).toHaveLength(new Set(stamped).size);

        const img = indexOfSelector(RAW, 'img');
        const info = inspectNode(RAW, img);
        expect(info.tag).toBe('img');
        expect(info.suggestion).toMatchObject({ role: 'content', contentType: 'image', key: 'heroImage' });
        expect(info.path.map(item => item.label)).toEqual(['table.outer', 'tbody', 'tr', 'td.body', 'img']);
        expect(info.marks.role).toBe('none');
        expect(inspectNode(RAW, 999)).toBeNull();
    });

    it('suggests by structure and text', () => {
        expect(inspectNode(RAW, indexOfSelector(RAW, 'table')).suggestion).toMatchObject({ role: 'section', level: 'container' });
        expect(inspectNode(RAW, indexOfSelector(RAW, 'p')).suggestion).toMatchObject({ role: 'content', contentType: 'richText', key: 'openTheAccount' });
        expect(inspectNode(RAW, indexOfSelector(RAW, 'a')).suggestion).toMatchObject({ contentType: 'button', key: 'openAccount' });
        expect(inspectNode(RAW, indexOfSelector(RAW, 'ul')).suggestion.contentType).toBe('bulletList');
        expect(inspectNode(RAW, indexOfSelector(RAW, 'hr')).suggestion.contentType).toBe('divider');
        const info = inspectNode(RAW, indexOfSelector(RAW, 'td.body'));
        expect(info.children.map(child => child.label)).toEqual(['h1', 'p', 'img', 'ul', 'hr', 'a']);
    });
});

describe('applyMarking', () => {
    it('builds a valid block from raw HTML step by step', () => {
        let html = RAW;
        const mark = (selector, marking, options) => {
            const result = applyMarking(html, indexOfSelector(html, selector), marking, options);
            expect(result.errors).toEqual([]);
            html = result.html;
            return result;
        };
        mark('table', { role: 'section', level: 'container', binds: ['padding', 'hide'] });
        mark('tr', { role: 'section', level: 'row', binds: ['column-direction'] });
        mark('td.body', { role: 'section', level: 'column', id: 'Main Col', binds: ['padding'] });
        mark('h1', { role: 'content', contentType: 'richText', key: 'headline', label: 'Headline', complexity: 'basic' });
        mark('img', { role: 'content', contentType: 'image', key: 'hero' });
        mark('ul', { role: 'content', contentType: 'bulletList', key: 'benefits', complexity: 'basic' });
        mark('hr', { role: 'content', contentType: 'divider', key: 'divider' });
        mark('a', { role: 'content', contentType: 'button', key: 'cta' });

        const parsed = parseTemplate(html, { kind: 'block' });
        expect(parsed.errors).toEqual([]);
        expect(parsed.definition.sections.map(section => `${section.level}:${section.sectionId}`)).toEqual(['container:block', 'row:row-1', 'column:main-col']);
        expect(parsed.definition.contentSlots.map(slot => `${slot.type}:${slot.bindingKey}`)).toEqual([
            'richText:headline', 'image:hero', 'bulletList:benefits', 'divider:divider', 'button:cta'
        ]);
        expect(parsed.definition.contentSlots[0]).toMatchObject({ label: 'Headline', complexity: 'basic' });
        expect(html).toContain('data-cc-loop="item"');
        expect(html).toContain('data-cc-slot="text"');
        expect(html).toContain('data-cc-slot="line"');
        expect(isUnmarked(parsed.definition)).toBe(false);
    });

    it('wraps a bare <hr> and marks table-based lists with icon and text cells', () => {
        const table = '<table><tr><td><img src="i.png"></td><td>One</td></tr><tr><td><img src="i.png"></td><td>Two</td></tr></table>';
        const result = applyMarking(table, 0, { role: 'content', contentType: 'bulletList', key: 'items' });
        expect(result.errors).toEqual([]);
        expect(result.html).toContain('data-cc-slot="icon-cell"');
        expect(result.html).toContain('data-cc-slot="icon"');
        expect(parseTemplate(result.html, { kind: 'block' }).definition.contentSlots[0].type).toBe('bulletList');

        const hr = applyMarking('<p>a</p><hr>', 1, { role: 'content', contentType: 'divider', key: 'line' });
        expect(hr.html).toContain('<div data-cc-content="divider" data-cc-key="line"><hr data-cc-slot="line"></div>');
        expect(nodeElement(hr.html, hr.markedNode).getAttribute('data-cc-content')).toBe('divider');
    });

    it('rejects wrong element types, duplicate keys and ids, bad regions', () => {
        const html = '<div><img src="a.png"><span>text</span><b data-cc-content="richText" data-cc-key="taken" data-cc-id="used">x</b></div>';
        const apply = (selector, marking, options) => applyMarking(html, indexOfSelector(html, selector), marking, options).errors.join(' ');
        expect(apply('span', { role: 'content', contentType: 'image', key: 'pic' })).toContain('must be an <img>');
        expect(apply('span', { role: 'content', contentType: 'button', key: 'go' })).toContain('must be an <a>');
        expect(apply('img', { role: 'content', contentType: 'image', key: 'taken' })).toContain('already used');
        expect(apply('img', { role: 'content', contentType: 'image', key: '1bad' })).toContain('must start with a letter');
        expect(apply('img', { role: 'content', contentType: 'image', key: '' })).toContain('Enter a binding key');
        expect(apply('span', { role: 'section', level: 'row', id: 'used' })).toContain('already used');
        expect(apply('span', { role: 'section', level: 'column', binds: ['column-direction'] })).toContain('only be bound on a row');
        expect(apply('span', { role: 'region', regionKind: 'blocks' }, { kind: 'block' })).toContain('only be set in the template shell');
        expect(apply('span', { role: 'region', regionKind: 'bogus' }, { kind: 'shell' })).toContain('Choose read-only');
        expect(apply('span', { role: 'what' })).toContain('Choose what this element is');
    });

    it('enforces one blocks region and can remove markings', () => {
        const shell = '<div data-cc-region="blocks" data-cc-id="zone"></div><div id="footer"><p>f</p></div>';
        expect(applyMarking(shell, 1, { role: 'region', regionKind: 'blocks' }, { kind: 'shell' }).errors.join(' ')).toContain('already has a blocks region');
        const footer = applyMarking(shell, 1, { role: 'region', regionKind: 'fixed-edit', id: 'footer-zone' }, { kind: 'shell' });
        expect(footer.errors).toEqual([]);
        expect(parseTemplate(footer.html, { kind: 'shell', templateMode: 'multi' }).errors).toEqual([]);
        const removed = applyMarking(footer.html, 1, { role: 'none' });
        expect(removed.html).not.toContain('fixed-edit');
        expect(describeMarked(nodeElement(removed.html, 1))).toBeNull();
    });

    it('reports a missing element', () => {
        expect(applyMarking('<p>x</p>', 5, { role: 'none' }).errors[0]).toContain('no longer exists');
    });
});
