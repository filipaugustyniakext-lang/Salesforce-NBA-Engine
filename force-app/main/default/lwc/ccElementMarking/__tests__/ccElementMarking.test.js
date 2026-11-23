import { annotateNodes, inspectNode, applyMarking, isUnmarked, nodeElement, rangeBetween, inspectGroup, wrapElements, insertBlocksZone } from 'c/ccElementMarking';
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

const PAGE = `<div id="page">
  <table id="top" class="header"><tr><td>Logo</td></tr></table>
  <table id="nav"><tr><td>Menu</td></tr></table>
  <table id="body-copy"><tr><td>Promo</td></tr></table>
  <table id="footer-a"><tr><td>Legal A</td></tr></table>
  <table id="footer-b"><tr><td>Legal B</td></tr></table>
</div>`;

function node(html, selector) {
    return indexOfSelector(html, selector);
}

describe('groups of siblings', () => {
    it('selects the run of siblings between two clicks and rejects different parents', () => {
        const range = rangeBetween(PAGE, node(PAGE, '#footer-b'), node(PAGE, '#nav'));
        expect(range.error).toBeNull();
        expect(range.nodes).toEqual([node(PAGE, '#nav'), node(PAGE, '#body-copy'), node(PAGE, '#footer-a'), node(PAGE, '#footer-b')]);
        expect(rangeBetween(PAGE, 3, 3)).toEqual({ nodes: [3], error: null });
        const mixed = rangeBetween(PAGE, node(PAGE, '#footer-a'), node(PAGE, '#footer-b td'));
        expect(mixed.error).toContain('same parent');
        expect(rangeBetween(PAGE, 1, 999).error).toContain('no longer exists');
    });

    it('describes a group and explains when it cannot be wrapped', () => {
        const group = inspectGroup(PAGE, [node(PAGE, '#footer-a'), node(PAGE, '#footer-b')]);
        expect(group).toMatchObject({ count: 2, wrapperTag: 'div', problem: '', parentLabel: 'div#page' });
        expect(group.labels).toEqual(['table#footer-a', 'table#footer-b']);
        const cells = '<table><tr><td>a</td><td>b</td></tr></table>';
        expect(inspectGroup(cells, [3, 4]).problem).toContain('table row');
        expect(inspectGroup(PAGE, [node(PAGE, '#footer-a')])).toBeNull();
        const gap = inspectGroup(PAGE, [node(PAGE, '#top'), node(PAGE, '#footer-b')]);
        expect(gap.problem).toContain('next to each other');
    });

    it('wraps neighbouring tables in a div region (the black footer case) that parses cleanly', () => {
        const result = wrapElements(PAGE, [node(PAGE, '#footer-a'), node(PAGE, '#footer-b')], { regionKind: 'fixed-read', id: 'footer' }, { kind: 'shell' });
        expect(result.errors).toEqual([]);
        const wrapper = nodeElement(result.html, result.markedNode);
        expect(wrapper.tagName).toBe('DIV');
        expect(wrapper.getAttribute('data-cc-region')).toBe('fixed-read');
        expect(Array.from(wrapper.children).map(child => child.id)).toEqual(['footer-a', 'footer-b']);
        expect(wrapper.parentElement.id).toBe('page');
        const parsed = parseTemplate(result.html, { kind: 'shell', templateMode: 'multi' });
        expect(parsed.definition.regions).toEqual([{ regionId: 'footer', kind: 'fixed-read' }]);
    });

    it('wraps table rows in their own tbody, splitting the original body', () => {
        const table = '<table><tbody><tr><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr><tr><td>4</td></tr></tbody></table>';
        const rows = [node(table, 'tr:nth-child(2)'), node(table, 'tr:nth-child(3)')];
        const result = wrapElements(table, rows, { regionKind: 'fixed-edit' }, { kind: 'shell' });
        expect(result.errors).toEqual([]);
        const { doc } = parseHtml(result.html);
        const bodies = Array.from(doc.querySelectorAll('tbody'));
        expect(bodies.map(body => `${body.getAttribute('data-cc-region') || '-'}:${body.children.length}`)).toEqual(['-:1', 'fixed-edit:2', '-:1']);

        const first = wrapElements(table, [node(table, 'tr:nth-child(1)'), node(table, 'tr:nth-child(2)')], { regionKind: 'fixed-read' }, { kind: 'shell' });
        const firstBodies = Array.from(parseHtml(first.html).doc.querySelectorAll('tbody'));
        expect(firstBodies.map(body => body.children.length)).toEqual([2, 2]);
    });

    it('keeps comments between grouped elements, and rejects invalid groups', () => {
        const html = '<div><p id="a">a</p><!--[if mso]><i></i><![endif]--><p id="b">b</p></div>';
        const result = wrapElements(html, [node(html, '#a'), node(html, '#b')], { regionKind: 'fixed-read' }, { kind: 'shell' });
        expect(result.html).toContain('<div data-cc-region="fixed-read"><p id="a">a</p><!--[if mso]><i></i><![endif]--><p id="b">b</p></div>');

        const fail = (nodes, marking, options) => wrapElements(PAGE, nodes, marking, options).errors.join(' ');
        const two = [node(PAGE, '#footer-a'), node(PAGE, '#footer-b')];
        expect(fail(two, { regionKind: 'blocks' }, { kind: 'shell' })).toContain('inserted, not wrapped');
        expect(fail(two, { regionKind: 'fixed-read' }, { kind: 'block' })).toContain('only be set in the template shell');
        expect(fail([node(PAGE, '#top'), node(PAGE, '#footer-b td')], { regionKind: 'fixed-read' }, { kind: 'shell' })).toContain('share one parent');
        expect(fail(two, { regionKind: 'fixed-read', id: 'page' }, { kind: 'shell' })).toBe('');
        expect(fail([node(PAGE, '#top td'), node(PAGE, '#top td')], { regionKind: 'fixed-read' }, { kind: 'shell' })).toBe('');
        const cells = '<table><tr><td>a</td><td>b</td></tr></table>';
        expect(wrapElements(cells, [3, 4], { regionKind: 'fixed-read' }, { kind: 'shell' }).errors.join(' ')).toContain('table row');
    });

    it('does not allow nested regions', () => {
        const outer = wrapElements(PAGE, [node(PAGE, '#footer-a'), node(PAGE, '#footer-b')], { regionKind: 'fixed-read', id: 'footer' }, { kind: 'shell' });
        const again = wrapElements(outer.html, [node(outer.html, '#footer-a'), node(outer.html, '#footer-b')], { regionKind: 'fixed-edit' }, { kind: 'shell' });
        expect(again.errors.join(' ')).toContain('already inside a region');
        const single = applyMarking(outer.html, node(outer.html, '#footer-a'), { role: 'region', regionKind: 'fixed-read' }, { kind: 'shell' });
        expect(single.errors.join(' ')).toContain('already inside a region');
        const parent = applyMarking(outer.html, node(outer.html, '#page'), { role: 'region', regionKind: 'fixed-read' }, { kind: 'shell' });
        expect(parent.errors.join(' ')).toContain('contains another region');
        const nested = '<div data-cc-region="fixed-read"><div data-cc-region="fixed-edit"></div></div>';
        expect(parseTemplate(nested, { kind: 'shell', templateMode: 'multi' }).errors.join(' ')).toContain('Regions cannot be nested');
    });
});

describe('blocks zone', () => {
    const shell = (html, selector, position, options) => {
        const result = insertBlocksZone(html, node(html, selector), position, options);
        return result;
    };

    it('inserts an empty zone before or after a wrapper and the shell becomes valid', () => {
        let html = wrapElements(PAGE, [node(PAGE, '#footer-a'), node(PAGE, '#footer-b')], { regionKind: 'fixed-read', id: 'footer' }, { kind: 'shell' }).html;
        const before = shell(html, '[data-cc-id="footer"]', 'before');
        expect(before.errors).toEqual([]);
        const zone = nodeElement(before.html, before.markedNode);
        expect(zone.outerHTML).toBe('<div data-cc-region="blocks" data-cc-id="content"></div>');
        expect(zone.nextElementSibling.getAttribute('data-cc-id')).toBe('footer');
        expect(parseTemplate(before.html, { kind: 'shell', templateMode: 'multi' }).errors).toEqual([]);

        const after = shell(html, '#top', 'after');
        expect(nodeElement(after.html, after.markedNode).previousElementSibling.id).toBe('top');
        html = after.html;
        expect(shell(html, '#top', 'inside-end', { kind: 'shell' }).errors).toEqual([]);
    });

    it('moves an existing zone instead of adding a second one', () => {
        const first = shell(PAGE, '#top', 'after');
        const moved = shell(first.html, '#footer-b', 'after');
        expect(moved.errors).toEqual([]);
        const { doc } = parseHtml(moved.html);
        const zones = doc.querySelectorAll('[data-cc-region="blocks"]');
        expect(zones).toHaveLength(1);
        expect(zones[0].previousElementSibling.id).toBe('footer-b');
        expect(shell(first.html, '[data-cc-region="blocks"]', 'after').errors.join(' ')).toContain('outside the current blocks zone');
    });

    it('builds a table row for table contexts and refuses invalid spots', () => {
        const table = '<table><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table>';
        const result = shell(table, 'tr', 'after');
        expect(result.errors).toEqual([]);
        expect(nodeElement(result.html, result.markedNode).tagName).toBe('TD');
        expect(result.html).toContain('<tr><td data-cc-region="blocks" data-cc-id="content"></td></tr>');

        expect(shell(table, 'td', 'after').errors.join(' ')).toContain('between table cells');
        expect(shell('<ul><li>a</li></ul>', 'li', 'after').errors.join(' ')).toContain('inside a list');
        const wrapped = wrapElements(PAGE, [node(PAGE, '#footer-a'), node(PAGE, '#footer-b')], { regionKind: 'fixed-read', id: 'footer' }, { kind: 'shell' }).html;
        expect(shell(wrapped, '#footer-a', 'after').errors.join(' ')).toContain('inside another region');
        expect(shell(PAGE, '#top', 'after', { kind: 'block' }).errors.join(' ')).toContain('multi-block shells');
        expect(shell(PAGE, '#top', 'after', { kind: 'shell', templateMode: 'single' }).errors.join(' ')).toContain('multi-block shells');
        expect(shell(PAGE, '#top', 'sideways').errors.join(' ')).toContain('Choose where');
        expect(insertBlocksZone(PAGE, 999, 'after').errors.join(' ')).toContain('no longer exists');
    });

    it('suggests regions for layout areas of a multi-block shell', () => {
        const options = { kind: 'shell', templateMode: 'multi' };
        const info = inspectNode(PAGE, node(PAGE, '#footer-a'), options);
        expect(info.suggestion).toMatchObject({ role: 'region', regionKind: 'fixed-read' });
        expect(info.hasBlocksZone).toBe(false);
        const withZone = shell(PAGE, '#top', 'after').html;
        expect(inspectNode(withZone, node(withZone, '#nav'), options).hasBlocksZone).toBe(true);
        const editable = wrapElements(PAGE, [node(PAGE, '#footer-a'), node(PAGE, '#footer-b')], { regionKind: 'fixed-edit', id: 'footer' }, { kind: 'shell' }).html;
        const inside = inspectNode(editable, node(editable, '#footer-a td'), options);
        expect(inside.inEditableRegion).toBe(true);
        expect(inside.suggestion.role).toBe('content');
        expect(inspectNode(PAGE, node(PAGE, '#footer-a'), { kind: 'block' }).suggestion.role).toBe('section');
        expect(parseTemplate('<div data-cc-region="fixed-read"><p data-cc-content="richText" data-cc-key="t">x</p></div><div data-cc-region="blocks"></div>', { kind: 'shell', templateMode: 'multi' }).warnings.join(' ')).toContain('not inside an editable region');
    });
});
