const STORAGE_PREFIX = 'marketingDictionary.';
const URL_TAB_PARAM = 'c__mdTab';
const URL_CHANNEL_PARAM = 'c__mdChannel';
const URL_CHANNEL_SUBTAB_PARAM = 'c__mdChannelTab';

export const MAIN_TAB_VALUES = [
    'person',
    'product',
    'offer',
    'campaign',
    'scoring',
    'channel',
    'blackout'
];

export const CHANNEL_SUB_TAB_VALUES = [
    'cooldown',
    'weekly',
    'templates',
    'placements',
    'intents'
];

const DEFAULT_MAIN_TAB = 'person';
const DEFAULT_CHANNEL_SUB_TAB = 'cooldown';

function storageKey(suffix) {
    return `${STORAGE_PREFIX}${suffix}`;
}

function readSession(key) {
    try {
        return window.sessionStorage.getItem(key);
    } catch (e) {
        return null;
    }
}

function writeSession(key, value) {
    try {
        if (value == null || value === '') {
            window.sessionStorage.removeItem(key);
        } else {
            window.sessionStorage.setItem(key, value);
        }
    } catch (e) {
        /* private browsing / blocked storage */
    }
}

function readUrlParam(name) {
    try {
        return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
        return null;
    }
}

function writeUrlParams(updates) {
    try {
        const url = new URL(window.location.href);
        Object.entries(updates).forEach(([name, value]) => {
            if (value == null || value === '') {
                url.searchParams.delete(name);
            } else {
                url.searchParams.set(name, value);
            }
        });
        window.history.replaceState(null, '', url.toString());
    } catch (e) {
        /* not available in some embedded contexts */
    }
}

function normalizeSalesforceId(id) {
    if (!id) return '';
    return String(id).substring(0, 15);
}

function idsMatch(a, b) {
    if (!a || !b) return false;
    return normalizeSalesforceId(a) === normalizeSalesforceId(b);
}

function pickValid(value, allowed, fallback) {
    return value && allowed.includes(value) ? value : fallback;
}

/**
 * Resolve main Marketing Dictionary tab (URL overrides session storage).
 */
export function resolveMainTab() {
    const fromUrl = readUrlParam(URL_TAB_PARAM);
    if (fromUrl && MAIN_TAB_VALUES.includes(fromUrl)) {
        return fromUrl;
    }
    const fromSession = readSession(storageKey('activeTab'));
    return pickValid(fromSession, MAIN_TAB_VALUES, DEFAULT_MAIN_TAB);
}

export function persistMainTab(tab) {
    const value = pickValid(tab, MAIN_TAB_VALUES, DEFAULT_MAIN_TAB);
    writeSession(storageKey('activeTab'), value);
    const urlUpdates = { [URL_TAB_PARAM]: value };
    if (value !== 'channel') {
        urlUpdates[URL_CHANNEL_PARAM] = null;
        urlUpdates[URL_CHANNEL_SUBTAB_PARAM] = null;
    }
    writeUrlParams(urlUpdates);
    return value;
}

export function resolveChannelSubTab() {
    const fromUrl = readUrlParam(URL_CHANNEL_SUBTAB_PARAM);
    if (fromUrl && CHANNEL_SUB_TAB_VALUES.includes(fromUrl)) {
        return fromUrl;
    }
    const fromSession = readSession(storageKey('channel.activeSubTab'));
    return pickValid(fromSession, CHANNEL_SUB_TAB_VALUES, DEFAULT_CHANNEL_SUB_TAB);
}

export function resolveChannelId(channelRecords) {
    const list = channelRecords || [];
    const fromUrl = readUrlParam(URL_CHANNEL_PARAM);
    const fromSession = readSession(storageKey('channel.activeChannelId'));
    const candidates = [fromUrl, fromSession].filter(Boolean);
    for (const candidate of candidates) {
        const match = list.find(ch => idsMatch(ch.Id, candidate));
        if (match) return match.Id;
    }
    return list[0]?.Id || null;
}

export function persistChannelSelection(channelId, subTab) {
    if (channelId) {
        writeSession(storageKey('channel.activeChannelId'), channelId);
    }
    const sub = pickValid(subTab, CHANNEL_SUB_TAB_VALUES, DEFAULT_CHANNEL_SUB_TAB);
    writeSession(storageKey('channel.activeSubTab'), sub);
    writeUrlParams({
        [URL_TAB_PARAM]: 'channel',
        [URL_CHANNEL_PARAM]: channelId || null,
        [URL_CHANNEL_SUBTAB_PARAM]: sub
    });
}
