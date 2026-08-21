import { DEFAULT_BUILTIN_PROMPTS } from './constants.js';

const DEFAULT_AUTHOR = '匿名网友';

export const FORUM_GENERATION_JSON_SCHEMA = Object.freeze({
    name: 'tavern_forum_posts',
    description: 'A compact batch of in-world social posts. Return JSON data only.',
    strict: false,
    returnInvalid: true,
    value: {
        type: 'object',
        properties: {
            topic: { type: 'string', description: 'Optional name for the current community topic.' },
            worldUpdates: {
                type: 'object',
                description: 'Optional updates for linked world modules requested by the caller.',
                additionalProperties: true,
            },
            dmEvents: {
                type: 'array',
                description: 'Optional proactive direct messages requested by the caller.',
                items: {
                    type: 'object',
                    properties: {
                        targetHandle: { type: 'string' },
                        content: { type: 'string' },
                        reason: { type: 'string' },
                    },
                    required: ['targetHandle', 'content'],
                },
            },
            posts: {
                type: 'array',
                minItems: 1,
                maxItems: 10,
                items: {
                    type: 'object',
                    properties: {
                        author: { type: 'string', description: 'Public display name of the post author.' },
                        handle: { type: 'string', description: 'Account handle without the @ prefix.' },
                        content: { type: 'string', description: 'Post body written directly by the in-world author.' },
                        likes: { type: 'integer', minimum: 0, description: 'Optional believable initial like count.' },
                        reposts: { type: 'integer', minimum: 0, description: 'Optional believable initial repost count.' },
                        repostOf: { type: 'string', description: 'Optional exact ID of an existing post being reposted. Omit for an original post.' },
                        quoteText: { type: 'string', description: 'Optional snapshot of the reposted post. Use only with repostOf.' },
                        storyRelevance: { type: 'integer', minimum: 0, maximum: 100, description: 'Optional relevance to current story events.' },
                        tags: {
                            type: 'array',
                            maxItems: 4,
                            items: { type: 'string' },
                            description: 'Optional short topic tags.',
                        },
                        imagePrompt: {
                            type: 'string',
                            description: 'Optional brief visual description written in Simplified Chinese only. Omit it when the post needs no image.',
                        },
                        poll: {
                            type: 'object',
                            description: 'Optional poll. Omit it for ordinary posts.',
                            properties: {
                                question: { type: 'string' },
                                options: {
                                    type: 'array',
                                    minItems: 2,
                                    maxItems: 4,
                                    items: { type: 'string' },
                                },
                            },
                            required: ['question', 'options'],
                        },
                        comments: {
                            type: 'array',
                            maxItems: 8,
                            description: 'Optional initial reactions. Omit it when no comment is needed.',
                            items: {
                                type: 'object',
                                properties: {
                                    author: { type: 'string' },
                                    handle: { type: 'string' },
                                    content: { type: 'string' },
                                    imagePrompt: { type: 'string', description: 'Optional image description in Simplified Chinese only.' },
                                },
                                required: ['author', 'handle', 'content'],
                            },
                        },
                    },
                    required: ['author', 'handle', 'content'],
                },
            },
        },
        required: ['posts'],
    },
});

const THREAD_REPLIES_JSON_SCHEMA = Object.freeze({
    name: 'tavern_forum_replies',
    description: 'Replies to an in-world forum thread.',
    strict: false,
    returnInvalid: true,
    value: {
        type: 'object',
        properties: {
            replies: {
                type: 'array',
                minItems: 1,
                maxItems: 8,
                items: {
                    type: 'object',
                    properties: {
                        author: { type: 'string' },
                        handle: { type: 'string' },
                        content: { type: 'string' },
                        replyTo: { type: 'string' },
                        imagePrompt: { type: 'string', description: 'Optional image description in Simplified Chinese only.' },
                        likes: { type: 'integer', minimum: 0 },
                    },
                    required: ['author', 'handle', 'content'],
                },
            },
        },
        required: ['replies'],
    },
});

const NPC_PROFILE_JSON_SCHEMA = Object.freeze({
    name: 'tavern_forum_role_profile',
    description: 'An in-world social profile and stable role persona.',
    strict: false,
    returnInvalid: true,
    value: {
        type: 'object',
        properties: {
            bio: { type: 'string' },
            location: { type: 'string' },
            signature: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            followers: { type: 'integer', minimum: 0 },
            following: { type: 'integer', minimum: 0 },
            persona: { type: 'string' },
            pinnedPost: { type: 'string' },
            followingHandles: { type: 'array', items: { type: 'string' } },
        },
        required: ['bio', 'location', 'signature', 'tags', 'followers', 'following', 'persona', 'pinnedPost'],
    },
});

function safeString(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback;
}

function builtinPrompt(settings, id) {
    return safeString(settings?.builtinPrompts?.[id], DEFAULT_BUILTIN_PROMPTS[id] || '');
}

function applyTemplate(template, content) {
    const source = safeString(template);
    if (!source) return content;
    return source.includes('{{content}}') ? source.replace(/\{\{content\}\}/g, content) : `${source}\n${content}`;
}

function normalizeChineseImagePrompt(value, fallbackContent = '') {
    const prompt = safeString(value);
    if (!prompt || /[\u3400-\u9fff]/u.test(prompt)) return prompt;
    const fallback = safeString(fallbackContent).replace(/\s+/g, ' ').slice(0, 100);
    return /[\u3400-\u9fff]/u.test(fallback) ? `与这条动态有关的场景：${fallback}` : '一幅与这条动态内容有关的场景画面。';
}

function safeInteger(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function randomInteger(min, max) {
    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    return lower + Math.floor(Math.random() * (upper - lower + 1));
}

function stableSocialSeed(value) {
    return Array.from(String(value || 'forum')).reduce((seed, character) => (((seed * 33) ^ character.codePointAt(0)) >>> 0), 5381);
}

function generatedEngagement(value, fallback, min = 0, max = 9999999) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function extractMentions(value) {
    const matches = String(value || '').matchAll(/@([\w\u4e00-\u9fff.-]{1,32})/gu);
    return [...new Set([...matches].map(match => match[1].toLocaleLowerCase()))];
}

function normalizePoll(poll) {
    if (!poll || typeof poll !== 'object' || !Array.isArray(poll.options)) return null;
    const options = poll.options.map(option => ({
        id: createId('poll-option'),
        text: safeString(typeof option === 'string' ? option : option?.text),
        votes: safeInteger(typeof option === 'string' ? 0 : option?.votes, 0, 0, 9999999),
        votedByUser: false,
    })).filter(option => option.text).slice(0, 10);
    if (options.length < 2) return null;
    return {
        question: safeString(poll.question, '你怎么看？'),
        options,
        multiple: Boolean(poll.multiple),
        closed: false,
    };
}

function formatMemory(npc) {
    const memory = npc?.memory || {};
    return [
        `@${safeString(npc?.handle)}（${safeString(npc?.name)}）`,
        `与用户关系：${safeString(memory.relationshipToUser, '陌生人')}（关系值 ${Number(memory.relationshipScore || 0)}）`,
        `当前状态：${safeString(npc?.socialState, 'normal')}${npc?.muted ? '；已静音' : ''}${npc?.blocked ? '；已拉黑' : ''}`,
        memory.knownFacts?.length && `确定知道：${memory.knownFacts.join('；')}`,
        memory.unknownFacts?.length && `明确不知道：${memory.unknownFacts.join('；')}`,
        memory.attitudes?.length && `对其他角色态度：${memory.attitudes.join('；')}`,
        memory.publicHistory?.length && `公开经历：${memory.publicHistory.slice(-12).join('；')}`,
        memory.notes && `用户备注：${memory.notes}`,
    ].filter(Boolean).join('\n');
}

export function createId(prefix = 'item') {
    if (globalThis.crypto?.randomUUID) {
        return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasOwn(target, key) {
    return Object.prototype.hasOwnProperty.call(target, key);
}

export function formatChatContext(chat, limit = 20, names = {}) {
    if (!Array.isArray(chat) || chat.length === 0) return '';

    const normalizedLimit = safeInteger(limit, 20, 1, 200);
    return chat
        .filter(message => message && typeof message.mes === 'string' && message.mes.trim())
        .slice(-normalizedLimit)
        .map(message => {
            const speaker = safeString(message.name)
                || (message.is_user ? safeString(names.user, '用户') : safeString(names.character, '角色'));
            return `${speaker}：${message.mes.trim()}`;
        })
        .join('\n');
}

export function getActivePromptEntries(entries, scanText) {
    const haystack = safeString(scanText).toLocaleLowerCase();
    if (!Array.isArray(entries)) return [];

    return entries
        .filter(entry => entry?.enabled && safeString(entry.content))
        .filter(entry => {
            if (entry.constant) return true;
            const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
            return keywords.some(keyword => haystack.includes(safeString(keyword).toLocaleLowerCase()));
        })
        .sort((a, b) => safeInteger(b.order, 0, -99999) - safeInteger(a.order, 0, -99999));
}

export function buildForumGenerationRequest({
    chat = [],
    names = {},
    settings,
    existingPosts = [],
    sourceContext = null,
    excludedRoles = [],
    linkedWorldInstruction = '',
}) {
    const context = sourceContext?.chat ?? (settings?.generation?.readChat
        ? formatChatContext(chat, settings.generation.contextMessages, names)
        : '');
    const userPersona = safeString(sourceContext?.userPersona);
    const characterPersona = safeString(sourceContext?.characterPersona);
    const worldInfo = Array.isArray(sourceContext?.worldInfo) ? sourceContext.worldInfo : [];
    const facts = Array.isArray(sourceContext?.facts) ? sourceContext.facts : [];
    const roleMemories = Array.isArray(sourceContext?.roleMemories) ? sourceContext.roleMemories : [];
    const presetPrompts = Array.isArray(sourceContext?.presetPrompts) ? sourceContext.presetPrompts : [];
    const recentPosts = Array.isArray(existingPosts)
        ? existingPosts.slice(-6).map(post => `[帖子ID=${safeString(post.id)}] @${safeString(post.handle, 'user')}：${safeString(post.content)}`).join('\n')
        : '';
    const scanText = [context, userPersona, characterPersona, ...worldInfo.map(entry => entry.content), ...facts.map(entry => entry.content), recentPosts].filter(Boolean).join('\n');
    const activeEntries = getActivePromptEntries(settings?.promptEntries, scanText);
    const legacyPostCount = safeInteger(settings?.generation?.postsPerRun, 4, 1, 10);
    const postsMin = safeInteger(settings?.generation?.postsMin, legacyPostCount, 1, 10);
    const postsMax = safeInteger(settings?.generation?.postsMax, legacyPostCount, 1, 10);
    const commentsMin = safeInteger(settings?.generation?.commentsMin, 0, 0, 8);
    const commentsMax = safeInteger(settings?.generation?.commentsMax, 3, 0, 8);
    const count = randomInteger(postsMin, postsMax);
    const commentLower = Math.min(commentsMin, commentsMax);
    const commentUpper = Math.max(commentsMin, commentsMax);
    const socialInstruction = settings?.social?.requireRoleFollowBeforeDm
        ? '如果某个角色在本轮互动中明确产生了主动关注关系，可以在根对象 worldUpdates.socialActions 中加入 {"actorHandle":"角色账号","targetHandle":"me","action":"follow"}；不要为了开放私信而无缘无故关注。'
        : '';

    const baseSystem = builtinPrompt(settings, 'forumSystem');
    const sourceSections = [
        context ? `【最近的故事正文】\n${context}` : '【最近的故事正文】\n未选择读取。',
        userPersona ? `【User 人设】\n${userPersona}` : '【User 人设】\n未选择读取。',
        characterPersona ? `【Char 人设】\n${characterPersona}` : '【Char 人设】\n未选择读取。',
        worldInfo.length ? `【用户选中的世界书条目】\n${worldInfo.map(entry => `《${safeString(entry.book)} / ${safeString(entry.title, `UID ${entry.uid}`)}》\n${safeString(entry.content)}`).join('\n\n')}` : '【世界书条目】\n未选择读取。',
        facts.length ? `【可用于公开发帖的事实】\n${facts.map(fact => `- ${safeString(fact.content)}`).join('\n')}` : '',
        roleMemories.length ? `【角色的独立社交记忆】\n${roleMemories.map(formatMemory).join('\n\n')}\n每个角色只能使用其“确定知道”的信息，必须避开其“明确不知道”的信息。私信秘密不得公开。` : '',
        excludedRoles.length ? `【不得出现的账号】\n${excludedRoles.map(role => `@${safeString(role.handle)}（${safeString(role.name)}）`).join('、')}\n这些账号已被用户拉黑，不得让他们发帖、评论、转发或参与互动。` : '',
        recentPosts ? `【论坛已有讨论】\n${recentPosts}` : '【论坛已有讨论】\n暂无。',
    ].filter(Boolean);
    const user = `请生成 ${count} 条新的论坛帖子。每篇帖子生成 ${commentLower}～${commentUpper} 条自然的初始评论；评论数量应有差异，不要每篇完全相同。${builtinPrompt(settings, 'forumGeneration')} 所有 imagePrompt 必须只用简体中文描述画面，禁止输出英文配图提示词。少量新帖子可以由角色转发或引用“论坛已有讨论”中的旧帖：此时把 repostOf 填成旧帖方括号里的准确帖子ID，并把 quoteText 填成旧帖作者与正文的简短快照；原创帖不要填写这两个字段。${socialInstruction ? `\n${socialInstruction}` : ''}\n\n${sourceSections.join('\n\n')}${linkedWorldInstruction ? `\n\n【联动模块】\n${safeString(linkedWorldInstruction)}` : ''}\n\n请把最终帖子数据放进 <forum_data> 与 </forum_data> 标记，标记内使用紧凑 JSON。根对象可包含 topic、posts、worldUpdates 和 dmEvents；每篇帖子必须有 author、handle、content，可选 imagePrompt，并可包含 tags、likes、reposts、repostOf、quoteText、storyRelevance、comments；每条评论必须有 author、handle、content，也可有 imagePrompt；确实适合投票的帖子才增加 poll（question 与 2～4 个 options）。数值字段拿不准时可以省略，插件会补充彼此不同的自然初始值。最小数据格式：<forum_data>{"posts":[{"author":"昵称","handle":"账号","content":"正文"}]}</forum_data>。如果接口自然产生分析、思维过程或说明，可以完整保留在标记之外；插件只读取 forum_data，且不要在标记内写注释、解释或字符串拼接符。`;
    const normalizeRole = role => ['system', 'user', 'assistant'].includes(role) ? role : 'system';
    const contextualMessages = [
        ...presetPrompts.map(entry => ({
            role: normalizeRole(entry.role),
            content: `【酒馆预设 · ${safeString(entry.title, '未命名条目')}】\n${safeString(entry.content)}`,
        })),
        ...activeEntries.map(entry => ({
            role: normalizeRole(entry.role),
            content: `【论坛设定 · ${safeString(entry.title, '未命名设定')}】\n${safeString(entry.content)}`,
        })),
    ].filter(message => safeString(message.content));
    const messages = [
        { role: 'system', content: baseSystem },
        ...contextualMessages,
        { role: 'user', content: user },
    ];
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');

    return { system, user, messages, activeEntries, presetPrompts };
}

function unwrapContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
    }
    return '';
}

export function extractAssistantText(payload) {
    const choice = payload?.choices?.[0];
    return unwrapContent(choice?.message?.content)
        || safeString(choice?.text)
        || safeString(payload?.results?.[0]?.text)
        || unwrapContent(payload?.content)
        || safeString(payload?.output)
        || safeString(payload?.response);
}

export function extractAssistantReasoning(payload) {
    const choice = payload?.choices?.[0];
    const message = choice?.message || {};
    const reasoning = message.reasoning_content ?? message.reasoning ?? choice?.reasoning ?? payload?.reasoning;
    if (typeof reasoning === 'string') return reasoning.trim();
    if (Array.isArray(reasoning)) return reasoning.map(part => typeof part === 'string' ? part : part?.text || '').join('').trim();
    return '';
}

function stripJavaScriptComments(source) {
    const text = String(source || '');
    let result = '';
    let quote = '';
    let escaped = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];
        if (quote) {
            result += char;
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = '';
            }
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            result += char;
            continue;
        }
        if (char === '/' && next === '/') {
            while (index < text.length && text[index] !== '\n') index += 1;
            result += '\n';
            continue;
        }
        if (char === '/' && next === '*') {
            index += 2;
            while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
            index += 1;
            result += ' ';
            continue;
        }
        result += char;
    }
    return result;
}

function readJavaScriptString(source, start) {
    const quote = source[start];
    if (!['"', "'", '`'].includes(quote)) return null;
    let value = '';
    for (let index = start + 1; index < source.length; index += 1) {
        const char = source[index];
        if (char === quote) return { value, start, end: index + 1 };
        if (char !== '\\') {
            value += char;
            continue;
        }
        index += 1;
        if (index >= source.length) return null;
        const escaped = source[index];
        const simpleEscapes = {
            n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0',
            '\\': '\\', '"': '"', "'": "'", '`': '`', '/': '/',
        };
        if (hasOwn(simpleEscapes, escaped)) {
            value += simpleEscapes[escaped];
            continue;
        }
        if (escaped === '\n') continue;
        if (escaped === '\r') {
            if (source[index + 1] === '\n') index += 1;
            continue;
        }
        if (escaped === 'x' && /^[0-9a-f]{2}$/i.test(source.slice(index + 1, index + 3))) {
            value += String.fromCharCode(Number.parseInt(source.slice(index + 1, index + 3), 16));
            index += 2;
            continue;
        }
        if (escaped === 'u') {
            const unicode = source.slice(index + 1, index + 5);
            if (/^[0-9a-f]{4}$/i.test(unicode)) {
                value += String.fromCharCode(Number.parseInt(unicode, 16));
                index += 4;
                continue;
            }
        }
        value += escaped;
    }
    return null;
}

function joinConcatenatedStringLiterals(source) {
    const text = stripJavaScriptComments(source);
    const tokens = [];
    for (let index = 0; index < text.length; index += 1) {
        if (!['"', "'", '`'].includes(text[index])) continue;
        const token = readJavaScriptString(text, index);
        if (!token) continue;
        tokens.push(token);
        index = token.end - 1;
    }
    if (tokens.length < 2) return '';

    const groups = [];
    let current = [tokens[0]];
    for (let index = 1; index < tokens.length; index += 1) {
        const previous = tokens[index - 1];
        const token = tokens[index];
        const separator = text.slice(previous.end, token.start);
        if (/^\s*\+\s*$/.test(separator)) {
            current.push(token);
        } else {
            if (current.length > 1) groups.push(current);
            current = [token];
        }
    }
    if (current.length > 1) groups.push(current);
    const candidates = groups
        .map(group => group.map(token => token.value).join(''))
        .filter(value => value.includes('posts'))
        .sort((left, right) => right.length - left.length);
    return candidates[0] || '';
}

function extractCompletePostObjects(source) {
    const text = String(source || '');
    const marker = /["']posts["']\s*:\s*\[/.exec(text);
    let arrayStart = marker ? marker.index + marker[0].lastIndexOf('[') : -1;
    if (arrayStart < 0 && text.trimStart().startsWith('[')) arrayStart = text.indexOf('[');
    if (arrayStart < 0) return [];

    const posts = [];
    let arrayDepth = 1;
    let objectDepth = 0;
    let objectStart = -1;
    let quote = '';
    let escaped = false;
    for (let index = arrayStart + 1; index < text.length; index += 1) {
        const char = text[index];
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quote) {
                quote = '';
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '[') {
            arrayDepth += 1;
            continue;
        }
        if (char === ']') {
            arrayDepth -= 1;
            if (arrayDepth === 0) break;
            continue;
        }
        if (char === '{') {
            if (arrayDepth === 1 && objectDepth === 0) objectStart = index;
            objectDepth += 1;
            continue;
        }
        if (char === '}' && objectDepth > 0) {
            objectDepth -= 1;
            if (objectDepth === 0 && objectStart >= 0) {
                try {
                    const post = JSON.parse(text.slice(objectStart, index + 1).replace(/,\s*([}\]])/g, '$1'));
                    if (post && typeof post === 'object' && safeString(post.content)) posts.push(post);
                } catch { /* skip only the malformed post */ }
                objectStart = -1;
            }
        }
    }
    return posts;
}

export function parseJsonResponse(raw) {
    if (raw && typeof raw === 'object') return raw;
    let text = safeString(raw);
    if (!text) throw new Error('API 没有返回内容');

    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const forumData = text.match(/<forum_data>\s*([\s\S]*?)\s*<\/forum_data>/i);
    if (forumData?.[1]) text = forumData[1].trim();
    const moduleData = text.match(/<module_data>\s*([\s\S]*?)\s*<\/module_data>/i);
    if (moduleData?.[1]) text = moduleData[1].trim();
    const parseWithRepairs = source => {
        let candidate = source
            .replace(/^\uFEFF/, '')
            .replace(/,\s*([}\]])/g, '$1');
        let lastError = null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            try {
                return JSON.parse(candidate);
            } catch (error) {
                lastError = error;
                const position = Number(error.message.match(/(?:position|at position)\s+(\d+)/i)?.[1]);
                const missingComma = /Expected ',' or '[}\]]' after (?:array element|property value)/i.test(error.message);
                if (missingComma && Number.isInteger(position)) {
                    candidate = `${candidate.slice(0, position)},${candidate.slice(position)}`;
                    continue;
                }
                const unexpectedClosing = /Unexpected token '[}\]]'/i.test(error.message);
                if (unexpectedClosing && Number.isInteger(position)) {
                    const before = candidate.slice(0, position).replace(/,\s*$/, match => match.replace(',', ''));
                    candidate = before + candidate.slice(position);
                    continue;
                }
                break;
            }
        }
        throw lastError;
    };
    try {
        return parseWithRepairs(text);
    } catch {
        const objectStart = text.indexOf('{');
        const objectEnd = text.lastIndexOf('}');
        if (objectStart !== -1 && objectEnd > objectStart) {
            try { return parseWithRepairs(text.slice(objectStart, objectEnd + 1)); } catch { /* try array */ }
        }
        const arrayStart = text.indexOf('[');
        const arrayEnd = text.lastIndexOf(']');
        if (arrayStart !== -1 && arrayEnd > arrayStart) {
            try { return parseWithRepairs(text.slice(arrayStart, arrayEnd + 1)); } catch { /* show friendly error */ }
        }
        throw new Error('模型返回的帖子格式不完整（已尝试自动修复）。请再生成一次；如果经常发生，可换用更稳定的模型或降低温度。');
    }
}

export function normalizeGeneratedForum(raw, now = Date.now()) {
    const parsed = parseJsonResponse(raw);
    const sourcePosts = Array.isArray(parsed) ? parsed : parsed?.posts;
    if (!Array.isArray(sourcePosts) || sourcePosts.length === 0) {
        throw new Error('返回结果里没有帖子');
    }

    const posts = sourcePosts.slice(0, 10).map((post, index) => {
        const comments = Array.isArray(post?.comments)
            ? post.comments.slice(0, 12).map((comment, commentIndex) => {
                const commentSeed = stableSocialSeed(`${comment?.handle}|${comment?.content}|${index}|${commentIndex}`);
                return {
                id: createId('comment'),
                author: safeString(comment?.author, DEFAULT_AUTHOR),
                handle: safeString(comment?.handle, `user${Math.floor(Math.random() * 9000 + 1000)}`).replace(/^@/, ''),
                content: safeString(comment?.content),
                replyTo: safeString(comment?.replyTo).replace(/^@/, ''),
                parentId: '',
                mentions: extractMentions(comment?.content),
                likes: generatedEngagement(comment?.likes, commentSeed % 9),
                imagePrompt: normalizeChineseImagePrompt(comment?.imagePrompt, comment?.content),
                imageUrl: '',
                imageKey: '',
                likedByUser: false,
                isAi: true,
                createdAt: now + index,
                };
            }).filter(comment => comment.content)
            : [];
        const tags = Array.isArray(post?.tags)
            ? post.tags.map(tag => safeString(tag).replace(/^#/, '')).filter(Boolean).slice(0, 6)
            : [];

        const socialSeed = stableSocialSeed(`${post?.handle}|${post?.content}|${index}`);
        const fallbackLikes = Math.max(comments.length, 2 + (socialSeed % (24 + comments.length * 5)));
        const fallbackReposts = (socialSeed >>> 7) % Math.max(2, Math.ceil(fallbackLikes / 4));
        const postContent = safeString(post?.content);
        const imagePrompt = normalizeChineseImagePrompt(post?.imagePrompt, postContent);

        return {
            id: createId('post'),
            author: safeString(post?.author, `${DEFAULT_AUTHOR}${index + 1}`),
            handle: safeString(post?.handle, `user${Math.floor(Math.random() * 9000 + 1000)}`).replace(/^@/, ''),
            content: postContent,
            tags,
            likes: generatedEngagement(post?.likes, fallbackLikes),
            reposts: generatedEngagement(post?.reposts, fallbackReposts),
            storyRelevance: safeInteger(post?.storyRelevance, 0, 0, 100),
            mentions: extractMentions(post?.content),
            repostOf: safeString(post?.repostOf),
            quoteText: safeString(post?.quoteText),
            poll: normalizePoll(post?.poll),
            comments,
            imagePrompt,
            imageUrl: '',
            imageKey: '',
            selectedForInjection: true,
            likedByUser: false,
            favorite: false,
            isAi: true,
            npcId: '',
            createdAt: now + index,
        };
    }).filter(post => post.content);

    if (!posts.length) throw new Error('生成的帖子正文都是空的');
    return {
        topic: safeString(parsed?.topic, posts[0]?.tags?.[0] || '故事热议'),
        posts,
    };
}

function looksLikeTruncatedForumOutput(raw) {
    const source = String(raw || '').trim();
    if (!source) return false;
    if (/<forum_data>/i.test(source) && !/<\/forum_data>/i.test(source)) return true;
    let quote = '';
    let escaped = false;
    let objectDepth = 0;
    let arrayDepth = 0;
    for (const character of source) {
        if (quote) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = '';
            continue;
        }
        if (character === '"' || character === "'") quote = character;
        else if (character === '{') objectDepth += 1;
        else if (character === '}') objectDepth -= 1;
        else if (character === '[') arrayDepth += 1;
        else if (character === ']') arrayDepth -= 1;
    }
    return Boolean(quote || objectDepth > 0 || arrayDepth > 0);
}

export function recoverGeneratedForum(raw, now = Date.now(), alternateSources = []) {
    const sources = [raw, ...(Array.isArray(alternateSources) ? alternateSources : [alternateSources])]
        .map(value => String(value || '').trim())
        .filter(Boolean);
    for (const source of sources) {
        const uncommented = stripJavaScriptComments(source).trim();
        const concatenated = joinConcatenatedStringLiterals(source).trim();
        const candidates = [...new Set([source, uncommented, concatenated, stripJavaScriptComments(concatenated).trim()].filter(Boolean))];
        for (const candidate of candidates) {
            try {
                return normalizeGeneratedForum(candidate, now);
            } catch { /* try the next local representation */ }
        }
        for (const candidate of candidates) {
            const posts = extractCompletePostObjects(candidate);
            if (posts.length) return normalizeGeneratedForum({ posts }, now);
        }
    }
    if (looksLikeTruncatedForumOutput(raw)) {
        throw new Error('模型的可见输出在帖子中途被截断，尚未形成一个完整帖子。本次没有再次调用 API；请调高“API → 最大输出 Tokens”后重试。');
    }
    throw new Error('模型内容已生成，但本地无法识别其中的完整帖子；本次没有再次调用 API。');
}

export function buildForumInjection(posts, options = {}) {
    if (!Array.isArray(posts)) return '';
    const maxPosts = safeInteger(options.maxPosts, 8, 1, 50);
    const selected = posts.filter(post => post?.selectedForInjection).slice(-maxPosts);
    if (!selected.length) return '';

    const lines = selected.map((post, index) => {
        const tags = Array.isArray(post.tags) && post.tags.length
            ? ` ${post.tags.map(tag => `#${safeString(tag).replace(/^#/, '')}#`).join(' ')}`
            : '';
        const comments = options.includeComments && Array.isArray(post.comments) && post.comments.length
            ? `\n  评论：${post.comments.map(comment => `${safeString(comment.author, DEFAULT_AUTHOR)}：${safeString(comment.content)}${safeString(comment.imagePrompt) ? ` [配图：${safeString(comment.imagePrompt)}]` : ''}`).join('；')}`
            : '';
        const image = safeString(post.imagePrompt) ? ` [配图：${safeString(post.imagePrompt)}]` : '';
        const repost = safeString(post.repostOf) && safeString(post.quoteText) ? ` [转发引用：${safeString(post.quoteText)}]` : '';
        return `${index + 1}. @${safeString(post.handle, 'user')}（${safeString(post.author, DEFAULT_AUTHOR)}）：${safeString(post.content)}${repost}${tags}${image}${comments}`;
    });

    return applyTemplate(options.template || DEFAULT_BUILTIN_PROMPTS.mainChatInjection, lines.join('\n'));
}

export function createManualPost({ author, handle, content, tags = [], repostOf = '', quoteText = '', poll = null }, now = Date.now()) {
    const normalizedContent = safeString(content);
    if (!normalizedContent) throw new Error('帖子正文不能为空');
    return {
        id: createId('post'),
        author: safeString(author, DEFAULT_AUTHOR),
        handle: safeString(handle, 'me').replace(/^@/, ''),
        content: normalizedContent,
        tags: Array.isArray(tags) ? tags.map(tag => safeString(tag).replace(/^#/, '')).filter(Boolean).slice(0, 8) : [],
        likes: 0,
        reposts: 0,
        storyRelevance: 0,
        mentions: extractMentions(normalizedContent),
        repostOf: safeString(repostOf),
        quoteText: safeString(quoteText),
        poll: normalizePoll(poll),
        comments: [],
        imagePrompt: '',
        imageUrl: '',
        imageKey: '',
        selectedForInjection: true,
        likedByUser: false,
        favorite: false,
        isAi: false,
        npcId: '',
        createdAt: now,
    };
}

export function createManualComment({ author, handle, content, replyTo = '', parentId = '', imagePrompt = '' }, now = Date.now()) {
    const normalizedContent = safeString(content);
    if (!normalizedContent) throw new Error('回复内容不能为空');
    return {
        id: createId('comment'),
        author: safeString(author, '我'),
        handle: safeString(handle, 'me').replace(/^@/, ''),
        content: normalizedContent,
        replyTo: safeString(replyTo),
        parentId: safeString(parentId),
        mentions: extractMentions(normalizedContent),
        likes: 0,
        likedByUser: false,
        imagePrompt: safeString(imagePrompt),
        imageUrl: '',
        imageKey: '',
        isAi: false,
        npcId: '',
        createdAt: now,
    };
}

export function buildThreadReplyRequest({ post, userComment, npcs = [], sourceContext = {}, settings }) {
    const legacyReplyCount = safeInteger(settings?.generation?.repliesPerRun, 2, 1, 8);
    const repliesMin = safeInteger(settings?.generation?.repliesMin, legacyReplyCount, 1, 8);
    const repliesMax = safeInteger(settings?.generation?.repliesMax, legacyReplyCount, 1, 8);
    const count = randomInteger(repliesMin, repliesMax);
    const thread = [
        `主帖 @${safeString(post?.handle, 'user')}（${safeString(post?.author, DEFAULT_AUTHOR)}）：${safeString(post?.content)}`,
        ...(post?.comments || []).slice(-16).map(comment => `回帖 @${safeString(comment.handle, 'user')}（${safeString(comment.author, DEFAULT_AUTHOR)}）：${safeString(comment.content)}`),
    ].join('\n');
    const npcLibrary = npcs.length
        ? npcs.filter(npc => !npc.blocked).map(npc => `${formatMemory(npc)}\n人设：${[safeString(npc.persona), safeString(npc.bindingContent)].filter(Boolean).join('\n绑定资料：') || '暂无完整人设'}`).join('\n\n')
        : '暂无固定角色，可自然生成新的论坛用户。';
    const sourceSummary = [
        sourceContext.chat && `故事正文：\n${sourceContext.chat}`,
        sourceContext.userPersona && `User 人设：\n${sourceContext.userPersona}`,
        sourceContext.characterPersona && `Char 人设：\n${sourceContext.characterPersona}`,
        ...(sourceContext.worldInfo || []).map(entry => `世界书《${entry.book}/${entry.title}》：\n${entry.content}`),
    ].filter(Boolean).join('\n\n');
    return {
        system: `${builtinPrompt(settings, 'threadReply')}\n根据帖子上下文，让论坛角色对用户的最新回帖作出自然回应。优先复用已有角色，也可以在必要时出现新的网友。只输出 JSON。`,
        user: `【帖子楼层】\n${thread}\n\n【最新用户回帖】\n@${safeString(userComment?.handle, 'me')}（${safeString(userComment?.author, '我')}）：${safeString(userComment?.content)}\n\n【已有角色人设库】\n${npcLibrary}\n\n${sourceSummary ? `【可读取的酒馆资料】\n${sourceSummary}\n\n` : ''}请生成 ${count} 条后续 AI 回帖。评论需要配图时可填写 imagePrompt，且 imagePrompt 必须只用简体中文，禁止英文；可以给出自然的初始 likes，省略时插件会补值。只输出：{"replies":[{"author":"角色昵称","handle":"账号","content":"回复内容","replyTo":"被回复者账号","imagePrompt":"可选中文画面描述","likes":3}]}`,
        jsonSchema: THREAD_REPLIES_JSON_SCHEMA,
    };
}

export function normalizeThreadReplies(raw, now = Date.now()) {
    const parsed = parseJsonResponse(raw);
    const replies = Array.isArray(parsed) ? parsed : parsed?.replies;
    if (!Array.isArray(replies) || !replies.length) throw new Error('API 没有返回后续回帖');
    return replies.slice(0, 8).map((reply, index) => ({
        id: createId('comment'),
        author: safeString(reply?.author, DEFAULT_AUTHOR),
        handle: safeString(reply?.handle, `user${Math.floor(Math.random() * 9000 + 1000)}`).replace(/^@/, ''),
        content: safeString(reply?.content),
        replyTo: safeString(reply?.replyTo).replace(/^@/, ''),
        parentId: safeString(reply?.parentId),
        mentions: extractMentions(reply?.content),
        likes: generatedEngagement(reply?.likes, stableSocialSeed(`${reply?.handle}|${reply?.content}|${index}`) % 9),
        likedByUser: false,
        imagePrompt: normalizeChineseImagePrompt(reply?.imagePrompt, reply?.content),
        imageUrl: '',
        imageKey: '',
        isAi: true,
        npcId: '',
        createdAt: now + index,
    })).filter(reply => reply.content);
}

export function buildNpcProfileRequest({ npc, evidence = [], sourceContext = {}, settings = {} }) {
    const sources = [
        sourceContext.chat && `最近故事正文：\n${sourceContext.chat}`,
        sourceContext.userPersona && `User 人设：\n${sourceContext.userPersona}`,
        sourceContext.characterPersona && `Char 人设：\n${sourceContext.characterPersona}`,
        ...(sourceContext.worldInfo || []).map(entry => `世界书《${entry.book}/${entry.title}》：\n${entry.content}`),
    ].filter(Boolean).join('\n\n');
    return {
        system: `${builtinPrompt(settings, 'npcProfile')}\n不要提到 AI、模型、提示词或用户。只输出 JSON。`,
        user: `请为论坛角色 @${safeString(npc?.handle)}（${safeString(npc?.name)}）生成主页与人设库。\n\n【该角色的公开发言】\n${evidence.length ? evidence.join('\n') : '暂无发言，请依据名字和故事资料自由生成。'}\n\n${sources ? `【故事资料】\n${sources}\n\n` : ''}只输出：{"bio":"主页简介","location":"所在地","signature":"个性签名","tags":["标签"],"followers":123,"following":45,"followingHandles":["确实有关联的论坛账号"],"persona":"供模型保持一致扮演的详细人设，包括身份、性格、说话方式、立场、已知信息与关系边界","pinnedPost":"主页置顶帖"}`,
        jsonSchema: NPC_PROFILE_JSON_SCHEMA,
    };
}

export function normalizeNpcProfile(raw) {
    const parsed = parseJsonResponse(raw);
    return {
        bio: safeString(parsed?.bio),
        location: safeString(parsed?.location),
        signature: safeString(parsed?.signature),
        tags: Array.isArray(parsed?.tags) ? parsed.tags.map(tag => safeString(tag)).filter(Boolean).slice(0, 10) : [],
        followers: safeInteger(parsed?.followers, 0, 0, 99999999),
        following: safeInteger(parsed?.following, 0, 0, 99999999),
        followingHandles: Array.isArray(parsed?.followingHandles)
            ? parsed.followingHandles.map(handle => safeString(handle).replace(/^@/, '')).filter(Boolean).slice(0, 30)
            : [],
        persona: safeString(parsed?.persona),
        pinnedPost: safeString(parsed?.pinnedPost),
    };
}

export function buildDirectMessageRequest({ conversation, messages = [], npc = null, sourceContext = {}, userName = 'User', settings = {} }) {
    const recent = messages.slice(-30).map(message => `${message.role === 'assistant' ? conversation.name : userName}：${safeString(message.content)}`).join('\n');
    const identity = conversation?.type === 'char'
        ? `你正在扮演当前故事角色“${safeString(conversation?.name, 'Char')}”。请严格保持 Char 人设、故事记忆与说话方式。`
        : `你正在扮演论坛角色“${safeString(conversation?.name, '角色')}”（@${safeString(conversation?.handle, 'role')}）。\n角色人设：${safeString(npc?.persona, '根据其论坛身份和已有发言保持自然一致。')}`;
    const references = [
        sourceContext.characterPersona && `Char 人设与场景：\n${sourceContext.characterPersona}`,
        sourceContext.userPersona && `User 人设：\n${sourceContext.userPersona}`,
        sourceContext.chat && `最近故事正文：\n${sourceContext.chat}`,
        ...(sourceContext.worldInfo || []).map(entry => `世界书《${entry.book}/${entry.title}》：\n${entry.content}`),
    ].filter(Boolean).join('\n\n');
    return {
        system: `${builtinPrompt(settings, 'directMessage')}\n${identity}\n只回复对方最新一条消息，不写旁白、不输出 JSON、不替 User 说话。`,
        user: `${references ? `【可参考资料】\n${references}\n\n` : ''}【私信记录】\n${recent || '暂无记录'}\n\n请以“${safeString(conversation?.name, '联系人')}”的身份直接回复最新消息。`,
    };
}

export function buildRoleDirectMessageRequest({ conversation, messages = [], speaker, otherRole, sourceContext = {}, direction = '', settings = {} }) {
    const recent = messages.slice(-40).map(message => {
        const sender = safeString(message.senderName) || (message.senderNpcId === speaker?.id ? speaker?.name : otherRole?.name);
        return `${sender}：${safeString(message.content)}`;
    }).join('\n');
    const references = [
        sourceContext.characterPersona && `Char 资料：\n${sourceContext.characterPersona}`,
        sourceContext.chat && `两位参与者可知的最近剧情：\n${sourceContext.chat}`,
        ...(sourceContext.worldInfo || []).map(entry => `可知世界书《${entry.book}/${entry.title}》：\n${entry.content}`),
        ...(sourceContext.facts || []).map(fact => `可知事实：${fact.content}`),
    ].filter(Boolean).join('\n\n');
    return {
        system: `${builtinPrompt(settings, 'roleDirectMessage')}\n你正在扮演“${safeString(speaker?.name)}”（@${safeString(speaker?.handle)}），与“${safeString(otherRole?.name)}”进行绝对私密的一对一私信。\n${formatMemory(speaker)}${speaker?.memory?.privateTalks?.length ? `\n该角色自己的私密记忆：${speaker.memory.privateTalks.join('；')}` : ''}\n人设：${safeString(speaker?.persona) || safeString(speaker?.bindingContent, '根据已有资料自然保持一致。')}\n只能使用该角色明确知道的资料和这段私信历史；不得知道第三人的私信，不得把秘密公开，不替另一位角色发言。只输出一条自然私信，不写旁白或 JSON。`,
        user: `${references ? `【允许读取的资料】\n${references}\n\n` : ''}【A-B 私密记录】\n${recent || '暂无记录'}${direction ? `\n\n【用户给本轮的幕后方向（不要逐字复述）】\n${safeString(direction)}` : ''}\n\n请由“${safeString(speaker?.name)}”发送下一条消息。`,
    };
}

export function normalizeDirectMessage(raw) {
    const content = safeString(raw).replace(/^```(?:text)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!content) throw new Error('API 没有返回私信内容');
    return content;
}

export function buildNpcInjection(npcs, options = {}) {
    const selected = Array.isArray(npcs) ? npcs.filter(npc => npc?.inject && (safeString(npc.persona) || safeString(npc.bindingContent))) : [];
    if (!selected.length) return '';
    const content = selected.map(npc => `@${safeString(npc.handle)}（${safeString(npc.name)}）：${[safeString(npc.persona), safeString(npc.bindingContent)].filter(Boolean).join('\n绑定资料：')}${npc.memory ? `\n与 User 关系：${safeString(npc.memory.relationshipToUser, '陌生人')}\n确定知道：${(npc.memory.knownFacts || []).join('；') || '未单独记录'}\n明确不知道：${(npc.memory.unknownFacts || []).join('；') || '未单独记录'}\n对其他角色态度：${(npc.memory.attitudes || []).join('；') || '未单独记录'}` : ''}`).join('\n');
    return applyTemplate(options.template || DEFAULT_BUILTIN_PROMPTS.roleInjection, content);
}

export function prunePosts(posts, maxPosts) {
    const list = Array.isArray(posts) ? posts : [];
    const limit = safeInteger(maxPosts, 100, 1, 5000);
    if (list.length <= limit) return { posts: list, removed: [] };
    const favorites = list.filter(post => post?.favorite);
    const nonFavorites = list.filter(post => !post?.favorite);
    const availableSlots = Math.max(0, limit - favorites.length);
    const keptNonFavorites = nonFavorites.slice(-availableSlots || nonFavorites.length);
    const keepIds = new Set([...favorites, ...keptNonFavorites].map(post => post.id));
    return {
        posts: list.filter(post => keepIds.has(post.id)),
        removed: list.filter(post => !keepIds.has(post.id)),
    };
}
