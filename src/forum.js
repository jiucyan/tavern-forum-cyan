import { createId } from './prompt.js';

function hasOwn(target, key) {
    return Object.prototype.hasOwnProperty.call(target, key);
}

function text(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function handleKey(value) {
    return text(value).replace(/^@/, '').toLocaleLowerCase();
}

const DEFAULT_AVATAR_PALETTES = [
    ['#ff8a65', '#e1306c'], ['#f6c453', '#f77737'], ['#7dd3fc', '#6366f1'], ['#a7f3d0', '#14b8a6'],
    ['#d8b4fe', '#8b5cf6'], ['#fda4af', '#db2777'], ['#93c5fd', '#2563eb'], ['#bef264', '#16a34a'],
];

function seedNumber(value) {
    return Array.from(String(value || 'role')).reduce((sum, char) => ((sum * 31) + char.codePointAt(0)) >>> 0, 2166136261);
}

export function createDefaultAvatarDataUrl(seed = 'role', variant = null) {
    const number = seedNumber(seed);
    const index = Number.isInteger(variant) ? Math.abs(variant) % DEFAULT_AVATAR_PALETTES.length : number % DEFAULT_AVATAR_PALETTES.length;
    const [start, end] = DEFAULT_AVATAR_PALETTES[index];
    const eyes = 18 + (number % 4);
    const mouth = 31 + (number % 5);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><circle cx="32" cy="31" r="20" fill="#fff" fill-opacity=".9"/><circle cx="${eyes}" cy="28" r="2.5" fill="#334155"/><circle cx="${64 - eyes}" cy="28" r="2.5" fill="#334155"/><path d="M23 ${mouth} Q32 ${mouth + 8} 41 ${mouth}" fill="none" stroke="#334155" stroke-width="3" stroke-linecap="round"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const DEFAULT_AVATARS = Object.freeze(DEFAULT_AVATAR_PALETTES.map((_, index) => ({
    id: `default-${index + 1}`,
    name: `默认头像 ${index + 1}`,
    url: createDefaultAvatarDataUrl(`default-${index + 1}`, index),
})));

export function createNpc({ name = '新角色', handle = '', persona = '', inject = false, avatarUrl = '', avatarKey = '', avatarId = '', avatarCustomized = false, backgroundUrl = '', backgroundKey = '', bindingType = 'none', bindingTarget = '', bindingLabel = '', bindingContent = '', systemRole = false } = {}) {
    const normalizedHandle = text(handle, `role${Math.floor(Math.random() * 90000 + 10000)}`).replace(/^@/, '');
    const normalizedName = text(name, '新角色');
    return {
        id: createId('npc'),
        name: normalizedName,
        handle: normalizedHandle,
        bio: '',
        location: '',
        signature: '',
        tags: [],
        followers: 0,
        following: 0,
        persona: text(persona),
        pinnedPost: '',
        avatarUrl: text(avatarUrl, createDefaultAvatarDataUrl(`${normalizedName}:${normalizedHandle}`)),
        avatarKey: text(avatarKey),
        avatarId: text(avatarId),
        avatarCustomized: Boolean(avatarCustomized),
        backgroundUrl: text(backgroundUrl),
        backgroundKey: text(backgroundKey),
        bindingType: ['char', 'world'].includes(bindingType) ? bindingType : 'none',
        bindingTarget: text(bindingTarget),
        bindingLabel: text(bindingLabel),
        bindingContent: text(bindingContent),
        systemRole: Boolean(systemRole),
        followedByUser: false,
        followsUser: false,
        muted: false,
        blocked: false,
        socialState: 'normal',
        memory: {
            relationshipToUser: '陌生人',
            relationshipScore: 0,
            publicHistory: [],
            privateTalks: [],
            knownFacts: [],
            unknownFacts: [],
            attitudes: [],
            notes: '',
        },
        inject: Boolean(inject),
        profileGenerated: false,
        followingHandles: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

export function createConversation({ type = 'npc', targetId = '', name = '新联系人', handle = '', avatarUrl = '', participantIds = [] } = {}) {
    const normalizedType = ['char', 'npc', 'role_dm'].includes(type) ? type : 'npc';
    return {
        id: createId('conversation'),
        type: normalizedType,
        targetId: text(targetId),
        name: text(name, '新联系人'),
        handle: text(handle, 'contact').replace(/^@/, ''),
        avatarUrl: text(avatarUrl),
        avatarKey: '',
        participantIds: normalizedType === 'role_dm' ? [...new Set(participantIds.map(String))].slice(0, 2) : [],
        privateConversation: normalizedType === 'role_dm',
        messages: [],
        unread: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

export function ensureRoleConversation(data, firstNpc, secondNpc) {
    if (!firstNpc || !secondNpc || firstNpc.id === secondNpc.id) return null;
    data.conversations = Array.isArray(data.conversations) ? data.conversations : [];
    const participantIds = [String(firstNpc.id), String(secondNpc.id)].sort();
    let conversation = data.conversations.find(item => item.type === 'role_dm'
        && [...(item.participantIds || [])].map(String).sort().join('|') === participantIds.join('|'));
    if (!conversation) {
        conversation = createConversation({
            type: 'role_dm',
            targetId: participantIds.join('|'),
            participantIds,
            name: `${firstNpc.name} ↔ ${secondNpc.name}`,
            handle: `${firstNpc.handle}_${secondNpc.handle}`,
        });
        data.conversations.unshift(conversation);
    }
    return conversation;
}

export function ensureCharacterConversation(data, snapshot = {}) {
    data.conversations = Array.isArray(data.conversations) ? data.conversations : [];
    const targetId = text(snapshot.characterId, text(snapshot.characterName, 'current-character'));
    let conversation = data.conversations.find(item => item.type === 'char' && item.targetId === targetId);
    if (!conversation) {
        conversation = createConversation({
            type: 'char',
            targetId,
            name: snapshot.characterName || '当前 Char',
            handle: snapshot.characterHandle || 'char',
            avatarUrl: snapshot.characterAvatarUrl || '',
        });
        data.conversations.unshift(conversation);
    } else {
        conversation.name = text(snapshot.characterName, conversation.name);
        conversation.avatarUrl = text(snapshot.characterAvatarUrl, conversation.avatarUrl);
    }
    return conversation;
}

export function ensureNpcConversation(data, npc) {
    if (!npc) return null;
    data.conversations = Array.isArray(data.conversations) ? data.conversations : [];
    let conversation = data.conversations.find(item => item.type === 'npc' && item.targetId === npc.id);
    if (!conversation) {
        conversation = createConversation({ type: 'npc', targetId: npc.id, name: npc.name, handle: npc.handle, avatarUrl: npc.avatarUrl });
        conversation.avatarKey = npc.avatarKey || '';
        data.conversations.unshift(conversation);
    } else {
        conversation.name = npc.name;
        conversation.handle = npc.handle;
        conversation.avatarUrl = npc.avatarUrl || '';
        conversation.avatarKey = npc.avatarKey || '';
    }
    return conversation;
}

export function ensureCharacterRole(data, snapshot = {}) {
    data.npcs = Array.isArray(data.npcs) ? data.npcs : [];
    const targetId = text(snapshot.characterId, text(snapshot.characterName, 'current-character'));
    let npc = data.npcs.find(item => item.bindingType === 'char' && item.bindingTarget === targetId);
    if (!npc) {
        npc = createNpc({
            name: snapshot.characterName || '当前 Char',
            handle: snapshot.characterHandle || 'char',
            avatarUrl: snapshot.characterAvatarUrl || '',
            persona: snapshot.characterPersona || '',
            bindingType: 'char',
            bindingTarget: targetId,
            bindingLabel: snapshot.characterName || '当前 Char',
            bindingContent: snapshot.characterPersona || '',
            systemRole: true,
        });
        data.npcs.unshift(npc);
    } else {
        npc.name = text(snapshot.characterName, npc.name);
        npc.bindingLabel = text(snapshot.characterName, npc.bindingLabel);
        npc.bindingContent = text(snapshot.characterPersona, npc.bindingContent);
        if (snapshot.characterAvatarUrl && !npc.avatarCustomized) npc.avatarUrl = snapshot.characterAvatarUrl;
        npc.systemRole = true;
    }
    return npc;
}

export function normalizeForumDataShape(data) {
    const normalized = data && typeof data === 'object' ? data : {};
    const previousVersion = Number(normalized.version || 0);
    normalized.version = 9;
    normalized.topic = text(normalized.topic, '故事广场');
    normalized.posts = Array.isArray(normalized.posts) ? normalized.posts : [];
    normalized.npcs = Array.isArray(normalized.npcs) ? normalized.npcs : [];
    normalized.conversations = Array.isArray(normalized.conversations) ? normalized.conversations : [];
    normalized.notifications = Array.isArray(normalized.notifications) ? normalized.notifications : [];
    normalized.facts = Array.isArray(normalized.facts) ? normalized.facts : [];
    normalized.lastGenerationTrace = text(normalized.lastGenerationTrace).slice(0, 40000);
    normalized.lastGenerationAt = Math.max(0, Number(normalized.lastGenerationAt || 0));
    normalized.generationLogs = Array.isArray(normalized.generationLogs)
        ? normalized.generationLogs.slice(-20).map(log => ({
            id: text(log?.id) || createId('generation-log'),
            createdAt: Math.max(0, Number(log?.createdAt || Date.now())),
            status: log?.status === 'error' ? 'error' : 'success',
            locallyRepaired: Boolean(log?.locallyRepaired || log?.status === 'recovered'),
            automatic: Boolean(log?.automatic),
            provider: text(log?.provider, 'unknown').slice(0, 80),
            model: text(log?.model, '酒馆当前模型').slice(0, 160),
            postCount: Math.max(0, Number(log?.postCount || 0)),
            reasoning: text(log?.reasoning).slice(0, 20000),
            output: text(log?.output).slice(0, 20000),
            error: text(log?.error).slice(0, 10000),
        }))
        : [];
    normalized.createdAt ||= Date.now();
    normalized.updatedAt ||= Date.now();

    for (const post of normalized.posts) {
        post.id ||= createId('post');
        post.handle = text(post.handle, 'user').replace(/^@/, '');
        post.likes = Math.max(0, Number(post.likes || 0));
        post.reposts = Math.max(0, Number(post.reposts || 0));
        post.favorite = Boolean(post.favorite);
        post.isAi = post.isAi !== false;
        if (previousVersion < 7 && post.isAi) {
            const socialSeed = seedNumber(`${post.handle}|${post.content}`);
            if (post.likes === 0) post.likes = 2 + (socialSeed % (24 + (post.comments?.length || 0) * 5));
            if (post.reposts === 0) post.reposts = (socialSeed >>> 7) % Math.max(2, Math.ceil(post.likes / 4));
        }
        post.npcId ||= '';
        post.mentions = Array.isArray(post.mentions) ? post.mentions.map(String) : [];
        post.repostOf ||= '';
        post.quoteText ||= '';
        post.imagePrompt = text(post.imagePrompt);
        post.imageUrl = text(post.imageUrl);
        post.imageKey = text(post.imageKey);
        if (previousVersion < 9 && post.isAi && !post.imageUrl && !post.imageKey && post.imagePrompt.startsWith('与这篇动态相符的真实现场照片：')) {
            post.imagePrompt = '';
        }
        post.storyRelevance = Math.min(100, Math.max(0, Number(post.storyRelevance || 0)));
        if (post.poll && typeof post.poll === 'object') {
            post.poll.question = text(post.poll.question, '投票');
            post.poll.multiple = Boolean(post.poll.multiple);
            post.poll.closed = Boolean(post.poll.closed);
            post.poll.options = Array.isArray(post.poll.options) ? post.poll.options.map(option => ({
                id: option.id || createId('poll-option'),
                text: text(option.text, '选项'),
                votes: Math.max(0, Number(option.votes || 0)),
                votedByUser: Boolean(option.votedByUser),
            })).slice(0, 10) : [];
            if (post.poll.options.length < 2) post.poll = null;
        } else post.poll = null;
        post.comments = Array.isArray(post.comments) ? post.comments : [];
        for (const comment of post.comments) {
            comment.id ||= createId('comment');
            comment.handle = text(comment.handle, 'user').replace(/^@/, '');
            comment.replyTo ||= '';
            comment.parentId ||= '';
            comment.mentions = Array.isArray(comment.mentions) ? comment.mentions.map(String) : [];
            comment.likes = Math.max(0, Number(comment.likes || 0));
            comment.likedByUser = Boolean(comment.likedByUser);
            comment.imagePrompt = text(comment.imagePrompt);
            comment.imageUrl = text(comment.imageUrl);
            comment.imageKey = text(comment.imageKey);
            comment.npcId ||= '';
            comment.isAi = comment.isAi !== false;
            if (previousVersion < 7 && comment.isAi && comment.likes === 0) {
                comment.likes = seedNumber(`${comment.handle}|${comment.content}`) % 9;
            }
            comment.createdAt ||= post.createdAt || Date.now();
        }
    }

    for (const npc of normalized.npcs) {
        const hadProfileGenerated = hasOwn(npc, 'profileGenerated');
        const defaults = createNpc(npc);
        for (const [key, value] of Object.entries(defaults)) {
            if (!hasOwn(npc, key) || npc[key] === null) npc[key] = value;
        }
        npc.tags = Array.isArray(npc.tags) ? npc.tags : [];
        if (!hadProfileGenerated && text(npc.persona)) npc.profileGenerated = true;
        npc.followingHandles = Array.isArray(npc.followingHandles) ? npc.followingHandles.map(handleKey).filter(Boolean) : [];
        npc.muted = Boolean(npc.muted);
        npc.blocked = Boolean(npc.blocked);
        npc.socialState = ['normal', 'friendly', 'quarrel', 'blocked'].includes(npc.socialState) ? npc.socialState : 'normal';
        if (npc.blocked) npc.socialState = 'blocked';
        const memory = npc.memory && typeof npc.memory === 'object' ? npc.memory : {};
        npc.memory = {
            relationshipToUser: text(memory.relationshipToUser, '陌生人'),
            relationshipScore: Math.min(100, Math.max(-100, Number(memory.relationshipScore || 0))),
            publicHistory: Array.isArray(memory.publicHistory) ? memory.publicHistory.map(String).filter(Boolean) : [],
            privateTalks: Array.isArray(memory.privateTalks) ? memory.privateTalks.map(String).filter(Boolean) : [],
            knownFacts: Array.isArray(memory.knownFacts) ? memory.knownFacts.map(String).filter(Boolean) : [],
            unknownFacts: Array.isArray(memory.unknownFacts) ? memory.unknownFacts.map(String).filter(Boolean) : [],
            attitudes: Array.isArray(memory.attitudes) ? memory.attitudes.map(String).filter(Boolean) : [],
            notes: text(memory.notes),
        };
    }
    for (const conversation of normalized.conversations) {
        const defaults = createConversation(conversation);
        for (const [key, value] of Object.entries(defaults)) {
            if (!hasOwn(conversation, key) || conversation[key] === null) conversation[key] = value;
        }
        conversation.type = ['char', 'npc', 'role_dm'].includes(conversation.type) ? conversation.type : 'npc';
        conversation.participantIds = conversation.type === 'role_dm'
            ? [...new Set((conversation.participantIds || []).map(String))].slice(0, 2)
            : [];
        conversation.privateConversation = conversation.type === 'role_dm';
        conversation.messages = Array.isArray(conversation.messages) ? conversation.messages : [];
        conversation.unread = Number(conversation.unread || 0);
        for (const message of conversation.messages) {
            message.id ||= createId('dm');
            message.role = message.role === 'assistant' ? 'assistant' : 'user';
            message.senderNpcId ||= '';
            message.senderName ||= '';
            message.private = conversation.type === 'role_dm';
            message.content = text(message.content);
            message.createdAt ||= Date.now();
        }
    }
    for (const notification of normalized.notifications) {
        notification.id ||= createId('notification');
        notification.type = ['reply', 'mention', 'like', 'follow', 'mutual', 'system'].includes(notification.type) ? notification.type : 'system';
        notification.actorNpcId ||= '';
        notification.actorName = text(notification.actorName, '微坛');
        notification.postId ||= '';
        notification.content = text(notification.content);
        notification.read = Boolean(notification.read);
        notification.createdAt ||= Date.now();
    }
    for (const fact of normalized.facts) {
        fact.id ||= createId('fact');
        fact.content = text(fact.content);
        fact.visibility = ['public', 'restricted', 'private', 'forbidden'].includes(fact.visibility) ? fact.visibility : 'public';
        fact.knownBy = Array.isArray(fact.knownBy) ? [...new Set(fact.knownBy.map(String))] : [];
        fact.publishable = fact.publishable !== false;
        fact.createdAt ||= Date.now();
        fact.updatedAt ||= fact.createdAt;
    }
    normalized.facts = normalized.facts.filter(fact => fact.content);
    linkNpcAuthors(normalized, normalized.posts, { remember: previousVersion < 5 });
    return normalized;
}

export function advanceSocialEngagement(posts = [], random = Math.random) {
    let likesAdded = 0;
    let repostsAdded = 0;
    let commentLikesAdded = 0;
    for (const post of posts) {
        if (!post || typeof post !== 'object') continue;
        const comments = Array.isArray(post.comments) ? post.comments : [];
        const activity = Math.max(1, Math.min(8, 1 + comments.length + Math.round(Number(post.storyRelevance || 0) / 30)));
        if (random() >= 0.18) {
            const gain = 1 + Math.floor(random() * activity);
            post.likes = Math.max(0, Number(post.likes || 0)) + gain;
            likesAdded += gain;
        }
        if (random() < Math.min(0.48, 0.08 + activity * 0.045)) {
            const gain = 1 + Math.floor(random() * Math.max(1, Math.ceil(activity / 3)));
            post.reposts = Math.max(0, Number(post.reposts || 0)) + gain;
            repostsAdded += gain;
        }
        for (const comment of comments) {
            if (random() < 0.42) continue;
            const gain = 1 + Math.floor(random() * 2);
            comment.likes = Math.max(0, Number(comment.likes || 0)) + gain;
            commentLikesAdded += gain;
        }
    }
    return { likesAdded, repostsAdded, commentLikesAdded };
}

export function connectGeneratedReposts(existingPosts = [], generatedPosts = []) {
    let connected = 0;
    for (const repost of generatedPosts) {
        const requested = text(repost?.repostOf);
        if (!requested) continue;
        const requestedHandle = handleKey(requested);
        const source = existingPosts.find(post => post.id === requested)
            || [...existingPosts].reverse().find(post => handleKey(post.handle) === requestedHandle);
        if (!source) {
            repost.repostOf = '';
            repost.quoteText = '';
            continue;
        }
        repost.repostOf = source.id;
        repost.quoteText ||= `${source.author}：${source.content}`;
        source.reposts = Math.max(0, Number(source.reposts || 0)) + 1;
        connected += 1;
    }
    return connected;
}

export function createNotification({ type = 'system', actorNpcId = '', actorName = '微坛', postId = '', content = '' } = {}) {
    return {
        id: createId('notification'),
        type: ['reply', 'mention', 'like', 'follow', 'mutual', 'system'].includes(type) ? type : 'system',
        actorNpcId: text(actorNpcId),
        actorName: text(actorName, '微坛'),
        postId: text(postId),
        content: text(content),
        read: false,
        createdAt: Date.now(),
    };
}

export function createFact({ content = '', visibility = 'public', knownBy = [], publishable = true } = {}) {
    return {
        id: createId('fact'),
        content: text(content),
        visibility: ['public', 'restricted', 'private', 'forbidden'].includes(visibility) ? visibility : 'public',
        knownBy: [...new Set(knownBy.map(String))],
        publishable: Boolean(publishable),
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

function rememberActivity(npc, prefix, content) {
    const value = `${prefix}：${text(content)}`;
    if (!text(content) || npc.memory.publicHistory.includes(value)) return;
    npc.memory.publicHistory.push(value);
    npc.memory.publicHistory = npc.memory.publicHistory.slice(-80);
}

export function findNpcByAuthor(data, author) {
    if (!data || !Array.isArray(data.npcs) || !author) return null;
    if (author.npcId) {
        const byId = data.npcs.find(npc => npc.id === author.npcId);
        if (byId) return byId;
    }
    const key = handleKey(author.handle);
    return data.npcs.find(npc => (key && handleKey(npc.handle) === key)
        || (!key && text(npc.name) === text(author.author || author.name))) || null;
}

export function ensureNpcForAuthor(data, author) {
    if (!author?.isAi || handleKey(author.handle) === 'me') return null;
    let npc = findNpcByAuthor(data, author);
    if (!npc) {
        npc = createNpc({ name: author.author || author.name, handle: author.handle });
        data.npcs.push(npc);
    }
    author.npcId = npc.id;
    return npc;
}

export function linkNpcAuthors(data, posts = data?.posts || [], { remember = true } = {}) {
    if (!data) return [];
    data.npcs = Array.isArray(data.npcs) ? data.npcs : [];
    const touched = [];
    for (const post of posts) {
        const postNpc = ensureNpcForAuthor(data, post);
        if (postNpc) {
            if (remember) rememberActivity(postNpc, '发帖', post.content);
            touched.push(postNpc);
        }
        for (const comment of post.comments || []) {
            const npc = ensureNpcForAuthor(data, comment);
            if (npc) {
                if (remember) rememberActivity(npc, '回帖', comment.content);
                touched.push(npc);
            }
        }
    }
    return [...new Map(touched.map(npc => [npc.id, npc])).values()];
}

export function collectNpcEvidence(data, npcId) {
    const evidence = [];
    for (const post of data?.posts || []) {
        if (post.npcId === npcId) evidence.push(`主帖：${text(post.content)}`);
        for (const comment of post.comments || []) {
            if (comment.npcId === npcId) evidence.push(`回帖：${text(comment.content)}`);
        }
    }
    return evidence.slice(-40);
}

export function applyNpcProfile(npc, profile) {
    for (const key of ['bio', 'location', 'signature', 'persona', 'pinnedPost']) {
        npc[key] = text(profile?.[key]);
    }
    npc.tags = Array.isArray(profile?.tags) ? profile.tags.map(String) : [];
    npc.followers = Number(profile?.followers || 0);
    npc.following = Number(profile?.following || 0);
    npc.followingHandles = Array.isArray(profile?.followingHandles)
        ? [...new Set(profile.followingHandles.map(handleKey).filter(Boolean))]
        : npc.followingHandles || [];
    npc.profileGenerated = true;
    npc.updatedAt = Date.now();
    return npc;
}
