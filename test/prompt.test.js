import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTextRequestBody, generateForumText, generateForumTextResult, resolveEndpoint } from '../src/api.js';
import {
    FORUM_GENERATION_JSON_SCHEMA,
    buildDirectMessageRequest,
    buildRoleDirectMessageRequest,
    buildForumGenerationRequest,
    buildForumInjection,
    buildNpcInjection,
    extractAssistantReasoning,
    extractAssistantText,
    formatChatContext,
    getActivePromptEntries,
    normalizeGeneratedForum,
    normalizeDirectMessage,
    normalizeNpcProfile,
    normalizeThreadReplies,
    parseJsonResponse,
    prunePosts,
    recoverGeneratedForum,
} from '../src/prompt.js';
import { advanceSocialEngagement, collectNpcEvidence, connectGeneratedReposts, createDefaultAvatarDataUrl, createFact, createNotification, createNpc, ensureCharacterConversation, ensureCharacterRole, ensureNpcConversation, ensureRoleConversation, linkNpcAuthors, normalizeForumDataShape } from '../src/forum.js';

test('resolveEndpoint accepts base URLs and complete endpoints', () => {
    assert.equal(resolveEndpoint('https://api.example.com/v1/', 'text'), 'https://api.example.com/v1/chat/completions');
    assert.equal(resolveEndpoint('https://api.example.com/v1/chat/completions', 'text'), 'https://api.example.com/v1/chat/completions');
    assert.equal(resolveEndpoint('https://api.example.com/v1', 'image'), 'https://api.example.com/v1/images/generations');
});

test('SillyTavern default text provider uses the current connection', async () => {
    let received;
    globalThis.SillyTavern = { getContext: () => ({
        async generateRaw(options) { received = options; return '  {"posts":[]}  '; },
    }) };
    const output = await generateForumText({ provider: 'sillytavern', maxTokens: 1234 }, {
        system: '系统',
        user: '正文',
        jsonSchema: FORUM_GENERATION_JSON_SCHEMA,
    });
    assert.equal(output, '{"posts":[]}');
    assert.equal(received.responseLength, 1234);
    assert.deepEqual(received.prompt.map(item => item.role), ['system', 'user']);
    assert.equal(received.jsonSchema.name, 'tavern_forum_posts');
});

test('forum trace capture uses exactly one SillyTavern API request', async () => {
    let rawCalls = 0;
    let dataCalls = 0;
    globalThis.SillyTavern = { getContext: () => ({
        async generateRaw() { rawCalls += 1; return 'unexpected'; },
        async generateRawData() {
            dataCalls += 1;
            return { choices: [{ message: { content: '<forum_data>{"posts":[]}</forum_data>', reasoning_content: '内部分析' } }] };
        },
    }) };
    const result = await generateForumTextResult({ provider: 'sillytavern', maxTokens: 1234 }, {
        system: '系统',
        user: '正文',
    }, { captureTrace: true });
    assert.equal(dataCalls, 1);
    assert.equal(rawCalls, 0);
    assert.match(result.text, /forum_data/);
    assert.equal(result.reasoning, '内部分析');
});

test('custom text provider sends an OpenAI-compatible JSON schema', async () => {
    let received;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
        received = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"posts":[]}' } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    try {
        const output = await generateForumText({
            provider: 'custom',
            endpoint: 'https://api.example.com/v1',
            model: 'example-model',
        }, {
            system: '系统',
            user: '正文',
            jsonSchema: FORUM_GENERATION_JSON_SCHEMA,
        });
        assert.equal(output, '{"posts":[]}');
        assert.equal(received.response_format.type, 'json_schema');
        assert.equal(received.response_format.json_schema.name, 'tavern_forum_posts');
        assert.deepEqual(received.response_format.json_schema.schema.required, ['posts']);
        assert.deepEqual(received.response_format.json_schema.schema.properties.posts.items.required, ['author', 'handle', 'content']);
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test('formatChatContext keeps only the requested recent messages', () => {
    const output = formatChatContext([
        { is_user: true, name: '小明', mes: '第一句' },
        { is_user: false, name: '阿月', mes: '第二句' },
        { is_user: true, name: '小明', mes: '第三句' },
    ], 2);
    assert.equal(output, '阿月：第二句\n小明：第三句');
});

test('prompt entries support constant and keyword activation with priority', () => {
    const entries = [
        { title: 'low', enabled: true, constant: true, order: 1, content: 'a' },
        { title: 'match', enabled: true, constant: false, keywords: ['月亮'], order: 9, content: 'b' },
        { title: 'miss', enabled: true, constant: false, keywords: ['太阳'], order: 20, content: 'c' },
        { title: 'off', enabled: false, constant: true, order: 99, content: 'd' },
    ];
    assert.deepEqual(getActivePromptEntries(entries, '今晚的月亮很好').map(entry => entry.title), ['match', 'low']);
});

test('JSON parsing tolerates fenced and surrounding model text', () => {
    assert.deepEqual(parseJsonResponse('```json\n{"posts":[]}\n```'), { posts: [] });
    assert.deepEqual(parseJsonResponse('好的： {"topic":"热议","posts":[]} 完成'), { topic: '热议', posts: [] });
    assert.deepEqual(parseJsonResponse('分析可以保留\n<forum_data>{"posts":[]}</forum_data>\n补充说明'), { posts: [] });
});

test('JSON parsing repairs missing commas and trailing commas from models', () => {
    assert.deepEqual(parseJsonResponse('{"posts":[{"content":"第一条"}\n{"content":"第二条"},]}'), {
        posts: [{ content: '第一条' }, { content: '第二条' }],
    });
});

test('normalization creates injectable posts and comments', () => {
    const data = normalizeGeneratedForum(JSON.stringify({
        topic: '城门口',
        posts: [{ author: '路人甲', handle: '@passerby', content: '刚才发生了什么？', tags: ['现场'], comments: [{ author: '路人乙', content: '我也看见了。', imagePrompt: '雨夜站台照片' }] }],
    }), 1000);
    assert.equal(data.topic, '城门口');
    assert.equal(data.posts[0].handle, 'passerby');
    assert.equal(data.posts[0].selectedForInjection, true);
    assert.equal(data.posts[0].comments[0].content, '我也看见了。');
    assert.equal(data.posts[0].comments[0].imagePrompt, '雨夜站台照片');
    assert.equal(data.posts[0].imagePrompt, '');
    assert.ok(data.posts[0].likes > 0);
});

test('AI posts preserve repost links and receive varied social engagement defaults', () => {
    const data = normalizeGeneratedForum(JSON.stringify({ posts: [
        { author: '甲', handle: 'one', content: '第一条动态', repostOf: 'post-old', quoteText: '乙：旧帖' },
        { author: '丙', handle: 'two', content: '完全不同的第二条动态' },
    ] }), 1000);
    assert.equal(data.posts[0].repostOf, 'post-old');
    assert.equal(data.posts[0].quoteText, '乙：旧帖');
    assert.ok(data.posts.every(post => post.likes > 0));
    assert.notEqual(data.posts[0].likes, data.posts[1].likes);
});

test('existing post engagement advances without another model request', () => {
    const posts = [{ likes: 4, reposts: 1, storyRelevance: 60, comments: [{ likes: 0 }] }];
    const result = advanceSocialEngagement(posts, () => 0.9);
    assert.ok(posts[0].likes > 4);
    assert.equal(posts[0].reposts, 1);
    assert.ok(posts[0].comments[0].likes > 0);
    assert.ok(result.likesAdded > 0);
});

test('AI reposts connect to existing posts and raise the source repost count', () => {
    const existing = [{ id: 'post-old', author: '旧作者', handle: 'old', content: '旧帖正文', reposts: 2 }];
    const generated = [{ repostOf: 'post-old', quoteText: '' }];
    assert.equal(connectGeneratedReposts(existing, generated), 1);
    assert.equal(generated[0].repostOf, 'post-old');
    assert.match(generated[0].quoteText, /旧帖正文/);
    assert.equal(existing[0].reposts, 3);
});

test('forum injection includes only selected posts and optionally comments', () => {
    const posts = [
        { selectedForInjection: false, handle: 'off', author: '甲', content: '不要注入' },
        { selectedForInjection: true, handle: 'on', author: '乙', content: '需要注入', tags: ['热议'], comments: [{ author: '丙', content: '评论' }] },
    ];
    const output = buildForumInjection(posts, { maxPosts: 8, includeComments: true });
    assert.match(output, /需要注入/);
    assert.match(output, /评论/);
    assert.doesNotMatch(output, /不要注入/);
});

test('generation request excludes chat when reading is disabled', () => {
    const request = buildForumGenerationRequest({
        chat: [{ name: '角色', mes: '秘密正文' }],
        existingPosts: [{ id: 'post-old', author: '旧作者', handle: 'old', content: '旧帖正文' }],
        settings: {
            generation: { readChat: false, contextMessages: 20, postsPerRun: 3 },
            promptEntries: [{ enabled: true, constant: true, title: '规则', content: '自然讨论', order: 1 }],
        },
    });
    assert.doesNotMatch(request.user, /秘密正文/);
    assert.match(request.user, /3 条/);
    assert.equal(request.jsonSchema, undefined);
    assert.match(request.user, /<forum_data>/);
    assert.match(request.user, /likes/);
    assert.match(request.user, /帖子ID=post-old/);
    assert.match(request.user, /repostOf/);
});

test('forum prompt preserves preset and plugin message roles', () => {
    const request = buildForumGenerationRequest({
        settings: {
            generation: { postsMin: 2, postsMax: 2, commentsMin: 1, commentsMax: 3 },
            promptEntries: [{ enabled: true, constant: true, title: '助手示例', role: 'assistant', content: '示例语气', order: 1 }],
        },
        sourceContext: {
            presetPrompts: [{ id: 'preset-user', title: '用户预设', role: 'user', content: '预设正文' }],
        },
    });
    assert.deepEqual(request.messages.map(message => message.role), ['system', 'user', 'assistant', 'user']);
    assert.match(request.messages[1].content, /预设正文/);
    assert.match(request.messages[2].content, /示例语气/);
    assert.match(request.user, /2 条/);
    assert.match(request.user, /1～3 条/);
});

test('custom API parameters support types and nested paths without overriding messages', () => {
    const body = buildTextRequestBody({
        model: 'example',
        temperature: 0.7,
        maxTokens: 1000,
        extraParameters: [
            { key: 'top_p', value: '0.8', type: 'number', enabled: true },
            { key: 'thinking.enabled', value: 'true', type: 'boolean', enabled: true },
            { key: 'metadata', value: '{"source":"forum"}', type: 'json', enabled: true },
        ],
    }, { messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }] });
    assert.equal(body.top_p, 0.8);
    assert.deepEqual(body.thinking, { enabled: true });
    assert.deepEqual(body.metadata, { source: 'forum' });
    assert.deepEqual(body.messages.map(message => message.role), ['system', 'user']);
    assert.throws(() => buildTextRequestBody({ model: 'x', extraParameters: [{ key: 'messages', value: '[]', type: 'json' }] }, { user: 'u' }), /不能覆盖/);
});

test('forum output is repaired locally without another model request', () => {
    const commented = `说明文字\n{"posts":[{"author":"甲","handle":"a","content":"第一条"} // English note\n]}\n完成`;
    const repairedComment = recoverGeneratedForum(commented, 100);
    assert.equal(repairedComment.posts[0].content, '第一条');

    const concatenated = [
        `const output = '{\\n' +`,
        `'"posts":[\\n' +`,
        `'{"author":"乙","handle":"b","content":"第二条"}\\n' +`,
        `']\\n' +`,
        `'}'; // extra explanation`,
    ].join('\n');
    const repairedConcatenation = recoverGeneratedForum(concatenated, 200);
    assert.equal(repairedConcatenation.posts[0].author, '乙');
    assert.equal(repairedConcatenation.posts[0].content, '第二条');
});

test('locally salvages complete posts when the final JSON object is truncated', () => {
    const truncated = '{"posts":[{"author":"甲","handle":"a","content":"完整帖子"},{"author":"乙","handle":"b","content":"未完成';
    const recovered = recoverGeneratedForum(truncated, 300);
    assert.equal(recovered.posts.length, 1);
    assert.equal(recovered.posts[0].content, '完整帖子');
});

test('recovers forum JSON from reasoning in the same response when visible output is truncated', () => {
    const visible = '<forum_data>{"posts":[{"author":"Alpha","handle":"alpha","content":"cut off';
    const reasoning = 'analysis before output\n<forum_data>{"posts":[{"author":"Beta","handle":"beta","content":"complete post","imagePrompt":"rainy street"}]}</forum_data>';
    const recovered = recoverGeneratedForum(visible, 400, [reasoning]);
    assert.equal(recovered.posts.length, 1);
    assert.equal(recovered.posts[0].content, 'complete post');
    assert.equal(recovered.posts[0].imagePrompt, '一幅与这条动态内容有关的场景画面。');
});

test('reports true visible-output truncation without making another request', () => {
    const visible = '<forum_data>{"posts":[{"author":"Alpha","handle":"alpha","content":"cut off';
    assert.throws(() => recoverGeneratedForum(visible, 500), /中途被截断.*最大输出 Tokens/);
});

test('assistant text supports OpenAI text and content-part responses', () => {
    assert.equal(extractAssistantText({ choices: [{ message: { content: 'hello' } }] }), 'hello');
    assert.equal(extractAssistantText({ choices: [{ message: { content: [{ type: 'text', text: 'world' }] } }] }), 'world');
    assert.equal(extractAssistantText({ results: [{ text: 'legacy provider' }] }), 'legacy provider');
    assert.equal(extractAssistantReasoning({ choices: [{ message: { reasoning_content: 'thinking' } }] }), 'thinking');
});

test('generation request includes only explicitly supplied source context', () => {
    const request = buildForumGenerationRequest({
        settings: { generation: { readChat: true, contextMessages: 20, postsPerRun: 2 }, promptEntries: [] },
        sourceContext: {
            chat: '正文内容',
            userPersona: '',
            characterPersona: '角色人设',
            worldInfo: [{ book: '城市', uid: 1, title: '车站', content: '车站设定' }],
        },
    });
    assert.match(request.user, /正文内容/);
    assert.match(request.user, /角色人设/);
    assert.match(request.user, /车站设定/);
    assert.match(request.user, /User 人设】\n未选择读取/);
});

test('thread replies and NPC profiles are normalized', () => {
    const replies = normalizeThreadReplies('{"replies":[{"author":"小北","handle":"north","content":"我来解释。","replyTo":"me"}]}', 100);
    assert.equal(replies[0].isAi, true);
    assert.equal(replies[0].replyTo, 'me');
    const profile = normalizeNpcProfile('{"bio":"记者","tags":["本地"],"followers":99,"persona":"谨慎、求证后发言"}');
    assert.equal(profile.bio, '记者');
    assert.equal(profile.followers, 99);
});

test('direct messages use character or forum-role identity and normalize replies', () => {
    const request = buildDirectMessageRequest({
        conversation: { type: 'npc', name: '小北', handle: 'north' },
        npc: { persona: '谨慎的记者' },
        messages: [{ role: 'user', content: '在吗？' }],
        userName: '玩家',
    });
    assert.match(request.system, /小北/);
    assert.match(request.system, /谨慎的记者/);
    assert.equal(normalizeDirectMessage('我在。'), '我在。');
});

test('conversation migration supports current Char and forum roles', () => {
    const data = normalizeForumDataShape({ posts: [], npcs: [] });
    const character = ensureCharacterConversation(data, { characterId: '7', characterName: '阿月', characterHandle: 'moon' });
    const role = createNpc({ name: '小北', handle: 'north' });
    data.npcs.push(role);
    const roleConversation = ensureNpcConversation(data, role);
    assert.equal(character.type, 'char');
    assert.equal(roleConversation.type, 'npc');
    assert.equal(data.conversations.length, 2);
});

test('role-to-role conversations are private and role memories stay isolated', () => {
    const data = normalizeForumDataShape({ posts: [], npcs: [], facts: [] });
    const first = createNpc({ name: '甲', handle: 'a' });
    const second = createNpc({ name: '乙', handle: 'b' });
    data.npcs.push(first, second);
    const conversation = ensureRoleConversation(data, first, second);
    assert.equal(conversation.type, 'role_dm');
    assert.equal(conversation.privateConversation, true);
    assert.deepEqual(new Set(conversation.participantIds), new Set([first.id, second.id]));
    first.memory.knownFacts.push('甲知道的秘密');
    assert.deepEqual(second.memory.knownFacts, []);
    const request = buildRoleDirectMessageRequest({ conversation, speaker: first, otherRole: second, sourceContext: { facts: [{ content: '允许事实' }] } });
    assert.match(request.system, /不得知道第三人的私信/);
});

test('facts and expanded social state migrate to v11', () => {
    const role = createNpc({ name: '甲', handle: 'a' });
    role.socialState = 'quarrel';
    const fact = createFact({ content: '只有甲知道', visibility: 'restricted', knownBy: [role.id] });
    const data = normalizeForumDataShape({ posts: [], npcs: [role], facts: [fact] });
    assert.equal(data.version, 12);
    assert.equal(data.npcs[0].socialState, 'quarrel');
    assert.deepEqual(data.facts[0].knownBy, [role.id]);
});

test('v10 migration keeps engagement but removes only old forced image placeholders', () => {
    const data = normalizeForumDataShape({ version: 8, posts: [
        { id: 'ai-one', author: '甲', handle: 'alpha', content: '第一条旧动态', imagePrompt: '与这篇动态相符的真实现场照片：第一条旧动态', likes: 7, reposts: 1, isAi: true, comments: [{ author: '乙', handle: 'beta', content: '旧评论', likes: 2, isAi: true }] },
        { id: 'ai-two', author: '丙', handle: 'gamma', content: '确实适合配图', imagePrompt: '雨夜列车进站的远景照片', likes: 6, reposts: 0, isAi: true, comments: [] },
        { id: 'mine', author: '我', handle: 'me', content: '用户刚发布', likes: 0, reposts: 0, isAi: false, comments: [] },
    ] });
    assert.ok(data.posts[0].likes > 0);
    assert.equal(data.posts[0].imagePrompt, '');
    assert.equal(data.posts[1].imagePrompt, '雨夜列车进站的远景照片');
    assert.equal(data.posts[2].likes, 0);
    assert.equal(data.posts[2].imagePrompt, '');
});

test('runtime logs are bounded and never enter forum injection', () => {
    const logs = Array.from({ length: 24 }, (_, index) => ({
        id: `log-${index}`,
        status: index === 23 ? 'error' : 'success',
        reasoning: `后台秘密 ${index}`,
        output: `原始输出 ${index}`,
    }));
    const data = normalizeForumDataShape({
        posts: [{ selectedForInjection: true, author: '甲', handle: 'a', content: '公开帖子' }],
        generationLogs: logs,
    });
    assert.equal(data.generationLogs.length, 20);
    assert.equal(data.generationLogs.at(-1).status, 'error');
    const injection = buildForumInjection(data.posts);
    assert.match(injection, /公开帖子/);
    assert.doesNotMatch(injection, /后台秘密|原始输出/);
});

test('current Char becomes a bound role with a built-in image avatar', () => {
    const data = normalizeForumDataShape({ posts: [], npcs: [] });
    const role = ensureCharacterRole(data, { characterId: '7', characterName: '阿月', characterHandle: 'moon', characterPersona: '谨慎的记者' });
    assert.equal(role.bindingType, 'char');
    assert.equal(role.systemRole, true);
    assert.match(role.avatarUrl, /^data:image\/svg\+xml,/);
    assert.match(createDefaultAvatarDataUrl('陌生人'), /^data:image\/svg\+xml,/);
});

test('notifications migrate and preserve social types', () => {
    const notice = createNotification({ type: 'reply', actorName: '小北', postId: 'p1', content: '回复了你' });
    const data = normalizeForumDataShape({ posts: [], npcs: [], notifications: [notice] });
    assert.equal(data.version, 12);
    assert.equal(data.notifications[0].type, 'reply');
    assert.equal(data.notifications[0].read, false);
});

test('NPC authors are linked and their evidence can be collected', () => {
    const data = normalizeForumDataShape({
        posts: [{ id: 'p1', author: '小北', handle: 'north', content: '第一条', isAi: true, comments: [{ author: '小北', handle: 'north', content: '补充', isAi: true }] }],
        npcs: [],
    });
    linkNpcAuthors(data);
    assert.equal(data.npcs.length, 1);
    assert.equal(data.posts[0].npcId, data.npcs[0].id);
    assert.deepEqual(collectNpcEvidence(data, data.npcs[0].id), ['主帖：第一条', '回帖：补充']);
});

test('automatic cleanup keeps favorites even above the limit', () => {
    const posts = [
        { id: 'old' },
        { id: 'favorite-a', favorite: true },
        { id: 'new' },
        { id: 'favorite-b', favorite: true },
    ];
    const result = prunePosts(posts, 2);
    assert.deepEqual(result.posts.map(post => post.id), ['favorite-a', 'favorite-b']);
    assert.deepEqual(result.removed.map(post => post.id), ['old', 'new']);
});

test('NPC injection uses only individually enabled personas', () => {
    const output = buildNpcInjection([
        { name: '甲', handle: 'a', inject: false, persona: '不应出现' },
        { name: '乙', handle: 'b', inject: true, persona: '谨慎的记者' },
    ]);
    assert.match(output, /谨慎的记者/);
    assert.doesNotMatch(output, /不应出现/);
});

test('role injection also includes bound Char or world-book content', () => {
    const output = buildNpcInjection([{ name: '阿月', handle: 'moon', inject: true, persona: '', bindingContent: '绑定的角色卡资料' }]);
    assert.match(output, /绑定的角色卡资料/);
});
