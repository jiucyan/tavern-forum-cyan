import test from 'node:test';
import assert from 'node:assert/strict';

function createContext() {
    return {
        extensionSettings: {},
        chatMetadata: {},
        chatId: 'chat-1',
        groupId: null,
        characterId: '0',
        characters: [{ data: { extensions: { world: '城市' } } }],
        chat: [
            { is_user: true, name: '玩家', mes: '进入车站。' },
            { is_user: false, name: '角色', mes: '看见了站台。' },
        ],
        name1: '玩家',
        name2: '角色',
        powerUserSettings: { persona_description: '玩家是一名侦探。' },
        chatCompletionSettings: {
            prompts: [
                { identifier: 'main', name: '主提示', role: 'system', content: '故事发生在 {{char}} 所在的城市。' },
                { identifier: 'example', name: '助手示例', role: 'assistant', content: '保持自然。' },
            ],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'example', enabled: false }] }],
        },
        substituteParams(value) { return value.replace('{{char}}', '角色'); },
        saveSettingsDebounced() {},
        saveMetadataDebounced() {},
        async saveMetadata() {},
        setExtensionPrompt() {},
        getCharacterCardFields() {
            return { persona: '玩家是一名侦探。', description: '角色是记者。', personality: '谨慎。', scenario: '雨夜车站。' };
        },
        getWorldInfoNames() { return ['城市', '远方']; },
        async loadWorldInfo(book) {
            return book === '城市'
                ? { entries: { 7: { uid: 7, comment: '中央车站', content: '中央车站午夜关闭。', key: ['车站'], disable: false } } }
                : { entries: { 9: { uid: 9, comment: '远方传闻', content: '北方仍在下雪。', key: ['北方'], disable: false } } };
        },
    };
}

test('API profiles switch freely and source switches include selected lore entries', async () => {
    const context = createContext();
    globalThis.SillyTavern = { getContext: () => context, libs: {} };
    const store = await import(`../src/store.js?store-test=${Date.now()}`);

    assert.equal(store.getApiConfig('text').provider, 'sillytavern');
    assert.equal(store.getApiConfig('text').maxTokens, 8192);
    assert.equal(store.getSettings().generation.autoRefreshOnMessage, false);
    assert.equal(store.getSettings().notifications.reply, true);
    assert.equal(store.getSettings().profile.handle, 'me');
    store.setActiveApiProfile('default-api-profile');
    store.updateApiConfig('text', 'endpoint', 'https://one.example/v1');
    assert.equal(store.getApiConfig('image').enabled, false);
    assert.equal(store.getApiConfig('image').textFallback, true);
    store.updateApiConfig('image', 'enabled', true);
    store.updateApiConfig('image', 'textFallback', false);
    const second = store.createApiProfile('备用配置', true);
    store.updateApiConfig('text', 'endpoint', 'https://two.example/v1');
    assert.equal(store.getApiConfig('text').endpoint, 'https://two.example/v1');
    store.setActiveApiProfile('default-api-profile');
    assert.equal(store.getApiConfig('text').endpoint, 'https://one.example/v1');
    assert.equal(store.getApiConfig('image').enabled, true);
    assert.equal(store.getApiConfig('image').textFallback, false);
    assert.equal(second.name, '备用配置');

    const settings = store.getSettings();
    const initialCatalog = await store.getWorldInfoCatalog();
    assert.equal(initialCatalog.find(book => book.name === '城市').characterBound, true);
    assert.equal(initialCatalog.find(book => book.name === '城市').enabled, true);
    assert.equal(initialCatalog.find(book => book.name === '远方').enabled, false);
    assert.equal(initialCatalog.find(book => book.name === '远方').entries[0].selected, true);
    settings.sources.chat = false;
    settings.sources.userPersona = true;
    settings.sources.characterPersona = false;
    settings.sources.worldInfo = true;
    settings.sources.worldInfoEntries[store.makeWorldInfoEntryKey('城市', 7)] = true;
    const sources = await store.getGenerationSourceContext();
    assert.equal(sources.chat, '');
    assert.match(sources.userPersona, /侦探/);
    assert.equal(sources.characterPersona, '');
    assert.equal(sources.worldInfo[0].content, '中央车站午夜关闭。');

    settings.sources.worldInfoBooks['城市'] = false;
    assert.equal((await store.getGenerationSourceContext()).worldInfo.length, 0);
    assert.equal(settings.sources.worldInfoEntries[store.makeWorldInfoEntryKey('城市', 7)], true);
    settings.sources.worldInfoBooks['城市'] = true;
    assert.equal((await store.getGenerationSourceContext()).worldInfo.length, 1);
    settings.sources.worldInfoBooks['远方'] = true;
    assert.equal((await store.getGenerationSourceContext()).worldInfo.length, 2);
    settings.sources.worldInfoBooks['远方'] = false;

    const presetCatalog = store.getSillyTavernPresetCatalog();
    assert.deepEqual(presetCatalog.map(entry => entry.role), ['system', 'assistant']);
    assert.equal(presetCatalog[1].disabledInSillyTavern, true);
    settings.sources.sillyTavernPreset = true;
    settings.sources.presetEntries.main = true;
    const sourcesWithPreset = await store.getGenerationSourceContext();
    assert.equal(sourcesWithPreset.presetPrompts.length, 1);
    assert.match(sourcesWithPreset.presetPrompts[0].content, /角色\s+所在的城市/);
    assert.equal(context.chatCompletionSettings.prompts[0].content, '故事发生在 {{char}} 所在的城市。');

    const role = store.getForumData().npcs[0] || { id: 'role-a' };
    const key = store.makeWorldInfoEntryKey('城市', 7);
    settings.informationBoundary.worldInfoEntries[key] = { visibility: 'private', knownBy: [role.id] };
    assert.equal((await store.getGenerationSourceContext()).worldInfo.length, 0);
    assert.equal((await store.getRoleScopedSourceContext(role.id)).worldInfo.length, 1);
});

test('character lore recognizes both primary and auxiliary SillyTavern lorebooks', async () => {
    const context = createContext();
    context.characters[0].avatar = 'role-card.png';
    context.getWorldInfoNames = () => ['城市', '同行者', '远方'];
    context.getWorldInfoSettings = () => ({
        world_info: {
            charLore: [{ name: 'role-card', extraBooks: ['同行者'] }],
        },
    });
    context.loadWorldInfo = async book => ({
        entries: {
            1: { uid: 1, comment: `${book}条目`, content: `${book}内容`, key: [book], disable: false },
        },
    });
    globalThis.SillyTavern = { getContext: () => context, libs: {} };
    const store = await import(`../src/store.js?character-lore-test=${Date.now()}`);

    const catalog = await store.getWorldInfoCatalog();
    const primary = catalog.find(book => book.name === '城市');
    const auxiliary = catalog.find(book => book.name === '同行者');
    const unrelated = catalog.find(book => book.name === '远方');

    assert.equal(primary.characterBinding, 'primary');
    assert.equal(primary.enabled, true);
    assert.equal(auxiliary.characterBinding, 'auxiliary');
    assert.equal(auxiliary.enabled, true);
    assert.equal(unrelated.characterBound, false);
    assert.equal(unrelated.enabled, false);
});
