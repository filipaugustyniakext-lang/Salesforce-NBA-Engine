import { createElement } from 'lwc';
import CampaignCloneAction from 'c/campaignCloneAction';
import { __navigate as navigate } from 'lightning/navigation';

jest.mock('lightning/navigation', () => {
    const Navigate = Symbol('Navigate');
    const mockNavigate = jest.fn();
    const NavigationMixin = Base => class extends Base {
        [Navigate](pageReference) {
            mockNavigate(pageReference);
        }
    };
    NavigationMixin.Navigate = Navigate;
    return { NavigationMixin, __navigate: mockNavigate };
}, { virtual: true });

describe('c-campaign-clone-action', () => {
    afterEach(() => {
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
        jest.clearAllMocks();
    });

    it('opens the clone wizard for the campaign the action was started from', () => {
        const element = createElement('c-campaign-clone-action', { is: CampaignCloneAction });
        element.recordId = '701ds000001AAAAAA4';
        document.body.appendChild(element);
        element.invoke();
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith({
            type: 'standard__component',
            attributes: { componentName: 'c__campaignCloneApp' },
            state: { c__sourceId: '701ds000001AAAAAA4' }
        });
    });

    it('does nothing without a campaign', () => {
        const element = createElement('c-campaign-clone-action', { is: CampaignCloneAction });
        document.body.appendChild(element);
        element.invoke();
        expect(navigate).not.toHaveBeenCalled();
    });
});
