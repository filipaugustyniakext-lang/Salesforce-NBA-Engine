const STORAGE_PREFIX = 'marketingDictionary.';
const URL_TAB_PARAM = 'c__mdTab';
const URL_CHANNEL_PARAM = 'c__mdChannel';
const URL_CHANNEL_SUBTAB_PARAM = 'c__mdChannelTab';
const HASH_STATE_PREFIX = 'mdState=';

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

/** Legacy split AI Agent outbound row — hidden when a single AI Agent uses comm-type flags. */
export function isLegacyAiAgentOutboundChannel(ch) {
    if (!ch || ch.Channel_Type__c !== 'AI Agent') {
        return false;
    }
    const name = (ch.Name || '').trim().toLowerCase();
    return name === 'ai agent outbound' || name.endsWith(' outbound');
}

export function getVisibleChannelRecords(channels) {
    return (channels || []).filter(ch => !isLegacyAiAgentOutboundChannel(ch));
}

export function getChannelDisplayName(ch) {
    if (!ch) {
        return '';
    }
    if (ch.Channel_Type__c === 'AI Agent') {
        const name = (ch.Name || '').trim();
        if (/^AI Agent(\s+(Inbound|Outbound))?$/i.test(name)) {
            return 'AI Agent';
        }
    }
    return ch.Name || '';
}

export function getCommunicationBadges(ch) {
    if (!ch) {
        return [];
    }
    let inbound = ch.Communication_Inbound__c === true;
    let outbound = ch.Communication_Outbound__c === true;
    if (!inbound && !outbound) {
        const n = (ch.Name || '').toLowerCase();
        if (n.includes('inbound')) {
            inbound = true;
        }
        if (n.includes('outbound')) {
            outbound = true;
        }
    }
    const badges = [];
    if (inbound) {
        badges.push({ key: 'in', label: 'in' });
    }
    if (outbound) {
        badges.push({ key: 'out', label: 'out' });
    }
    return badges;
}

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

function readUrlSearchParams() {
    try {
        return new URLSearchParams(window.location.search);
    } catch (e) {
        return null;
    }
}

function readUrlParam(name) {
    const params = readUrlSearchParams();
    return params ? params.get(name) : null;
}

function readHashState() {
    try {
        const raw = (window.location.hash || '').replace(/^#/, '');
        if (!raw.startsWith(HASH_STATE_PREFIX)) {
            return null;
        }
        return JSON.parse(decodeURIComponent(raw.slice(HASH_STATE_PREFIX.length)));
    } catch (e) {
        return null;
    }
}

function writeHashState(state) {
    try {
        const payload = HASH_STATE_PREFIX + encodeURIComponent(JSON.stringify(state));
        const base = `${window.location.pathname}${window.location.search}`;
        window.history.replaceState(null, '', `${base}#${payload}`);
    } catch (e) {
        /* LEX may block hash updates in some contexts */
    }
}

function writeUrlSearchParams(updates) {
    try {
        const targets = [window];
        try {
            if (window.top && window.top !== window) {
                targets.push(window.top);
            }
        } catch (e) {
            /* cross-origin parent */
        }

        targets.forEach(win => {
            try {
                const url = new URL(win.location.href);
                Object.entries(updates).forEach(([name, value]) => {
                    if (value == null || value === '') {
                        url.searchParams.delete(name);
                    } else {
                        url.searchParams.set(name, value);
                    }
                });
                win.history.replaceState(null, '', url.toString());
            } catch (e) {
                /* ignore per target */
            }
        });
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

function readPersistedSnapshot() {
    const fromSession = {
        activeTab: readSession(storageKey('activeTab')),
        channelId: readSession(storageKey('channel.activeChannelId')),
        channelSubTab: readSession(storageKey('channel.activeSubTab'))
    };
    const hash = readHashState();
    // Session reflects the latest tab click; hash/URL are fallbacks only.
    return {
        activeTab: fromSession.activeTab || hash?.activeTab || null,
        channelId: fromSession.channelId || hash?.channelId || null,
        channelSubTab: fromSession.channelSubTab || hash?.channelSubTab || null
    };
}

function writePersistedSnapshot(snapshot) {
    const activeTab = pickValid(snapshot.activeTab, MAIN_TAB_VALUES, DEFAULT_MAIN_TAB);
    writeSession(storageKey('activeTab'), activeTab);
    if (snapshot.channelId) {
        writeSession(storageKey('channel.activeChannelId'), snapshot.channelId);
    }
    const channelSubTab = pickValid(
        snapshot.channelSubTab,
        CHANNEL_SUB_TAB_VALUES,
        DEFAULT_CHANNEL_SUB_TAB
    );
    writeSession(storageKey('channel.activeSubTab'), channelSubTab);

    const hashPayload = {
        activeTab,
        channelId: snapshot.channelId || null,
        channelSubTab
    };
    writeHashState(hashPayload);

    const urlUpdates = { [URL_TAB_PARAM]: activeTab };
    if (activeTab === 'channel') {
        urlUpdates[URL_CHANNEL_PARAM] = snapshot.channelId || null;
        urlUpdates[URL_CHANNEL_SUBTAB_PARAM] = channelSubTab;
    } else {
        urlUpdates[URL_CHANNEL_PARAM] = null;
        urlUpdates[URL_CHANNEL_SUBTAB_PARAM] = null;
    }
    writeUrlSearchParams(urlUpdates);
}

/**
 * Main tab: session/hash first (last in-app navigation), then URL deep link, then default.
 */
export function resolveMainTab() {
    const snapshot = readPersistedSnapshot();
    const fromSession = snapshot.activeTab;
    if (fromSession && MAIN_TAB_VALUES.includes(fromSession)) {
        return fromSession;
    }
    const fromUrl = readUrlParam(URL_TAB_PARAM);
    if (fromUrl && MAIN_TAB_VALUES.includes(fromUrl)) {
        return fromUrl;
    }
    return DEFAULT_MAIN_TAB;
}

export function persistMainTab(tab) {
    const value = pickValid(tab, MAIN_TAB_VALUES, DEFAULT_MAIN_TAB);
    const snapshot = readPersistedSnapshot();
    snapshot.activeTab = value;
    if (value !== 'channel') {
        snapshot.channelId = snapshot.channelId || null;
    }
    writePersistedSnapshot(snapshot);
    return value;
}

export function resolveChannelSubTab() {
    const snapshot = readPersistedSnapshot();
    const fromSession = snapshot.channelSubTab;
    if (fromSession && CHANNEL_SUB_TAB_VALUES.includes(fromSession)) {
        return fromSession;
    }
    const fromUrl = readUrlParam(URL_CHANNEL_SUBTAB_PARAM);
    if (fromUrl && CHANNEL_SUB_TAB_VALUES.includes(fromUrl)) {
        return fromUrl;
    }
    return DEFAULT_CHANNEL_SUB_TAB;
}

export function resolveChannelId(channelRecords) {
    const list = channelRecords || [];
    const snapshot = readPersistedSnapshot();
    const candidates = [
        snapshot.channelId,
        readUrlParam(URL_CHANNEL_PARAM)
    ].filter(Boolean);
    for (const candidate of candidates) {
        const match = list.find(ch => idsMatch(ch.Id, candidate));
        if (match) return match.Id;
    }
    return list[0]?.Id || null;
}

export function persistChannelSelection(channelId, subTab) {
    const snapshot = readPersistedSnapshot();
    snapshot.activeTab = 'channel';
    if (channelId) {
        snapshot.channelId = channelId;
    }
    snapshot.channelSubTab = pickValid(subTab, CHANNEL_SUB_TAB_VALUES, DEFAULT_CHANNEL_SUB_TAB);
    writePersistedSnapshot(snapshot);
}

/**
 * lightning-tabset `onactive` — value may be on target or detail depending on runtime.
 */
export function mainTabFromActiveEvent(event) {
    const candidates = [
        event?.detail?.value,
        event?.detail?.activeTabValue,
        event?.target?.value
    ];
    for (const candidate of candidates) {
        if (candidate && MAIN_TAB_VALUES.includes(candidate)) {
            return candidate;
        }
    }
    return null;
}
