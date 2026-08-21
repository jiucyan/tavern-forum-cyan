import {
    CHAT_DATA_KEY,
    DEFAULT_BUILTIN_PROMPTS,
    DEFAULT_FORUM_PROMPT,
    DEFAULT_SETTINGS,
    EMPTY_FORUM_DATA,
    EXTENSION_PROMPT_POSITION_IN_CHAT,
    EXTENSION_PROMPT_ROLE_SYSTEM,
    INJECTION_ID,
    MODULE_ID,
    NPC_INJECTION_ID,
    WORLD_MODULE_DEFINITIONS,
    WORLD_MODULE_INJECTION_ID,
} from './constants.js';
import { normalizeForumDataShape } from './forum.js';
import { buildForumInjection, buildNpcInjection, createId, formatChatContext } from './prompt.js';
import { buildWorldModuleInjection } from './world.js';

const sessionSecrets = { text: new Map(), image: new Map() };

function clone(value) {
    if (typeof globalThis.structuredClone === 'function') {
        return globalThis.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function hasOwn(target, key) {
    return Object.prototype.hasOwnProperty.call(target, key);
}

let volatileForumData = clone(EMPTY_FORUM_DATA);

function getContext() {
    if (!globalThis.SillyTavern?.getContext) throw new Error('没有检测到 SillyTavern 上下文');
    return globalThis.SillyTavern.getContext();
}

function mergeDefaults(target, defaults) {
    for (const [key, value] of Object.entries(defaults)) {
        if (!hasOwn(target, key) || target[key] === null) {
            target[key] = clone(value);
        } else if (value && typeof value === 'object' && !Array.isArray(value)
            && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
            mergeDefaults(target[key], value);
        }
    }
    return target;
}

function normalizeProfile(profile, index = 0) {
    const isSillyTavern = profile?.id === 'sillytavern-default' || profile?.text?.provider === 'sillytavern';
    const template = DEFAULT_SETTINGS.apiProfiles[isSillyTavern ? 0 : 1];
    profile.id ||= createId('api-profile');
    profile.name ||= `API 配置 ${index + 1}`;
    profile.reserved = Boolean(isSillyTavern);
    profile.text = mergeDefaults(profile.text && typeof profile.text === 'object' ? profile.text : {}, template.text);
    profile.text.provider = isSillyTavern ? 'sillytavern' : 'custom';
    profile.text.extraParameters = Array.isArray(profile.text.extraParameters)
        ? profile.text.extraParameters.filter(item => item && typeof item === 'object').map(item => ({
            id: String(item.id || createId('api-param')),
            key: String(item.key || '').trim(),
            value: String(item.value ?? ''),
            type: ['string', 'number', 'boolean', 'json'].includes(item.type) ? item.type : 'string',
            enabled: item.enabled !== false,
        }))
        : [];
    const image = profile.image && typeof profile.image === 'object' ? profile.image : {};
    const hadImageEnabledSwitch = hasOwn(image, 'enabled');
    profile.image = mergeDefaults(image, template.image);
    if (!hadImageEnabledSwitch && (profile.image.endpoint || profile.image.model)) profile.image.enabled = true;
    return profile;
}

function migrateSettings(settings) {
    if (!Array.isArray(settings.promptEntries)) settings.promptEntries = [];
    if (!settings.promptEntries.length) {
        settings.promptEntries.push({
            id: 'default-forum-style',
            title: '论坛基础规则',
            enabled: true,
            constant: true,
            keywords: [],
            order: 100,
            role: 'system',
            content: DEFAULT_FORUM_PROMPT,
        });
    }
    for (const entry of settings.promptEntries) {
        entry.id ||= createId('prompt');
        entry.title ||= '未命名设定';
        entry.keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
        entry.order = Number(entry.order || 0);
        entry.role = ['system', 'user', 'assistant'].includes(entry.role) ? entry.role : 'system';
        if (entry.id === 'default-forum-style' && !entry.content.includes('论坛的主角是整个世界')) {
            entry.content = `${entry.content}\n- 论坛的主角是整个世界，而不是 User。User 只是世界中的普通一员；无直接关联时不要围绕 User 讨论。\n- 优先展现角色自己的生活、公共事件、兴趣、关系与日常，让世界在 User 视线之外也持续运转。`;
        }
    }

    settings.builtinPrompts = settings.builtinPrompts && typeof settings.builtinPrompts === 'object'
        ? settings.builtinPrompts
        : {};
    for (const [id, content] of Object.entries(DEFAULT_BUILTIN_PROMPTS)) {
        if (typeof settings.builtinPrompts[id] !== 'string') settings.builtinPrompts[id] = content;
    }

    settings.modules = settings.modules && typeof settings.modules === 'object' ? settings.modules : {};
    for (const definition of WORLD_MODULE_DEFINITIONS) {
        const current = settings.modules[definition.id] && typeof settings.modules[definition.id] === 'object'
            ? settings.modules[definition.id]
            : {};
        const hadGenerationMode = hasOwn(current, 'generationMode');
        settings.modules[definition.id] = mergeDefaults(current, DEFAULT_SETTINGS.modules[definition.id]);
        settings.modules[definition.id].enabled = Boolean(settings.modules[definition.id].enabled);
        settings.modules[definition.id].injectIntoChat = Boolean(settings.modules[definition.id].injectIntoChat);
        settings.modules[definition.id].allowApiDraw = Boolean(settings.modules[definition.id].allowApiDraw);
        if (!hadGenerationMode || !['linked', 'independent', 'local'].includes(settings.modules[definition.id].generationMode)) {
            settings.modules[definition.id].generationMode = settings.modules[definition.id].joinGeneration ? 'linked' : (definition.id === 'fortune' ? 'local' : 'independent');
        }
        if (definition.id !== 'fortune' && settings.modules[definition.id].generationMode === 'local') {
            settings.modules[definition.id].generationMode = 'independent';
        }
        settings.modules[definition.id].joinGeneration = Boolean(settings.modules[definition.id].joinGeneration);
        settings.modules[definition.id].joinGeneration = settings.modules[definition.id].generationMode === 'linked';
        settings.modules[definition.id].automation = ['suggest', 'confirm', 'auto'].includes(settings.modules[definition.id].automation)
            ? settings.modules[definition.id].automation
            : 'confirm';
        settings.modules[definition.id].rpm = Math.min(600, Math.max(0, Number(settings.modules[definition.id].rpm || 0)));
        settings.modules[definition.id].probability = Math.min(100, Math.max(0, Number(settings.modules[definition.id].probability ?? 35)));
        settings.modules[definition.id].cooldownMinutes = Math.min(43200, Math.max(0, Number(settings.modules[definition.id].cooldownMinutes || 0)));
    }
    settings.orchestration.apiProfileId = String(settings.orchestration.apiProfileId || 'inherit');
    settings.orchestration.rpm = Math.min(600, Math.max(0, Number(settings.orchestration.rpm || 0)));
    settings.social.directMessagePolicy = ['open', 'following', 'chance'].includes(settings.social.directMessagePolicy)
        ? settings.social.directMessagePolicy
        : 'chance';
    settings.social.strangerBlockChance = Math.min(100, Math.max(0, Number(settings.social.strangerBlockChance ?? 60)));
    settings.social.proactiveDms.enabled = Boolean(settings.social.proactiveDms.enabled);
    settings.social.proactiveDms.withForumRefresh = settings.social.proactiveDms.withForumRefresh !== false;
    settings.social.proactiveDms.withAutomaticRefresh = settings.social.proactiveDms.withAutomaticRefresh !== false;
    settings.social.proactiveDms.requireFollow = settings.social.proactiveDms.requireFollow !== false;
    settings.social.proactiveDms.maxPerRun = Math.min(8, Math.max(0, Number(settings.social.proactiveDms.maxPerRun || 0)));
    settings.automation.quietHours.behavior = ['postpone', 'mute'].includes(settings.automation.quietHours.behavior)
        ? settings.automation.quietHours.behavior
        : 'postpone';
    settings.automation.narrativeIntensity = ['gentle', 'balanced', 'dramatic', 'custom'].includes(settings.automation.narrativeIntensity)
        ? settings.automation.narrativeIntensity
        : 'balanced';
    settings.automation.maxSevereEventsPerTenRuns = Math.min(10, Math.max(0, Number(settings.automation.maxSevereEventsPerTenRuns || 0)));
    settings.automation.severeCooldownHours = Math.min(720, Math.max(0, Number(settings.automation.severeCooldownHours || 0)));
    for (const key of Object.keys(DEFAULT_SETTINGS.automation.forbiddenEvents)) {
        settings.automation.forbiddenEvents[key] = Boolean(settings.automation.forbiddenEvents[key]);
    }
    settings.moderation.systemAdminEnabled = Boolean(settings.moderation.systemAdminEnabled);
    settings.moderation.systemAdminName = String(settings.moderation.systemAdminName || '巡界者').trim().slice(0, 32) || '巡界者';
    settings.moderation.npcReportsEnabled = settings.moderation.npcReportsEnabled !== false;
    settings.moderation.permissionLevels = Array.isArray(settings.moderation.permissionLevels)
        ? settings.moderation.permissionLevels.filter(item => item && typeof item === 'object').map((item, index) => ({
            id: String(item.id || `level-${index + 1}`),
            name: String(item.name || `权限 ${index + 1}`),
            level: Math.min(1000, Math.max(-1000, Number(item.level || 0))),
            deletePost: Boolean(item.deletePost),
            adjudicateReport: Boolean(item.adjudicateReport),
            pinPost: Boolean(item.pinPost),
            issueTask: Boolean(item.issueTask),
        }))
        : clone(DEFAULT_SETTINGS.moderation.permissionLevels);
    settings.appearance.viewThemes = settings.appearance.viewThemes && typeof settings.appearance.viewThemes === 'object'
        ? settings.appearance.viewThemes
        : {};
    for (const [id, defaults] of Object.entries(DEFAULT_SETTINGS.appearance.viewThemes)) {
        settings.appearance.viewThemes[id] = mergeDefaults(
            settings.appearance.viewThemes[id] && typeof settings.appearance.viewThemes[id] === 'object'
                ? settings.appearance.viewThemes[id]
                : {},
            defaults,
        );
    }

    if (!Array.isArray(settings.apiProfiles) || !settings.apiProfiles.length) {
        settings.apiProfiles = clone(DEFAULT_SETTINGS.apiProfiles);
    }
    settings.apiProfiles.forEach(normalizeProfile);
    if (!settings.forumOutputBudgetMigrated) {
        const sillyTavernProfile = settings.apiProfiles.find(profile => profile.text?.provider === 'sillytavern');
        if (sillyTavernProfile && Number(sillyTavernProfile.text.maxTokens || 0) <= 2200) {
            sillyTavernProfile.text.maxTokens = 8192;
        }
        settings.forumOutputBudgetMigrated = true;
    }
    if (!settings.apiProfiles.some(profile => profile.id === 'sillytavern-default')) {
        settings.apiProfiles.unshift(clone(DEFAULT_SETTINGS.apiProfiles[0]));
    }
    if (!settings.apiProfilesMigrated && (settings.textApi || settings.imageApi)) {
        let profile = settings.apiProfiles.find(item => item.id === 'default-api-profile' || item.text?.provider !== 'sillytavern');
        if (!profile) {
            profile = clone(DEFAULT_SETTINGS.apiProfiles[1]);
            settings.apiProfiles.push(profile);
        }
        if (settings.textApi) Object.assign(profile.text, settings.textApi);
        profile.text.provider = 'custom';
        if (settings.imageApi) {
            Object.assign(profile.image, settings.imageApi);
            if (settings.imageApi.endpoint || settings.imageApi.model) profile.image.enabled = true;
        }
        settings.apiProfilesMigrated = true;
    }
    if (!settings.sillyTavernProfileMigrated) {
        const active = settings.apiProfiles.find(profile => profile.id === settings.activeApiProfileId);
        if (!active || (active.text?.provider !== 'sillytavern' && !active.text?.endpoint && !active.text?.model)) {
            settings.activeApiProfileId = 'sillytavern-default';
        }
        settings.sillyTavernProfileMigrated = true;
    }
    if (!settings.apiProfiles.some(profile => profile.id === settings.activeApiProfileId)) {
        settings.activeApiProfileId = settings.apiProfiles[0].id;
    }
    for (const module of Object.values(settings.modules)) {
        if (module.apiProfileId !== 'inherit' && !settings.apiProfiles.some(profile => profile.id === module.apiProfileId)) module.apiProfileId = 'inherit';
    }
    if (settings.orchestration.apiProfileId !== 'inherit' && !settings.apiProfiles.some(profile => profile.id === settings.orchestration.apiProfileId)) {
        settings.orchestration.apiProfileId = 'inherit';
    }
    settings.sources.worldInfoEntries = settings.sources.worldInfoEntries && typeof settings.sources.worldInfoEntries === 'object'
        ? settings.sources.worldInfoEntries
        : {};
    settings.sources.worldInfoBooks = settings.sources.worldInfoBooks && typeof settings.sources.worldInfoBooks === 'object'
        ? settings.sources.worldInfoBooks
        : {};
    settings.sources.presetEntries = settings.sources.presetEntries && typeof settings.sources.presetEntries === 'object'
        ? settings.sources.presetEntries
        : {};
    settings.informationBoundary.worldInfoEntries = settings.informationBoundary.worldInfoEntries
        && typeof settings.informationBoundary.worldInfoEntries === 'object'
        ? settings.informationBoundary.worldInfoEntries
        : {};
    if (!settings.sourcesMigrated) {
        settings.sources.chat = settings.generation.readChat !== false;
        settings.sourcesMigrated = true;
    }
    settings.avatarLibrary = Array.isArray(settings.avatarLibrary) ? settings.avatarLibrary : [];
    settings.avatarLibrary = settings.avatarLibrary.filter(item => item && (typeof item.url === 'string' || typeof item.imageKey === 'string')).map(item => ({
        id: item.id || createId('avatar'),
        name: String(item.name || '未命名头像'),
        url: String(item.url || '').trim(),
        imageKey: String(item.imageKey || '').trim(),
    }));
    if (!['home', 'services', 'messages', 'me', 'settings'].includes(settings.ui.activeTab)) settings.ui.activeTab = 'home';
}

export function getSettings() {
    const context = getContext();
    if (!context.extensionSettings[MODULE_ID]) context.extensionSettings[MODULE_ID] = clone(DEFAULT_SETTINGS);
    const settings = mergeDefaults(context.extensionSettings[MODULE_ID], DEFAULT_SETTINGS);
    migrateSettings(settings);
    if (settings.privacy.rememberApiKeys) {
        for (const profile of settings.apiProfiles) {
            if (profile.text.apiKey) sessionSecrets.text.set(profile.id, profile.text.apiKey);
            if (profile.image.apiKey) sessionSecrets.image.set(profile.id, profile.image.apiKey);
        }
    } else {
        let removedStoredKey = false;
        for (const profile of settings.apiProfiles) {
            if (profile.text.apiKey) {
                sessionSecrets.text.set(profile.id, profile.text.apiKey);
                profile.text.apiKey = '';
                removedStoredKey = true;
            }
            if (profile.image.apiKey) {
                sessionSecrets.image.set(profile.id, profile.image.apiKey);
                profile.image.apiKey = '';
                removedStoredKey = true;
            }
        }
        if (removedStoredKey) context.saveSettingsDebounced();
    }
    return settings;
}

export function saveSettings() {
    getContext().saveSettingsDebounced();
}

export function getActiveApiProfile() {
    const settings = getSettings();
    return settings.apiProfiles.find(profile => profile.id === settings.activeApiProfileId) || settings.apiProfiles[0];
}

export function setActiveApiProfile(profileId) {
    const settings = getSettings();
    if (!settings.apiProfiles.some(profile => profile.id === profileId)) return false;
    settings.activeApiProfileId = profileId;
    saveSettings();
    return true;
}

export function createApiProfile(name, copyCurrent = true) {
    const settings = getSettings();
    const current = getActiveApiProfile();
    const source = copyCurrent && current.text?.provider !== 'sillytavern' ? current : DEFAULT_SETTINGS.apiProfiles[1];
    const profile = normalizeProfile({
        id: createId('api-profile'),
        name: String(name || `API 配置 ${settings.apiProfiles.length + 1}`).trim(),
        text: clone(source.text),
        image: clone(source.image),
    });
    if (!settings.privacy.rememberApiKeys) {
        profile.text.apiKey = '';
        profile.image.apiKey = '';
    }
    settings.apiProfiles.push(profile);
    settings.activeApiProfileId = profile.id;
    if (copyCurrent) {
        const sourceId = source.id;
        if (sessionSecrets.text.has(sourceId)) sessionSecrets.text.set(profile.id, sessionSecrets.text.get(sourceId));
        if (sessionSecrets.image.has(sourceId)) sessionSecrets.image.set(profile.id, sessionSecrets.image.get(sourceId));
    }
    saveSettings();
    return profile;
}

export function renameApiProfile(profileId, name) {
    const profile = getSettings().apiProfiles.find(item => item.id === profileId);
    if (!profile || profile.reserved || !String(name || '').trim()) return false;
    profile.name = String(name).trim();
    saveSettings();
    return true;
}

export function deleteApiProfile(profileId) {
    const settings = getSettings();
    const index = settings.apiProfiles.findIndex(profile => profile.id === profileId);
    if (index < 0) return false;
    if (settings.apiProfiles[index].reserved) throw new Error('“酒馆当前连接”是内置配置，不能删除');
    settings.apiProfiles.splice(index, 1);
    sessionSecrets.text.delete(profileId);
    sessionSecrets.image.delete(profileId);
    if (settings.activeApiProfileId === profileId) settings.activeApiProfileId = 'sillytavern-default';
    saveSettings();
    return true;
}

export function getApiConfig(kind) {
    return getApiConfigForProfile(getActiveApiProfile().id, kind);
}

export function getApiConfigForProfile(profileId, kind = 'text') {
    const settings = getSettings();
    const profile = settings.apiProfiles.find(item => item.id === profileId) || getActiveApiProfile();
    const normalizedKind = kind === 'image' ? 'image' : 'text';
    const section = profile[normalizedKind];
    return {
        ...section,
        profileId: profile.id,
        profileName: profile.name,
        apiKey: sessionSecrets[normalizedKind].get(profile.id) || section.apiKey || '',
    };
}

export function getModuleApiConfig(moduleId, kind = 'text', { orchestrated = false } = {}) {
    const settings = getSettings();
    const selectedId = orchestrated
        ? settings.orchestration.apiProfileId
        : settings.modules?.[moduleId]?.apiProfileId;
    const profileId = selectedId && selectedId !== 'inherit' ? selectedId : settings.activeApiProfileId;
    const config = getApiConfigForProfile(profileId, kind);
    if (kind !== 'image') config.rpm = Number(orchestrated ? settings.orchestration.rpm : settings.modules?.[moduleId]?.rpm || 0);
    config.moduleId = moduleId;
    return config;
}

export function updateApiConfig(kind, field, value) {
    const settings = getSettings();
    const profile = getActiveApiProfile();
    const normalizedKind = kind === 'image' ? 'image' : 'text';
    if (!hasOwn(profile[normalizedKind], field) || field === 'apiKey') return false;
    profile[normalizedKind][field] = value;
    saveSettings();
    return true;
}

export function setSessionApiKey(kind, value) {
    const settings = getSettings();
    const profile = getActiveApiProfile();
    const normalizedKind = kind === 'image' ? 'image' : 'text';
    sessionSecrets[normalizedKind].set(profile.id, String(value || ''));
    if (settings.privacy.rememberApiKeys) {
        profile[normalizedKind].apiKey = String(value || '');
        saveSettings();
    }
}

export function setRememberApiKeys(remember) {
    const settings = getSettings();
    settings.privacy.rememberApiKeys = Boolean(remember);
    for (const profile of settings.apiProfiles) {
        if (remember) {
            profile.text.apiKey = sessionSecrets.text.get(profile.id) || profile.text.apiKey || '';
            profile.image.apiKey = sessionSecrets.image.get(profile.id) || profile.image.apiKey || '';
        } else {
            if (profile.text.apiKey) sessionSecrets.text.set(profile.id, profile.text.apiKey);
            if (profile.image.apiKey) sessionSecrets.image.set(profile.id, profile.image.apiKey);
            profile.text.apiKey = '';
            profile.image.apiKey = '';
        }
    }
    saveSettings();
}

export function hasActiveChat() {
    const context = getContext();
    return Boolean(context.chatId || context.groupId || context.characterId !== undefined);
}

export function getForumData() {
    if (!hasActiveChat()) return normalizeForumDataShape(volatileForumData);
    const context = getContext();
    if (!context.chatMetadata[CHAT_DATA_KEY]) context.chatMetadata[CHAT_DATA_KEY] = clone(EMPTY_FORUM_DATA);
    return normalizeForumDataShape(context.chatMetadata[CHAT_DATA_KEY]);
}

export async function saveForumData(data, immediate = false) {
    const normalized = normalizeForumDataShape(data);
    normalized.updatedAt = Date.now();
    if (!hasActiveChat()) {
        volatileForumData = normalized;
        return;
    }
    const context = getContext();
    context.chatMetadata[CHAT_DATA_KEY] = normalized;
    if (immediate) await context.saveMetadata();
    else if (typeof context.saveMetadataDebounced === 'function') context.saveMetadataDebounced();
    else await context.saveMetadata();
}

export function makeWorldInfoEntryKey(book, uid) {
    return JSON.stringify([String(book), String(uid)]);
}

async function getWorldInfoSettingsSnapshot(context) {
    if (typeof context.getWorldInfoSettings === 'function') {
        try {
            return await context.getWorldInfoSettings();
        } catch {
            // Fall through to SillyTavern's official World Info module.
        }
    }
    if (context.worldInfoSettings && typeof context.worldInfoSettings === 'object') {
        return context.worldInfoSettings;
    }
    try {
        const module = await import('../../../../world-info.js');
        return typeof module.getWorldInfoSettings === 'function' ? module.getWorldInfoSettings() : null;
    } catch {
        return null;
    }
}

async function getCharacterBoundWorldInfoNames(context) {
    const character = context.characters?.[context.characterId];
    const primaryCandidates = [
        character?.data?.extensions?.world,
        character?.extensions?.world,
        character?.world,
        character?.data?.character_book?.name,
        character?.character_book?.name,
    ];
    const bindings = new Map();
    const addBinding = (value, type) => {
        const name = String(value || '').trim();
        if (!name) return;
        const previous = bindings.get(name);
        bindings.set(name, previous && previous !== type ? 'primary-and-auxiliary' : type);
    };
    const primary = primaryCandidates.map(value => String(value || '').trim()).find(Boolean);
    addBinding(primary, 'primary');

    const snapshot = await getWorldInfoSettingsSnapshot(context);
    const worldInfoSettings = snapshot?.world_info || snapshot?.worldInfo || snapshot;
    const avatarFile = String(character?.avatar || '').split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || '';
    const characterLore = Array.isArray(worldInfoSettings?.charLore)
        ? worldInfoSettings.charLore.find(item => String(item?.name || '') === avatarFile)
        : null;
    for (const book of Array.isArray(characterLore?.extraBooks) ? characterLore.extraBooks : []) {
        addBinding(book, 'auxiliary');
    }

    return bindings;
}

function hasSelectedWorldInfoEntry(settings, book) {
    return Object.entries(settings.sources.worldInfoEntries).some(([key, selected]) => {
        if (!selected) return false;
        try {
            const parsed = JSON.parse(key);
            return Array.isArray(parsed) && String(parsed[0]) === String(book);
        } catch {
            return false;
        }
    });
}

export function isWorldInfoBookEnabled(settings, book, characterBound = false) {
    if (hasOwn(settings.sources.worldInfoBooks, book)) return settings.sources.worldInfoBooks[book] !== false;
    if (characterBound) return true;
    return hasSelectedWorldInfoEntry(settings, book);
}

export async function getWorldInfoCatalog() {
    const context = getContext();
    let names = typeof context.getWorldInfoNames === 'function' ? context.getWorldInfoNames() : [];
    if ((!Array.isArray(names) || !names.length) && typeof context.updateWorldInfoList === 'function') {
        await context.updateWorldInfoList();
        names = context.getWorldInfoNames?.() || [];
    }
    const settings = getSettings();
    const characterBoundBooks = await getCharacterBoundWorldInfoNames(context);
    const uniqueNames = [...new Set((names || []).map(name => String(name || '').trim()).filter(Boolean))];
    const books = await Promise.all(uniqueNames.map(async book => {
        try {
            const data = await context.loadWorldInfo(book);
            const characterBinding = characterBoundBooks.get(String(book)) || '';
            const characterBound = Boolean(characterBinding);
            const enabled = isWorldInfoBookEnabled(settings, book, characterBound);
            const entries = Object.entries(data?.entries || {}).map(([recordKey, entry]) => {
                const key = makeWorldInfoEntryKey(book, entry.uid ?? recordKey);
                const explicitlySelected = hasOwn(settings.sources.worldInfoEntries, key);
                return {
                book,
                uid: entry.uid ?? recordKey,
                key,
                title: String(entry.comment || (Array.isArray(entry.key) ? entry.key.join(', ') : '') || `UID ${entry.uid ?? recordKey}`),
                content: String(entry.content || ''),
                keywords: Array.isArray(entry.key) ? entry.key.map(String) : [],
                disabledInSillyTavern: Boolean(entry.disable),
                selected: explicitlySelected ? Boolean(settings.sources.worldInfoEntries[key]) : !entry.disable,
                boundary: settings.informationBoundary.worldInfoEntries[key] || {
                    visibility: 'public',
                    knownBy: [],
                },
                };
            }).sort((a, b) => Number(a.uid) - Number(b.uid));
            return { name: book, entries, enabled, characterBound, characterBinding };
        } catch (error) {
            console.warn(`[微坛] 读取世界书“${book}”失败`, error);
            return { name: book, entries: [], enabled: false, characterBound: false, characterBinding: '', error: error.message };
        }
    }));
    return books;
}

export function getSillyTavernPresetCatalog() {
    const context = getContext();
    const settings = getSettings();
    const prompts = Array.isArray(context.chatCompletionSettings?.prompts)
        ? context.chatCompletionSettings.prompts
        : [];
    const orders = Array.isArray(context.chatCompletionSettings?.prompt_order)
        ? context.chatCompletionSettings.prompt_order
        : [];
    const currentCharacterId = String(context.characterId ?? '');
    const orderRecord = orders.find(item => String(item?.character_id ?? '') === currentCharacterId)
        || orders.find(item => Number(item?.character_id) === 100001)
        || orders.find(item => Array.isArray(item?.order));
    const orderedItems = Array.isArray(orderRecord?.order) ? orderRecord.order : [];
    const orderByIdentifier = new Map(orderedItems.map((item, index) => [String(item?.identifier || ''), { index, enabled: item?.enabled !== false }]));
    const normalizeRole = role => ['system', 'user', 'assistant'].includes(role) ? role : 'system';
    return prompts
        .filter(prompt => prompt && !prompt.marker && String(prompt.content || '').trim())
        .map((prompt, fallbackIndex) => {
            const identifier = String(prompt.identifier || `preset-${fallbackIndex}`);
            const order = orderByIdentifier.get(identifier);
            return {
                id: identifier,
                title: String(prompt.name || identifier || '未命名预设条目'),
                role: normalizeRole(prompt.role),
                content: String(prompt.content || '').trim(),
                disabledInSillyTavern: order ? !order.enabled : prompt.enabled === false,
                selected: Boolean(settings.sources.presetEntries[identifier]),
                order: order?.index ?? (orderedItems.length + fallbackIndex),
            };
        })
        .sort((left, right) => left.order - right.order);
}

export async function getGenerationSourceContext({ includeRestricted = false } = {}) {
    const context = getContext();
    const settings = getSettings();
    const sources = settings.sources;
    const fields = typeof context.getCharacterCardFields === 'function' ? context.getCharacterCardFields() : {};
    const chat = sources.chat
        ? formatChatContext(context.chat, settings.generation.contextMessages, { user: context.name1, character: context.name2 })
        : '';
    const userPersona = sources.userPersona ? String(fields.persona || context.powerUserSettings?.persona_description || '').trim() : '';
    const characterPersona = sources.characterPersona
        ? [
            fields.system && `系统设定：${fields.system}`,
            fields.description && `角色描述：${fields.description}`,
            fields.personality && `性格：${fields.personality}`,
            fields.scenario && `场景：${fields.scenario}`,
            fields.charDepthPrompt && `深度设定：${fields.charDepthPrompt}`,
            fields.mesExamples && `对话示例：${fields.mesExamples}`,
        ].filter(Boolean).join('\n\n')
        : '';
    let worldInfo = [];
    if (sources.worldInfo) {
        const catalog = await getWorldInfoCatalog();
        worldInfo = catalog.filter(book => book.enabled).flatMap(book => book.entries)
            .filter(entry => entry.selected && entry.content)
            .map(({ book, uid, title, content, key, boundary }) => ({ book, uid, title, content, key, boundary }));
    }
    let presetPrompts = [];
    if (sources.sillyTavernPreset) {
        presetPrompts = getSillyTavernPresetCatalog()
            .filter(entry => sources.presetEntries[entry.id])
            .map(entry => ({
                id: entry.id,
                title: entry.title,
                role: entry.role,
                content: typeof context.substituteParams === 'function'
                    ? String(context.substituteParams(entry.content) || '').trim()
                    : entry.content,
            }))
            .filter(entry => entry.content);
    }
    const data = getForumData();
    const boundaryEnabled = settings.informationBoundary.enabled !== false;
    if (boundaryEnabled) {
        worldInfo = worldInfo.filter(entry => includeRestricted
            ? entry.boundary?.visibility !== 'forbidden'
            : (entry.boundary?.visibility || 'public') === 'public');
    }
    const facts = boundaryEnabled
        ? data.facts.filter(fact => fact.visibility === 'public' && fact.publishable)
        : data.facts.filter(fact => fact.publishable);
    const roleMemories = data.npcs.filter(npc => !npc.blocked);
    return { chat, userPersona, characterPersona, worldInfo, presetPrompts, facts, roleMemories };
}

export async function getRoleScopedSourceContext(roleId, { channel = 'private', otherRoleId = '' } = {}) {
    const base = await getGenerationSourceContext({ includeRestricted: true });
    const settings = getSettings();
    const data = getForumData();
    if (settings.informationBoundary.enabled === false) return base;
    const allowedIds = new Set([String(roleId || '')].filter(Boolean));
    const mayRead = item => {
        const visibility = item?.visibility || item?.boundary?.visibility || 'public';
        const knownBy = item?.knownBy || item?.boundary?.knownBy || [];
        if (visibility === 'forbidden') return false;
        if (visibility === 'public') return true;
        if (visibility === 'private' && channel !== 'private') return false;
        return knownBy.some(id => allowedIds.has(String(id)));
    };
    return {
        ...base,
        worldInfo: base.worldInfo.filter(mayRead),
        facts: data.facts.filter(fact => mayRead(fact) && (channel === 'private' || fact.publishable)),
        roleMemories: data.npcs.filter(npc => allowedIds.has(String(npc.id))),
    };
}

export function syncInjection() {
    const context = getContext();
    const settings = getSettings();
    const data = getForumData();
    const blockedIds = new Set(data.npcs.filter(npc => npc.blocked).map(npc => npc.id));
    const publicPosts = data.posts.filter(post => !blockedIds.has(post.npcId) && !post.moderation?.hidden).map(post => ({
        ...post,
        comments: (post.comments || []).filter(comment => !blockedIds.has(comment.npcId)),
    }));
    const forumValue = settings.injection.enabled ? buildForumInjection(publicPosts, { ...settings.injection, template: settings.builtinPrompts.mainChatInjection }) : '';
    const npcValue = settings.injection.npcEnabled ? buildNpcInjection(data.npcs.filter(npc => !npc.blocked), { template: settings.builtinPrompts.roleInjection }) : '';
    const worldValue = buildWorldModuleInjection(data, settings);
    context.setExtensionPrompt(INJECTION_ID, forumValue, EXTENSION_PROMPT_POSITION_IN_CHAT, Number(settings.injection.depth || 1), false, EXTENSION_PROMPT_ROLE_SYSTEM);
    context.setExtensionPrompt(NPC_INJECTION_ID, npcValue, EXTENSION_PROMPT_POSITION_IN_CHAT, Number(settings.injection.depth || 1), false, EXTENSION_PROMPT_ROLE_SYSTEM);
    context.setExtensionPrompt(WORLD_MODULE_INJECTION_ID, worldValue, EXTENSION_PROMPT_POSITION_IN_CHAT, Number(settings.injection.depth || 1), false, EXTENSION_PROMPT_ROLE_SYSTEM);
    return { forumValue, npcValue, worldValue };
}

export function clearInjection() {
    const context = getContext();
    context.setExtensionPrompt(INJECTION_ID, '', EXTENSION_PROMPT_POSITION_IN_CHAT, 1, false, EXTENSION_PROMPT_ROLE_SYSTEM);
    context.setExtensionPrompt(NPC_INJECTION_ID, '', EXTENSION_PROMPT_POSITION_IN_CHAT, 1, false, EXTENSION_PROMPT_ROLE_SYSTEM);
    context.setExtensionPrompt(WORLD_MODULE_INJECTION_ID, '', EXTENSION_PROMPT_POSITION_IN_CHAT, 1, false, EXTENSION_PROMPT_ROLE_SYSTEM);
}

export async function clearAllData() {
    const context = getContext();
    const data = getForumData();
    const settings = getSettings();
    for (const post of data.posts) {
        if (post.imageKey) await globalThis.SillyTavern?.libs?.localforage?.removeItem(post.imageKey);
    }
    const assetKeys = [
        settings.ui.floatingButtonImageKey,
        settings.appearance.brandIconKey,
        settings.appearance.wallpaperKey,
        ...Object.values(settings.appearance.viewThemes || {}).map(theme => theme.wallpaperKey),
        settings.profile.avatarKey,
        settings.profile.backgroundKey,
        ...settings.avatarLibrary.map(item => item.imageKey),
        ...data.npcs.flatMap(npc => [npc.avatarKey, npc.backgroundKey]),
    ].filter(Boolean);
    for (const key of new Set(assetKeys)) await globalThis.SillyTavern?.libs?.localforage?.removeItem(key);
    delete context.extensionSettings[MODULE_ID];
    sessionSecrets.text.clear();
    sessionSecrets.image.clear();
    if (hasActiveChat()) {
        delete context.chatMetadata[CHAT_DATA_KEY];
        await context.saveMetadata();
    }
    context.saveSettingsDebounced();
    clearInjection();
}

export function getChatSnapshot() {
    const context = getContext();
    const character = context.characters?.[context.characterId];
    const card = typeof context.getCharacterCardFields === 'function' ? context.getCharacterCardFields() : {};
    const characterAvatarUrl = character?.avatar && typeof context.getThumbnailUrl === 'function'
        ? context.getThumbnailUrl('avatar', character.avatar)
        : '';
    return {
        chat: Array.isArray(context.chat) ? context.chat : [],
        names: { user: context.name1, character: context.name2 },
        chatId: context.chatId || '',
        characterId: String(context.characterId ?? context.name2 ?? ''),
        characterName: context.name2 || '当前故事',
        characterHandle: String(context.name2 || 'char').replace(/\s+/g, '_').toLocaleLowerCase(),
        characterAvatarUrl,
        characterPersona: [card?.description, card?.personality, card?.scenario].filter(Boolean).join('\n'),
    };
}

export function getCharacterCatalog() {
    const context = getContext();
    return (context.characters || []).map((character, index) => {
        const avatarUrl = character?.avatar && typeof context.getThumbnailUrl === 'function'
            ? context.getThumbnailUrl('avatar', character.avatar)
            : '';
        const persona = [character?.description, character?.personality, character?.scenario].filter(Boolean).join('\n');
        return {
            id: String(index),
            name: String(character?.name || `Char ${index + 1}`),
            avatarUrl,
            persona,
        };
    });
}
