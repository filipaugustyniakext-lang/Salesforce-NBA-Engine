import { createElement } from 'lwc';
import CcTemplateManager from 'c/ccTemplateManager';
import getTemplates from '@salesforce/apex/CcTemplateDefinitionController.getTemplates';

jest.mock('@salesforce/apex/CcTemplateDefinitionController.getTemplates', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CcTemplateDefinitionController.archiveTemplate', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CcTemplateDefinitionController.deleteTemplate', () => ({ default: jest.fn() }), { virtual: true });

const TEMPLATES = [
    { id: 't1', name: 'TEMP_pl_PL_Master_Commercial', status: 'Active', isV1: true, templateMode: 'multi', localeCode: 'pl_PL', classification: 'Commercial', messageCount: 3, liveMessageCount: 1, validationStatus: 'Valid', blocks: [{ status: 'Active' }, { status: 'Draft' }] },
    { id: 't2', name: 'TEMP_PL_mainBanner_Commercial', status: 'Draft', isV1: false, templateMode: 'multi', messageCount: 0, liveMessageCount: 0, blocks: [] }
];

function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('c-cc-template-manager', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('renders templates with legacy upgrade and guarded actions', async () => {
        getTemplates.mockResolvedValue(TEMPLATES);
        const element = createElement('c-cc-template-manager', { is: CcTemplateManager });
        element.channelId = 'a01';
        document.body.appendChild(element);
        await flush();

        expect(getTemplates).toHaveBeenCalledWith({ channelId: 'a01' });
        const rows = element.shadowRoot.querySelectorAll('tbody tr');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('1 active / 2');
        const firstButtons = Array.from(rows[0].querySelectorAll('lightning-button')).map(button => button.label);
        expect(firstButtons).toEqual(['Open', 'Archive']);
        expect(rows[0].querySelector('lightning-button-icon')).toBeNull();
        const secondButtons = Array.from(rows[1].querySelectorAll('lightning-button')).map(button => button.label);
        expect(secondButtons).toEqual(['Upgrade to v1']);
        expect(rows[1].querySelector('lightning-button-icon')).not.toBeNull();
    });
});
