import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getDictionaryOptionsBySubtype from '@salesforce/apex/MarketingDictionaryManagerController.getDictionaryOptionsBySubtype';
import getProduct2ForEdit from '@salesforce/apex/MarketingDictionaryManagerController.getProduct2ForEdit';
import saveProduct2Record from '@salesforce/apex/MarketingDictionaryManagerController.saveProduct2Record';

export default class ProductManager extends LightningElement {
    /** Pass a Product2 Id to open in edit mode; null/undefined = create mode */
    @api recordId;
    /** Called when the modal should close: dispatch 'close' event */

    @track isLoading = false;
    @track isSaving = false;

    @track draft = {
        Id: null,
        Name: '',
        IsActive: true,
        ProductCode: '',
        Description: '',
        Product_Type_Dict__c: null,
        Family_of_Needs_Dict__c: null,
        Product_Family_Dict__c: null
    };

    _allProductTypes = [];
    _allFoN = [];
    _allProductFamilies = [];
    _allCustomerTypes = [];
    _selectedCtIds = new Set();

    // ── Wire: dictionary option lists ──────────────────────────────────────

    @wire(getDictionaryOptionsBySubtype, { subType: 'Product Type' })
    wiredProductTypes({ data }) { if (data) this._allProductTypes = data; }

    @wire(getDictionaryOptionsBySubtype, { subType: 'Family of Needs' })
    wiredFoN({ data }) { if (data) this._allFoN = data; }

    @wire(getDictionaryOptionsBySubtype, { subType: 'Product Family' })
    wiredProductFamilies({ data }) { if (data) this._allProductFamilies = data; }

    @wire(getDictionaryOptionsBySubtype, { subType: 'Customer Type' })
    wiredCustomerTypes({ data }) { if (data) this._allCustomerTypes = data; }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    connectedCallback() {
        if (this.recordId) {
            this._loadForEdit();
        }
    }

    async _loadForEdit() {
        this.isLoading = true;
        try {
            const data = await getProduct2ForEdit({ productId: this.recordId });
            this.draft = {
                Id: data.Id,
                Name: data.Name || '',
                IsActive: data.IsActive !== false,
                ProductCode: data.ProductCode || '',
                Description: data.Description || '',
                Product_Type_Dict__c: data.Product_Type_Dict__c || null,
                Family_of_Needs_Dict__c: data.Family_of_Needs_Dict__c || null,
                Product_Family_Dict__c: data.Product_Family_Dict__c || null
            };
            this._selectedCtIds = new Set(data.customerTypeIds || []);
        } catch (e) {
            this._toast('Error', e.body?.message || e.message, 'error');
        } finally {
            this.isLoading = false;
        }
    }

    // ── Computed options ───────────────────────────────────────────────────

    get modalTitle() {
        return this.recordId ? 'Edit Product' : 'New Product';
    }

    get productTypeOptions() {
        return this._allProductTypes.map(r => ({
            label: r.Name, value: r.Id,
            selected: this.draft.Product_Type_Dict__c === r.Id
        }));
    }

    get familyOfNeedsOptions() {
        return this._allFoN.map(r => ({
            label: r.Name, value: r.Id,
            selected: this.draft.Family_of_Needs_Dict__c === r.Id
        }));
    }

    get hasFonSelected() { return !!this.draft.Family_of_Needs_Dict__c; }

    get filteredProductFamilyOptions() {
        const fonId = this.draft.Family_of_Needs_Dict__c;
        return this._allProductFamilies
            .filter(r => r.Related_Family_of_Needs__c === fonId)
            .map(r => ({
                label: r.Name, value: r.Id,
                selected: this.draft.Product_Family_Dict__c === r.Id
            }));
    }

    get noFamiliesForFon() {
        return this.hasFonSelected && this.filteredProductFamilyOptions.length === 0;
    }

    get hasCustomerTypes() { return this._allCustomerTypes.length > 0; }

    get customerTypeList() {
        return this._allCustomerTypes.map(ct => ({
            Id: ct.Id,
            Name: ct.Name,
            checked: this._selectedCtIds.has(ct.Id),
            pillClass: this._selectedCtIds.has(ct.Id)
                ? 'pm-ct-pill pm-ct-pill_selected'
                : 'pm-ct-pill'
        }));
    }

    // ── Handlers ───────────────────────────────────────────────────────────

    handleFieldInput(e) {
        const field = e.currentTarget.dataset.field;
        this.draft = { ...this.draft, [field]: e.target.value };
    }

    handleSelectChange(e) {
        const field = e.currentTarget.dataset.field;
        this.draft = { ...this.draft, [field]: e.target.value || null };
    }

    handleFonChange(e) {
        const fonId = e.target.value || null;
        // Reset product family when FoN changes
        this.draft = {
            ...this.draft,
            Family_of_Needs_Dict__c: fonId,
            Product_Family_Dict__c: null
        };
    }

    handleActiveToggle(e) {
        this.draft = { ...this.draft, IsActive: e.target.checked };
    }

    handleCtToggle(e) {
        const ctId = e.currentTarget.dataset.ctId;
        const updated = new Set(this._selectedCtIds);
        if (e.target.checked) { updated.add(ctId); } else { updated.delete(ctId); }
        this._selectedCtIds = updated;
        // Force re-render
        this._allCustomerTypes = [...this._allCustomerTypes];
    }

    handleBackdropClick() { this.handleClose(); }
    handleContainerClick(e) { e.stopPropagation(); }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    async handleSave() {
        if (!this.draft.Name?.trim()) {
            this._toast('Validation', 'Product Name is required', 'error');
            return;
        }
        this.isSaving = true;
        try {
            const savedId = await saveProduct2Record({
                data: {
                    Id: this.draft.Id || null,
                    Name: this.draft.Name.trim(),
                    IsActive: this.draft.IsActive,
                    ProductCode: this.draft.ProductCode || null,
                    Description: this.draft.Description || null,
                    Product_Type_Dict__c: this.draft.Product_Type_Dict__c || null,
                    Family_of_Needs_Dict__c: this.draft.Family_of_Needs_Dict__c || null,
                    Product_Family_Dict__c: this.draft.Product_Family_Dict__c || null
                },
                customerTypeIds: [...this._selectedCtIds]
            });
            this._toast('Success', `Product ${this.recordId ? 'updated' : 'created'} successfully`, 'success');
            this.dispatchEvent(new CustomEvent('saved', { detail: { id: savedId } }));
        } catch (e) {
            this._toast('Error', e.body?.message || e.message, 'error');
        } finally {
            this.isSaving = false;
        }
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}