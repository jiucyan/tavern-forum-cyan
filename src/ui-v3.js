import { generateForumImage, generateForumText, generateForumTextResult } from './api.js';
import {
    buildDirectMessageRequest,
    buildForumGenerationRequest,
    buildNpcProfileRequest,
    buildRoleDirectMessageRequest,
    buildThreadReplyRequest,
    createId,
    createManualComment,
    createManualPost,
    extractMentions,
    normalizeDirectMessage,
    normalizeGeneratedForum,
    normalizeNpcProfile,
    normalizeThreadReplies,
    prunePosts,
    recoverGeneratedForum,
} from './prompt.js';
import {
    advanceSocialEngagement,
    applyNpcProfile,
    collectNpcEvidence,
    connectGeneratedReposts,
    createNpc,
    createFact,
    createNotification,
    createDefaultAvatarDataUrl,
    DEFAULT_AVATARS,
    ensureCharacterConversation,
    ensureCharacterRole,
    ensureNpcConversation,
    ensureRoleConversation,
    linkNpcAuthors,
} from './forum.js';
import {
    clearAllData,
    createApiProfile,
    deleteApiProfile,
    getActiveApiProfile,
    getApiConfig,
    getCharacterCatalog,
    getChatSnapshot,
    getForumData,
    getGenerationSourceContext,
    getRoleScopedSourceContext,
    getSettings,
    getSillyTavernPresetCatalog,
    getWorldInfoCatalog,
    hasActiveChat,
    renameApiProfile,
    saveForumData,
    saveSettings,
    setActiveApiProfile,
    setRememberApiKeys,
    setSessionApiKey,
    syncInjection,
    updateApiConfig,
} from './store.js';

const ROOT_ID = 'tavern-forum-root';
const FAB_ID = 'tavern-forum-fab';
const MENU_ID = 'tavern-forum-menu-item';
const SETTINGS_BLOCK_ID = 'tavern-forum-settings-block';
const CUSTOM_STYLE_ID = 'tavern-forum-custom-css';
const BUILTIN_CUSTOM_CSS_TEMPLATE = `/*
 * 微坛标准 CSS 美化模板
 * 可以直接修改数值；所有选择器都限制在论坛内部，不会修改酒馆界面。
 */

/* 1. 全局尺寸与圆角 */
#tavern-forum-root {
    --tf-user-radius: 18px;
    --tf-user-shadow: 0 10px 34px rgb(15 23 42 / 8%);
    --tf-user-post-gap: 18px;
}

/* 2. 顶部导航 */
#tavern-forum-root .tf-topbar,
#tavern-forum-root .tf-mobile-main-nav {
    box-shadow: none;
}
#tavern-forum-root .tf-main-nav button,
#tavern-forum-root .tf-mobile-main-nav button {
    border-radius: 12px;
}

/* 3. 首页信息流 */
#tavern-forum-root .tf-feed-list {
    gap: var(--tf-user-post-gap);
}
#tavern-forum-root .tf-feed-tabs,
#tavern-forum-root .tf-stories {
    border-radius: var(--tf-user-radius);
}

/* 4. 帖子磨砂玻璃卡片 */
#tavern-forum-root .tf-post {
    border-radius: var(--tf-user-radius);
    box-shadow: var(--tf-user-shadow);
}
#tavern-forum-root .tf-post-caption {
    line-height: 1.8;
}

/* 5. 评论区域与楼中楼 */
#tavern-forum-root .tf-comments {
    border-radius: 0 0 var(--tf-user-radius) var(--tf-user-radius);
}
#tavern-forum-root .tf-comment {
    line-height: 1.65;
}

/* 6. 头像 */
#tavern-forum-root .tf-avatar {
    box-shadow: 0 0 0 2px rgb(255 255 255 / 78%);
}

/* 7. 帖子和评论图片 */
#tavern-forum-root .tf-post-image {
    max-height: 680px;
    object-fit: cover;
}
#tavern-forum-root .tf-comment-image {
    border-radius: 14px;
}

/* 8. 用户与角色主页 */
#tavern-forum-root .tf-public-profile-hero,
#tavern-forum-root .tf-personal-profile {
    border-radius: var(--tf-user-radius);
}

/* 9. 私信 */
#tavern-forum-root .tf-dm-bubble {
    border-radius: 18px;
}
#tavern-forum-root .tf-dm-bubble.is-me {
    border-bottom-right-radius: 6px;
}
#tavern-forum-root .tf-dm-bubble.is-them {
    border-bottom-left-radius: 6px;
}

/* 10. 设置页（不使用帖子透明度） */
#tavern-forum-root .tf-settings-card,
#tavern-forum-root .tf-dashboard-grid > button {
    border-radius: var(--tf-user-radius);
}

/* 11. 手机端：自动缩小间距 */
@media (max-width: 680px) {
    #tavern-forum-root {
        --tf-user-radius: 14px;
        --tf-user-post-gap: 10px;
    }
}`;
const imageMemory = new Map();

const viewState = {
    open: false,
    initialized: false,
    busy: false,
    composerOpen: false,
    imageBusy: new Set(),
    replyingPosts: new Set(),
    npcBusy: new Set(),
    dmBusy: false,
    expandedComments: new Set(),
    replyTarget: null,
    selectedNpcId: '',
    publicNpcId: '',
    selectedPostId: '',
    selectedConversationId: '',
    selectedMemoryNpcId: '',
    mobileDmChat: false,
    messageMode: 'dm',
    worldCatalog: [],
    worldLoading: false,
    searchQuery: '',
    autoRefreshTimer: 0,
    pendingNpcAvatarId: '',
    pendingNpcBackgroundId: '',
    feedMode: 'recommended',
    selectedTopic: '',
    composerPoll: null,
    openPostMenuId: '',
    openPostImageEditorId: '',
    injectionTokens: { total: 0, forum: 0, roles: 0, loading: false },
};

const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    message: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9.7 9.7 0 0 1-3.7-.8L3 21l1.7-4.7A8.2 8.2 0 0 1 3 11.5a8.4 8.4 0 0 1 9-8.5 8.4 8.4 0 0 1 9 8.5Z"/><path d="m8.5 12 2.2 2 4.8-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    heart: '<path d="M20.8 5.8a5.5 5.5 0 0 0-7.8 0L12 6.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z"/>',
    comment: '<path d="M21 11.5a8.5 8.5 0 0 1-9 8.5 9.5 9.5 0 0 1-4-.9L3 21l1.8-4.7A8 8 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z"/>',
    send: '<path d="m22 2-9 20-3.5-8.5L2 10z"/><path d="M22 2 9.5 13.5"/>',
    bookmark: '<path d="M6 3h12v19l-6-4-6 4z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
    shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    sparkles: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7zM5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8z"/>',
    refresh: '<path d="M20 6v5h-5M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9m16 6-2 2.5A7 7 0 0 1 5.5 15"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h4a5 5 0 0 0 0-10z"/><circle cx="7.5" cy="10" r="1"/><circle cx="9" cy="6.5" r="1"/><circle cx="14" cy="6.5" r="1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4zM20 4h-4a3 3 0 0 0-3 3v14a3 3 0 0 1 3-3h4z"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    repost: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
};

function icon(name, className = '') {
    return `<svg class="tf-icon ${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.settings}</svg>`;
}

function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function buildGenerationTrace(text, reasoning = '') {
    const sections = [];
    if (String(reasoning || '').trim()) sections.push(`【模型返回的推理记录】\n${String(reasoning).trim()}`);
    if (String(text || '').trim()) sections.push(`【模型原始输出】\n${String(text).trim()}`);
    return sections.join('\n\n').slice(0, 40000);
}

function appendGenerationLog(data, log) {
    data.generationLogs ||= [];
    const entry = {
        id: createId('generation-log'),
        createdAt: Date.now(),
        status: log.status || 'error',
        locallyRepaired: Boolean(log.locallyRepaired),
        automatic: Boolean(log.automatic),
        provider: String(log.provider || 'unknown').slice(0, 80),
        model: String(log.model || '酒馆当前模型').slice(0, 160),
        postCount: Math.max(0, Number(log.postCount || 0)),
        reasoning: String(log.reasoning || '').slice(0, 20000),
        output: String(log.output || '').slice(0, 20000),
        error: String(log.error || '').slice(0, 10000),
    };
    data.generationLogs.push(entry);
    if (data.generationLogs.length > 20) data.generationLogs.splice(0, data.generationLogs.length - 20);
    return entry;
}

function renderSocialText(value) {
    return escapeHtml(value).replace(/@([\w\u4e00-\u9fff.-]{1,32})/gu, '<span class="tf-mention">@$1</span>');
}

function isMyHandle(handle) {
    const profile = getSettings().profile;
    const normalized = String(handle || '').replace(/^@/, '').toLocaleLowerCase();
    return normalized === 'me' || normalized === String(profile.handle || 'me').replace(/^@/, '').toLocaleLowerCase();
}

function notify(type, message) {
    if (globalThis.toastr?.[type]) globalThis.toastr[type](message);
    else console[type === 'error' ? 'error' : 'log'](`[微坛] ${message}`);
}

function getRoot() {
    return document.getElementById(ROOT_ID);
}

function isSafeImageUrl(value) {
    return /^(https?:\/\/|data:image\/)/i.test(String(value || ''));
}

function initials(name) {
    return escapeHtml(Array.from(String(name || '匿').trim())[0] || '匿');
}

function avatarHue(name) {
    return Array.from(String(name || '')).reduce((sum, char) => sum + char.codePointAt(0), 0) % 360;
}

function formatTime(timestamp) {
    const diff = Math.max(0, Date.now() - Number(timestamp || Date.now()));
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function numberLabel(value) {
    const number = Number(value || 0);
    if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`;
    return String(number);
}

function renderSwitch({ checked, action, label, disabled = false, dataset = {} }) {
    const dataAttributes = Object.entries(dataset).map(([key, value]) => ` data-${String(key).replace(/[A-Z]/g, match => `-${match.toLocaleLowerCase()}`)}="${escapeHtml(value)}"`).join('');
    return `<label class="tf-switch ${disabled ? 'is-disabled' : ''}"><input type="checkbox" data-action="${escapeHtml(action)}"${dataAttributes} ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="tf-switch-track"><i></i></span>${label ? `<span>${escapeHtml(label)}</span>` : ''}</label>`;
}

function npcForId(npcId) {
    return npcId ? getForumData().npcs.find(npc => npc.id === npcId) : null;
}

function npcForAuthor(author) {
    const data = getForumData();
    const byId = npcForId(author?.npcId);
    if (byId) return byId;
    const handle = String(author?.handle || '').replace(/^@/, '').trim().toLocaleLowerCase();
    if (handle) {
        const byHandle = data.npcs.find(npc => String(npc.handle || '').replace(/^@/, '').trim().toLocaleLowerCase() === handle);
        if (byHandle) return byHandle;
    }
    const name = String(author?.author || author?.name || '').trim();
    return name ? data.npcs.find(npc => String(npc.name || '').trim() === name) || null : null;
}

function isRoleLibraryMember(npc) {
    return Boolean(npc && (npc.systemRole || npc.profileGenerated));
}

function getRoleLibrary(data = getForumData()) {
    return (data.npcs || []).filter(isRoleLibraryMember);
}

function renderStoredImage({ url = '', imageKey = '', alt = '', className = '' } = {}) {
    if (imageKey) {
        const value = imageMemory.get(imageKey);
        return `<img class="${escapeHtml(className)}" ${value ? `src="${escapeHtml(value)}"` : `data-image-key="${escapeHtml(imageKey)}"`} alt="${escapeHtml(alt)}">`;
    }
    return isSafeImageUrl(url) ? `<img class="${escapeHtml(className)}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">` : '';
}

function renderAvatar(name, { large = false, npcId = '', avatarUrl = '', avatarKey = '', action = '' } = {}) {
    const npc = npcForId(npcId);
    const url = avatarUrl || npc?.avatarUrl || '';
    const imageKey = avatarKey || npc?.avatarKey || '';
    const clickable = Boolean(action || npcId);
    const tag = clickable ? 'button' : 'span';
    const clickAction = action || (npcId ? 'open-npc' : '');
    const attrs = clickable ? `type="button" data-action="${clickAction}" ${npcId ? `data-npc-id="${escapeHtml(npcId)}"` : ''}` : '';
    const content = renderStoredImage({ url, imageKey, alt: name }) || initials(name);
    return `<${tag} class="tf-avatar ${large ? 'tf-avatar-large' : ''} ${clickable ? 'is-clickable' : ''}" style="--tf-avatar-hue:${avatarHue(name)}" ${attrs}>${content}</${tag}>`;
}

function renderAuthorAvatar(author, { large = false } = {}) {
    if (author?.npcId) return renderAvatar(author.author || author.name, { large, npcId: author.npcId });
    const profile = getSettings().profile;
    const authorHandle = String(author?.handle || '').replace(/^@/, '');
    if (authorHandle === 'me' || authorHandle === String(profile.handle || 'me').replace(/^@/, '')) {
        return renderAvatar(author.author || author.name, { large, avatarUrl: profile.avatarUrl, avatarKey: profile.avatarKey, action: 'open-my-profile' });
    }
    return renderAvatar(author?.author || author?.name, { large, avatarUrl: createDefaultAvatarDataUrl(author?.handle || author?.author || author?.name) });
}

function hasRealImage(post) {
    return Boolean((post.imageUrl && isSafeImageUrl(post.imageUrl)) || post.imageKey);
}

function hasUsableImageApi(config = getApiConfig('image')) {
    return Boolean(config.enabled && String(config.endpoint || '').trim() && String(config.model || '').trim());
}

function usesTextImage(post, config = getApiConfig('image')) {
    return !hasRealImage(post) && Boolean(String(post.imagePrompt || '').trim()) && Boolean(config.textFallback);
}

function localizedImagePrompt(item) {
    const prompt = String(item?.imagePrompt || '').trim();
    if (!prompt || /[\u3400-\u9fff]/u.test(prompt)) return prompt;
    const content = String(item?.content || '').replace(/\s+/g, ' ').trim();
    return /[\u3400-\u9fff]/u.test(content)
        ? `与这条动态有关的场景：${content.slice(0, 100)}`
        : '一幅与这条动态内容有关的场景画面。';
}

function renderPostImage(post) {
    if (post.imageUrl && isSafeImageUrl(post.imageUrl)) return `<img class="tf-post-image" src="${escapeHtml(post.imageUrl)}" alt="帖子配图" loading="lazy">`;
    if (post.imageKey) {
        const memoryValue = imageMemory.get(post.imageKey);
        if (memoryValue) return `<img class="tf-post-image" src="${escapeHtml(memoryValue)}" alt="帖子配图" loading="lazy">`;
        return `<div class="tf-image-loading"><span class="tf-spinner"></span><span>正在读取图片</span><img data-image-key="${escapeHtml(post.imageKey)}" alt="帖子配图"></div>`;
    }
    if (usesTextImage(post)) return `<figure class="tf-text-image"><p>${escapeHtml(localizedImagePrompt(post))}</p></figure>`;
    return '';
}

function renderCommentImage(comment) {
    if (comment.imageUrl && isSafeImageUrl(comment.imageUrl)) return `<img class="tf-comment-image" src="${escapeHtml(comment.imageUrl)}" alt="评论配图" loading="lazy">`;
    if (comment.imageKey) {
        const memoryValue = imageMemory.get(comment.imageKey);
        if (memoryValue) return `<img class="tf-comment-image" src="${escapeHtml(memoryValue)}" alt="评论配图" loading="lazy">`;
        return `<span class="tf-image-loading tf-comment-image-loading"><span class="tf-spinner"></span><img data-image-key="${escapeHtml(comment.imageKey)}" alt="评论配图"></span>`;
    }
    if (usesTextImage(comment)) return `<figure class="tf-comment-text-image"><p>${escapeHtml(localizedImagePrompt(comment))}</p></figure>`;
    return '';
}

function renderComments(post, forceOpen = false) {
    if (!forceOpen && !viewState.expandedComments.has(post.id)) return '';
    const comments = (Array.isArray(post.comments) ? post.comments : []).filter(comment => {
        const npc = npcForAuthor(comment);
        return !npc?.muted && !npc?.blocked;
    });
    const target = viewState.replyTarget?.postId === post.id ? viewState.replyTarget : null;
    const snapshot = getChatSnapshot();
    const profile = getSettings().profile;
    const replying = viewState.replyingPosts.has(post.id);
    const ids = new Set(comments.map(comment => comment.id));
    const renderBranch = (parentId = '', depth = 0) => comments
        .filter(comment => (comment.parentId && ids.has(comment.parentId) ? comment.parentId : '') === parentId)
        .map(comment => `<div class="tf-comment ${depth ? 'is-nested' : ''}" style="--tf-comment-depth:${Math.min(depth, 3)}">
            ${renderAuthorAvatar(comment)}
            <div><p><b>${escapeHtml(comment.author)}</b>${comment.replyTo ? `<span> 回复 @${escapeHtml(comment.replyTo)}</span>` : ''} ${renderSocialText(comment.content)}</p>${renderCommentImage(comment)}<div class="tf-comment-actions"><button data-action="start-reply" data-post-id="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(comment.id)}" data-reply-handle="${escapeHtml(comment.handle || '')}">回复</button><button class="${comment.likedByUser ? 'is-liked' : ''}" data-action="like-comment" data-post-id="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(comment.id)}">${icon('heart')} ${numberLabel(comment.likes)}</button><button data-action="generate-comment-image" data-post-id="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(comment.id)}" title="${comment.imageUrl || comment.imageKey ? '更换评论配图' : '添加评论配图'}">${viewState.imageBusy.has(`comment-${comment.id}`) ? '<span class="tf-spinner"></span>' : icon('image')}</button></div>${renderBranch(comment.id, depth + 1)}</div>
        </div>`).join('');
    return `<section class="tf-comments">
        ${comments.length ? renderBranch() : '<p class="tf-empty-mini">还没有评论</p>'}
        <div class="tf-reply-composer">
            ${target ? `<div class="tf-reply-context">回复 @${escapeHtml(target.handle)}</div>` : ''}
            <input class="tf-reply-author" value="${escapeHtml(profile.displayName || snapshot.names.user || '我')}" hidden><input class="tf-reply-handle" value="${escapeHtml(profile.handle || 'me')}" hidden>
            <textarea class="tf-reply-content" rows="2" maxlength="1500" placeholder="写下评论…"></textarea>
            <details class="tf-reply-image-options"><summary>${icon('image')}<span>添加图片</span></summary><div><input class="tf-reply-image-prompt" maxlength="500" placeholder="描述评论配图；没有生图 API 时显示为文字配图"></div></details>
            <button class="tf-circle-button" data-action="submit-reply" data-post-id="${escapeHtml(post.id)}" ${replying ? 'disabled' : ''} title="发布评论">${replying ? '<span class="tf-spinner"></span>' : icon('send')}</button>
        </div>
    </section>`;
}

function postSearchText(post) {
    return [post.author, post.handle, post.content, post.quoteText, ...(post.tags || []), ...(post.comments || []).flatMap(comment => [comment.author, comment.handle, comment.content])].join(' ').toLocaleLowerCase();
}

function renderPostImageEditor(post) {
    if (viewState.openPostImageEditorId !== post.id) return '';
    const buttonLabel = hasUsableImageApi() ? '生成图片' : '显示文字配图';
    return `<div class="tf-post-image-editor"><div>${icon('image')}<input class="tf-post-image-prompt-input" maxlength="500" value="${escapeHtml(post.imagePrompt || '')}" placeholder="描述这篇帖子的配图画面"></div><button class="tf-primary-button" data-action="save-post-image-prompt" data-post-id="${escapeHtml(post.id)}">${buttonLabel}</button><button class="tf-text-button" data-action="toggle-post-image-editor" data-post-id="${escapeHtml(post.id)}">取消</button></div>`;
}

function renderPost(post, { detail = false } = {}) {
    const injecting = Boolean(post.selectedForInjection);
    const imageBusy = viewState.imageBusy.has(post.id);
    const commentsCount = Array.isArray(post.comments) ? post.comments.filter(comment => {
        const npc = npcForAuthor(comment);
        return !npc?.muted && !npc?.blocked;
    }).length : 0;
    const authorHeader = post.npcId
        ? `<button class="tf-post-author" data-action="open-npc" data-npc-id="${escapeHtml(post.npcId)}"><b>${escapeHtml(post.author)}</b><span>@${escapeHtml(post.handle || 'user')} · ${formatTime(post.createdAt)}</span></button>`
        : isMyHandle(post.handle)
            ? `<button class="tf-post-author" data-action="open-my-profile"><b>${escapeHtml(post.author)}</b><span>@${escapeHtml(post.handle || 'me')} · ${formatTime(post.createdAt)}</span></button>`
            : `<div><b>${escapeHtml(post.author)}</b><span>@${escapeHtml(post.handle || 'user')} · ${formatTime(post.createdAt)}</span></div>`;
    const authorNpc = post.npcId ? npcForId(post.npcId) : null;
    const moderationItems = authorNpc ? `<hr><button data-action="toggle-role-muted" data-npc-id="${escapeHtml(authorNpc.id)}">${icon('message')}<span>${authorNpc.muted ? '取消静音该角色' : '静音该角色'}</span></button><button class="${authorNpc.blocked ? '' : 'is-danger'}" data-action="toggle-role-blocked" data-npc-id="${escapeHtml(authorNpc.id)}">${icon('lock')}<span>${authorNpc.blocked ? '解除拉黑' : '拉黑该角色'}</span></button>` : '';
    const imageMarkup = renderPostImage(post);
    const captionMarkup = `<div class="tf-post-caption"><p><b>${escapeHtml(post.author)}</b> ${renderSocialText(post.content)}</p>${(post.tags || []).length ? `<div class="tf-tags">${post.tags.map(tag => `<button data-action="topic-search" data-topic="${escapeHtml(String(tag).replace(/^#/, ''))}">#${escapeHtml(String(tag).replace(/^#/, ''))}</button>`).join('')}</div>` : ''}</div>`;
    return `<article class="tf-post tf-card" data-post-id="${escapeHtml(post.id)}" data-search-text="${escapeHtml(postSearchText(post))}">
        <header class="tf-post-header">
            ${renderAuthorAvatar(post)}
            ${authorHeader}
            <div class="tf-post-menu-wrap"><button class="tf-icon-button" data-action="toggle-post-menu" data-post-id="${escapeHtml(post.id)}" title="帖子菜单">${icon('more')}</button>${viewState.openPostMenuId === post.id ? `<div class="tf-post-menu"><button data-action="toggle-post-injection" data-post-id="${escapeHtml(post.id)}">${icon('shield')}<span>${injecting ? '停止注入这篇帖子' : '将这篇帖子注入正文'}</span><i class="${injecting ? 'is-on' : ''}"></i></button><button data-action="favorite-post" data-post-id="${escapeHtml(post.id)}">${icon('bookmark')}<span>${post.favorite ? '取消收藏' : '收藏帖子'}</span></button>${moderationItems}<button class="is-danger" data-action="delete-post" data-post-id="${escapeHtml(post.id)}">${icon('trash')}<span>删除帖子</span></button></div>` : ''}</div>
        </header>
        ${captionMarkup}
        ${post.repostOf ? `<div class="tf-repost-label">${icon('repost')} 转发 / 引用了一篇帖子</div>` : ''}
        ${post.quoteText ? `<blockquote class="tf-quote-post">${renderSocialText(post.quoteText)}</blockquote>` : ''}
        ${post.poll ? `<section class="tf-poll"><b>${escapeHtml(post.poll.question)}</b>${post.poll.options.map(option => `<button class="${option.votedByUser ? 'is-selected' : ''}" data-action="vote-poll" data-post-id="${escapeHtml(post.id)}" data-option-id="${escapeHtml(option.id)}" ${post.poll.closed ? 'disabled' : ''}><span>${escapeHtml(option.text)}</span><em>${numberLabel(option.votes)} 票</em></button>`).join('')}</section>` : ''}
        ${imageMarkup}
        <div class="tf-post-actions">
            <button class="${post.likedByUser ? 'is-liked' : ''}" data-action="like-post" data-post-id="${escapeHtml(post.id)}" title="点赞">${icon('heart')}<span>${numberLabel(post.likes)}</span></button>
            <button data-action="open-post" data-post-id="${escapeHtml(post.id)}" title="打开完整帖子">${icon('comment')}<span>${commentsCount}</span></button>
            <button data-action="quote-post" data-post-id="${escapeHtml(post.id)}" title="转发或引用">${icon('repost')}<span>${numberLabel(post.reposts)}</span></button>
            <button data-action="toggle-post-image-editor" data-post-id="${escapeHtml(post.id)}" ${imageBusy ? 'disabled' : ''} title="${hasRealImage(post) || post.imagePrompt ? '管理配图' : '添加配图'}">${imageBusy ? '<span class="tf-spinner"></span>' : icon('image')}</button>
        </div>
        ${renderPostImageEditor(post)}
        ${!detail && commentsCount ? `<button class="tf-view-comments" data-action="open-post" data-post-id="${escapeHtml(post.id)}">查看全部 ${commentsCount} 条评论</button>` : ''}
        ${renderComments(post, detail)}
    </article>`;
}

function renderPostDetail(data, post) {
    if (!post) return `<section class="tf-detail-page"><header><button class="tf-back-button" data-action="back-post">${icon('chevron')}返回</button><h2>帖子不存在</h2></header></section>`;
    return `<section class="tf-detail-page"><header class="tf-detail-header"><button class="tf-back-button" data-action="back-post">${icon('chevron')}返回</button><div><h2>帖子</h2><p>@${escapeHtml(post.handle || 'user')}</p></div></header><div class="tf-detail-post">${renderPost(post, { detail: true })}</div></section>`;
}

function renderComposer() {
    const snapshot = getChatSnapshot();
    const profile = getSettings().profile;
    const name = profile.displayName || snapshot.names.user || '我';
    const avatar = renderAvatar(name, { avatarUrl: profile.avatarUrl, avatarKey: profile.avatarKey });
    if (!viewState.composerOpen) return `<button class="tf-compose-collapsed tf-card" data-action="toggle-composer">${avatar}<span>分享故事世界里的新鲜事…</span>${icon('plus')}</button>`;
    const poll = viewState.composerPoll;
    return `<section class="tf-composer tf-card"><header>${avatar}<b>发布新帖子</b></header><input id="tf-compose-author" value="${escapeHtml(name)}" hidden><input id="tf-compose-handle" value="${escapeHtml(profile.handle || 'me')}" hidden><textarea id="tf-compose-content" rows="4" maxlength="2000" placeholder="写下帖子内容；可以使用 @账号 提及角色…"></textarea><input id="tf-compose-tags" placeholder="话题标签（用逗号分隔）">${poll ? `<div class="tf-compose-poll"><b>${escapeHtml(poll.question)}</b><span>${poll.options.map(option => escapeHtml(option)).join(' · ')}</span><button data-action="remove-composer-poll">移除</button></div>` : ''}<footer><button class="tf-secondary-button" data-action="add-composer-poll">${icon('plus')}投票</button><span></span><button class="tf-text-button" data-action="toggle-composer">取消</button><button class="tf-primary-button" data-action="publish-manual">发布</button></footer></section>`;
}

function renderStories(data) {
    const snapshot = getChatSnapshot();
    const roles = data.npcs.filter(npc => !(npc.bindingType === 'char' && npc.bindingTarget === snapshot.characterId)).slice(0, 11);
    const people = [{ id: '', name: snapshot.characterName, avatarUrl: snapshot.characterAvatarUrl, isChar: true }, ...roles];
    return `<section class="tf-stories tf-card">${people.map(person => `<button data-action="${person.isChar ? 'open-char-dm' : 'open-npc'}" ${person.id ? `data-npc-id="${escapeHtml(person.id)}"` : ''}>${renderAvatar(person.name, { avatarUrl: person.avatarUrl, avatarKey: person.avatarKey })}<span>${escapeHtml(person.name)}</span></button>`).join('')}</section>`;
}

function getFeedPosts(data) {
    const normalizeHandle = value => String(value || '').replace(/^@/, '').trim().toLocaleLowerCase();
    const normalizeName = value => String(value || '').trim().toLocaleLowerCase();
    const roleMatchesPost = (npc, post) => (post.npcId && npc.id === post.npcId)
        || (normalizeHandle(npc.handle) && normalizeHandle(npc.handle) === normalizeHandle(post.handle))
        || (normalizeName(npc.name) && normalizeName(npc.name) === normalizeName(post.author));
    const roleForPost = post => data.npcs.find(npc => npc.id === post.npcId)
        || data.npcs.find(npc => normalizeHandle(npc.handle) && normalizeHandle(npc.handle) === normalizeHandle(post.handle))
        || data.npcs.find(npc => normalizeName(npc.name) && normalizeName(npc.name) === normalizeName(post.author));
    const visible = data.posts.filter(post => {
        const npc = roleForPost(post);
        return !npc?.muted && !npc?.blocked && (!viewState.selectedTopic || (post.tags || []).some(tag => String(tag).toLocaleLowerCase() === viewState.selectedTopic.toLocaleLowerCase()));
    });
    if (viewState.feedMode === 'following') return visible.filter(post => isMyHandle(post.handle) || data.npcs.some(npc => npc.followedByUser && roleMatchesPost(npc, post))).sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    if (viewState.feedMode === 'latest') return visible.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    if (viewState.feedMode === 'hot') return visible.sort((a, b) => ((Number(b.likes) + (b.comments?.length || 0) * 4 + Number(b.reposts) * 3 + Number(b.storyRelevance || 0)) - (Number(a.likes) + (a.comments?.length || 0) * 4 + Number(a.reposts) * 3 + Number(a.storyRelevance || 0))));
    return visible.sort((a, b) => {
        const score = post => {
            const npc = roleForPost(post);
            return Number(post.storyRelevance || 0) + Number(npc?.memory?.relationshipScore || 0) + (npc?.followedByUser ? 45 : 0) + (post.tags?.length || 0) * 3 + Number(post.createdAt || 0) / 1e12;
        };
        return score(b) - score(a);
    });
}

function renderHome(data) {
    const active = hasActiveChat();
    const posts = getFeedPosts(data);
    const feeds = [['following', '关注'], ['recommended', '推荐'], ['latest', '最新'], ['hot', '热门']];
    return `<div class="tf-home-page"><div class="tf-feed-column">
        <section class="tf-feed-heading"><div><h1>${escapeHtml(data.topic || '故事动态')}</h1><p>${active ? `${escapeHtml(getChatSnapshot().characterName)} · 当前聊天专属社区` : '请先打开一个角色聊天'}</p></div><button class="tf-primary-button" data-action="generate-posts" ${viewState.busy || !active ? 'disabled' : ''}>${viewState.busy ? '<span class="tf-spinner"></span>' : icon('sparkles')}<span>${viewState.busy ? '刷新中' : '刷新'}</span></button></section>
        ${renderStories(data)}<nav class="tf-feed-tabs">${feeds.map(([id, label]) => `<button class="${viewState.feedMode === id ? 'is-active' : ''}" data-action="feed-mode" data-feed="${id}">${label}</button>`).join('')}</nav>${viewState.selectedTopic ? `<section class="tf-topic-header tf-card"><div><small>话题详情</small><h2>#${escapeHtml(viewState.selectedTopic)}</h2><p>${posts.length} 篇相关帖子</p></div><button class="tf-secondary-button" data-action="clear-topic">返回全部</button></section>` : ''}${renderComposer()}
        <div class="tf-search-result" ${viewState.searchQuery ? '' : 'hidden'}>搜索结果：<b data-search-count>0</b> 篇帖子</div>
        <div class="tf-feed-list">${viewState.busy ? '<div class="tf-card tf-skeleton"><i></i><p></p><p></p></div>' : ''}${posts.length ? posts.map(renderPost).join('') : '<section class="tf-card tf-empty"><div class="tf-empty-icon">'+icon('image')+'</div><h3>这里还没有动态</h3><p>可以切换信息流，或关注更多角色。</p></section>'}</div>
    </div></div>`;
}

function prepareConversations(data) {
    if (!hasActiveChat()) return null;
    const before = data.conversations.length;
    const conversation = ensureCharacterConversation(data, getChatSnapshot());
    if (data.conversations.length !== before) void saveForumData(data);
    if (!viewState.selectedConversationId) viewState.selectedConversationId = conversation.id;
    return conversation;
}

function getConversationProfileNpc(data, conversation) {
    if (!conversation || conversation.type === 'role_dm') return null;
    if (conversation.type === 'npc') return data.npcs.find(npc => npc.id === conversation.targetId) || null;
    if (conversation.type === 'char') {
        return data.npcs.find(npc => npc.bindingType === 'char' && npc.bindingTarget === conversation.targetId)
            || ensureCharacterRole(data, getChatSnapshot());
    }
    return null;
}

function isConversationAllowed(data, conversation) {
    if (!conversation) return false;
    if (conversation.type === 'role_dm') {
        return (conversation.participantIds || []).every(id => !data.npcs.find(npc => npc.id === id)?.blocked);
    }
    return !getConversationProfileNpc(data, conversation)?.blocked;
}

function renderConversationList(data) {
    const conversations = [...data.conversations].filter(conversation => isConversationAllowed(data, conversation)).sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
    const roleDmEnabled = getSettings().social.roleDirectMessages;
    const availableRoles = getRoleLibrary(data).filter(npc => !npc.systemRole && !npc.blocked && !data.conversations.some(item => item.type === 'npc' && item.targetId === npc.id));
    return `<aside class="tf-dm-list"><header><h2>消息</h2><div><button class="tf-icon-button" data-action="new-dm-npc" title="新建用户与角色私信">${icon('plus')}</button><button class="tf-icon-button" data-action="new-role-dm" title="新建角色之间私信" ${roleDmEnabled ? '' : 'disabled'}>${icon('users')}</button></div></header><div class="tf-dm-contacts">${conversations.map(conversation => {
        const last = conversation.messages.at(-1);
        return `<button class="tf-dm-contact ${conversation.id === viewState.selectedConversationId ? 'is-active' : ''}" data-action="open-conversation" data-conversation-id="${escapeHtml(conversation.id)}" data-contact-search="${escapeHtml(`${conversation.name} ${conversation.handle}`.toLocaleLowerCase())}">${conversation.type === 'role_dm' ? `<span class="tf-private-avatar">${icon('lock')}</span>` : renderAvatar(conversation.name, { avatarUrl: conversation.avatarUrl, avatarKey: conversation.avatarKey })}<div><b>${escapeHtml(conversation.name)}${conversation.type === 'role_dm' ? '<small> 私密</small>' : ''}</b><p>${escapeHtml(last?.content || (conversation.type === 'char' ? '酒馆当前 Char' : '开始一段私信'))}</p></div>${conversation.unread ? `<span>${conversation.unread}</span>` : ''}</button>`;
    }).join('')}</div><section class="tf-new-contacts"><h3>开始新私信</h3>${availableRoles.slice(0, 8).map(npc => `<button data-action="start-npc-dm" data-npc-id="${escapeHtml(npc.id)}">${renderAvatar(npc.name, { avatarUrl: npc.avatarUrl, avatarKey: npc.avatarKey })}<span>${escapeHtml(npc.name)}</span>${icon('chevron')}</button>`).join('') || '<p>只有已生成人设并进入角色库的角色可以开启新私信</p>'}${roleDmEnabled ? '<button class="tf-role-dm-entry" data-action="new-role-dm">＋ 创建 A 与 B 的私密对话</button>' : '<p class="tf-private-note">角色之间私信当前关闭，可在“我 → 信息边界”开启。</p>'}</section></aside>`;
}

function renderDirectChat(data) {
    const available = data.conversations.filter(item => isConversationAllowed(data, item));
    const conversation = available.find(item => item.id === viewState.selectedConversationId) || available[0];
    if (!conversation) return '<section class="tf-dm-chat tf-empty"><div class="tf-empty-icon">'+icon('message')+'</div><h3>选择联系人</h3><p>与当前 Char 或论坛角色开始私信。</p></section>';
    viewState.selectedConversationId = conversation.id;
    const messages = conversation.messages || [];
    if (conversation.type === 'role_dm') {
        const participants = (conversation.participantIds || []).map(id => data.npcs.find(npc => npc.id === id)).filter(Boolean);
        if (participants.length < 2) return '<section class="tf-dm-chat tf-empty"><h3>私信参与者已不存在</h3></section>';
        return `<section class="tf-dm-chat tf-role-dm-chat"><header><button class="tf-dm-mobile-back" data-action="back-dm-list" aria-label="返回联系人">${icon('chevron')}</button><span class="tf-private-avatar">${icon('lock')}</span><div><b>${escapeHtml(conversation.name)}</b><span>仅这两位角色可知 · 不注入公共正文</span></div></header><div class="tf-dm-messages">${messages.length ? messages.map(message => {
            const sender = participants.find(npc => npc.id === message.senderNpcId);
            return `<div class="tf-dm-bubble ${message.senderNpcId === participants[0].id ? 'is-me' : 'is-them'}"><b>${escapeHtml(sender?.name || message.senderName || '角色')}</b><p>${renderSocialText(message.content)}</p><time>${formatTime(message.createdAt)}</time></div>`;
        }).join('') : `<div class="tf-dm-welcome"><span class="tf-private-avatar tf-avatar-large">${icon('lock')}</span><h3>私密对话尚未开始</h3><p>A 与 B 的内容不会让第三个角色知道，也不会进入正文注入。</p></div>`}</div><form class="tf-role-dm-composer" data-conversation-id="${escapeHtml(conversation.id)}"><select id="tf-role-dm-speaker">${participants.map(npc => `<option value="${escapeHtml(npc.id)}">下一条由 ${escapeHtml(npc.name)} 发送</option>`).join('')}</select><textarea id="tf-role-dm-direction" rows="2" placeholder="可选：给这一轮的幕后方向（不会保存为用户发言）"></textarea><button type="submit" class="tf-primary-button" data-action="generate-role-dm" data-conversation-id="${escapeHtml(conversation.id)}" ${viewState.dmBusy ? 'disabled' : ''}>${viewState.dmBusy ? '<span class="tf-spinner"></span>' : icon('sparkles')}生成下一条</button></form></section>`;
    }
    const profileNpc = getConversationProfileNpc(data, conversation);
    const profileId = profileNpc?.id || '';
    const header = profileId
        ? `<button class="tf-dm-profile-link" data-action="open-npc" data-npc-id="${escapeHtml(profileId)}" title="查看 ${escapeHtml(conversation.name)} 的主页">${renderAvatar(conversation.name, { avatarUrl: conversation.avatarUrl, avatarKey: conversation.avatarKey })}<div><b>${escapeHtml(conversation.name)}</b><span>@${escapeHtml(conversation.handle)}</span></div></button><button class="tf-icon-button" data-action="open-npc" data-npc-id="${escapeHtml(profileId)}" title="查看主页">${icon('user')}</button>`
        : `${renderAvatar(conversation.name, { avatarUrl: conversation.avatarUrl, avatarKey: conversation.avatarKey })}<div><b>${escapeHtml(conversation.name)}</b><span>@${escapeHtml(conversation.handle)}</span></div>`;
    const welcomeAvatar = profileId
        ? renderAvatar(conversation.name, { large: true, npcId: profileId, avatarUrl: conversation.avatarUrl, avatarKey: conversation.avatarKey })
        : renderAvatar(conversation.name, { large: true, avatarUrl: conversation.avatarUrl, avatarKey: conversation.avatarKey });
    return `<section class="tf-dm-chat"><header><button class="tf-dm-mobile-back" data-action="back-dm-list" aria-label="返回联系人">${icon('chevron')}</button>${header}</header><div class="tf-dm-messages">${messages.length ? messages.map(message => `<div class="tf-dm-bubble ${message.role === 'user' ? 'is-me' : 'is-them'}"><p>${escapeHtml(message.content)}</p><time>${formatTime(message.createdAt)}</time></div>`).join('') : `<div class="tf-dm-welcome">${welcomeAvatar}<h3>${escapeHtml(conversation.name)}</h3><p>${conversation.type === 'char' ? '这是酒馆当前 Char 的独立私信。' : '这段对话使用该角色的人设。'}</p></div>`}</div><form class="tf-dm-composer" data-conversation-id="${escapeHtml(conversation.id)}"><textarea id="tf-dm-input" rows="1" maxlength="3000" placeholder="发消息…" ${viewState.dmBusy ? 'disabled' : ''}></textarea><div class="tf-dm-composer-actions"><button type="button" class="tf-circle-button tf-ai-reply-button" data-action="generate-dm-reply" data-conversation-id="${escapeHtml(conversation.id)}" ${viewState.dmBusy || !messages.length ? 'disabled' : ''} aria-label="生成 AI 回复">${viewState.dmBusy ? '<span class="tf-spinner"></span>' : icon('sparkles')}</button><button type="submit" class="tf-circle-button" data-action="send-dm" data-conversation-id="${escapeHtml(conversation.id)}" ${viewState.dmBusy ? 'disabled' : ''} aria-label="发送消息">${icon('send')}</button></div></form></section>`;
}

function renderMessages(data) {
    prepareConversations(data);
    const unread = data.notifications.filter(item => !item.read && !npcForId(item.actorNpcId)?.blocked).length;
    const body = viewState.messageMode === 'notifications'
        ? renderNotifications(data)
        : `<div class="tf-messages-page ${viewState.mobileDmChat ? 'is-chat-open' : ''}">${renderConversationList(data)}${renderDirectChat(data)}</div>`;
    return `<div class="tf-message-shell"><nav class="tf-message-tabs"><button class="${viewState.messageMode === 'dm' ? 'is-active' : ''}" data-action="message-mode" data-mode="dm">私信</button><button class="${viewState.messageMode === 'notifications' ? 'is-active' : ''}" data-action="message-mode" data-mode="notifications">通知${unread ? `<i>${unread}</i>` : ''}</button></nav>${body}</div>`;
}

function renderNotifications(data) {
    const items = [...data.notifications].filter(item => !npcForId(item.actorNpcId)?.blocked).sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
    return `<section class="tf-notifications"><header><div><h2>通知</h2><p>回复、关注和系统消息都会集中在这里。</p></div><button class="tf-secondary-button" data-action="mark-all-notifications">全部已读</button></header><div class="tf-notification-list">${items.length ? items.map(item => {
        const npc = npcForId(item.actorNpcId);
        return `<button class="tf-notification ${item.read ? '' : 'is-unread'}" data-action="open-notification" data-notification-id="${escapeHtml(item.id)}" data-post-id="${escapeHtml(item.postId)}" data-contact-search="${escapeHtml(`${item.actorName} ${item.content}`.toLocaleLowerCase())}">${renderAvatar(item.actorName, { avatarUrl: npc?.avatarUrl, avatarKey: npc?.avatarKey })}<div><b>${escapeHtml(item.actorName)}</b><p>${escapeHtml(item.content)}</p><time>${formatTime(item.createdAt)}</time></div><i></i></button>`;
    }).join('') : '<div class="tf-card tf-empty"><div class="tf-empty-icon">'+icon('heart')+'</div><h3>暂时没有通知</h3><p>有人回复或关注你时会出现在这里。</p></div>'}</div></section>`;
}

function renderMeNav() {
    const section = getSettings().ui.meSection || 'overview';
    const items = [
        ['overview', 'user', '主页'], ['favorites', 'bookmark', '收藏'], ['npcs', 'users', '角色与头像'],
        ['memory', 'book', '角色记忆'], ['privacyRelations', 'lock', '隐私与关系'],
        ['prompts', 'book', '论坛设定'], ['api', 'settings', 'API'], ['sources', 'shield', '内容与注入'],
        ['boundaries', 'lock', '信息边界'], ['appearance', 'palette', '外观'], ['notifications', 'message', '通知设置'], ['runtime', 'database', '运行后台'], ['data', 'database', '数据'],
    ];
    return `<nav class="tf-me-nav">${items.map(([id, iconName, label]) => `<button class="${section === id ? 'is-active' : ''}" data-action="me-section" data-section="${id}">${icon(iconName)}<span>${label}</span></button>`).join('')}</nav>`;
}

function renderMeOverview(data) {
    const settings = getSettings();
    const profile = settings.profile;
    const snapshot = getChatSnapshot();
    const displayName = profile.displayName || snapshot.names.user || '我';
    const selectedCount = data.posts.filter(post => post.selectedForInjection).length;
    const cover = renderStoredImage({ url: profile.backgroundUrl, imageKey: profile.backgroundKey, alt: '个人主页背景' });
    return `<div class="tf-me-overview"><section class="tf-personal-profile tf-card"><div class="tf-profile-cover">${cover}</div><div class="tf-profile-summary">${renderAvatar(displayName, { large: true, avatarUrl: profile.avatarUrl, avatarKey: profile.avatarKey })}<div><h1>${escapeHtml(displayName)}</h1><p>@${escapeHtml(profile.handle || 'me')} · ${escapeHtml(settings.appearance.forumName)}</p><span>${escapeHtml(profile.bio || '还没有填写个人简介。')}</span></div><div class="tf-profile-stats"><span><b>${data.posts.length}</b>动态</span><span><b>${data.npcs.length}</b>角色</span><span><b>${data.posts.filter(post => post.favorite).length}</b>收藏</span></div></div></section><section class="tf-card tf-settings-card"><header><div><h3>编辑个人主页</h3><p>头像和背景都支持本地图片或图床直链。</p></div></header><div class="tf-form-grid"><label><span>显示名称</span><input data-profile-field="displayName" value="${escapeHtml(profile.displayName)}" placeholder="默认跟随酒馆 User 名称"></label><label><span>账号</span><input data-profile-field="handle" value="${escapeHtml(profile.handle)}"></label><label class="is-wide"><span>个人简介</span><textarea data-profile-field="bio" rows="3">${escapeHtml(profile.bio)}</textarea></label></div><div class="tf-profile-assets"><div><b>个人头像</b><div class="tf-image-source-row"><input data-profile-image-url="avatar" value="${escapeHtml(profile.avatarUrl)}" placeholder="粘贴头像图床直链"><button class="tf-secondary-button" data-action="upload-profile-avatar">导入本地图片</button><button class="tf-danger-text" data-action="clear-profile-avatar">清除</button></div>${renderDefaultAvatarChoices('select-profile-default-avatar')}</div><div><b>主页背景</b><div class="tf-image-source-row"><input data-profile-image-url="background" value="${escapeHtml(profile.backgroundUrl)}" placeholder="粘贴背景图床直链"><button class="tf-secondary-button" data-action="upload-profile-background">导入本地图片</button><button class="tf-danger-text" data-action="clear-profile-background">清除</button></div></div></div></section><div class="tf-dashboard-grid"><button class="tf-card" data-action="me-section" data-section="favorites">${icon('bookmark')}<b>我的收藏</b><span>收藏内容不会自动清理</span></button><button class="tf-card" data-action="me-section" data-section="npcs">${icon('users')}<b>角色管理</b><span>主页、人设、头像、绑定和私信</span></button><button class="tf-card" data-action="me-section" data-section="memory">${icon('book')}<b>角色记忆</b><span>独立编辑每个角色知道和记得的事</span></button><button class="tf-card" data-action="me-section" data-section="privacyRelations">${icon('lock')}<b>隐私与关系</b><span>集中管理静音与拉黑角色</span></button><button class="tf-card" data-action="me-section" data-section="appearance">${icon('palette')}<b>外观设置</b><span>名称、字体、颜色和 CSS</span></button><button class="tf-card" data-action="me-section" data-section="runtime">${icon('database')}<b>运行后台</b><span>生成记录、推理内容和报错</span></button><button class="tf-card" data-action="me-section" data-section="sources">${icon('shield')}<b>注入状态</b><span>${settings.injection.enabled ? `已开启 · ${selectedCount} 篇待注入` : '当前已关闭'}</span></button></div></div>`;
}

function renderDefaultAvatarChoices(action, npcId = '') {
    return `<div class="tf-default-avatars"><span>默认随机头像</span>${DEFAULT_AVATARS.map((item, index) => `<button type="button" data-action="${action}" data-avatar-index="${index}" ${npcId ? `data-npc-id="${escapeHtml(npcId)}"` : ''} title="${escapeHtml(item.name)}">${renderAvatar(item.name, { avatarUrl: item.url })}</button>`).join('')}</div>`;
}

function renderFavorites(data) {
    const favorites = data.posts.filter(post => post.favorite);
    return `<section class="tf-section-page"><header><div><h2>收藏</h2><p>收藏帖不会被自动清理。</p></div></header><div class="tf-feed-list tf-feed-compact">${favorites.length ? [...favorites].reverse().map(renderPost).join('') : '<div class="tf-card tf-empty"><div class="tf-empty-icon">'+icon('bookmark')+'</div><h3>还没有收藏</h3></div>'}</div></section>`;
}

function renderAvatarLibrary(settings) {
    return `<section class="tf-card tf-settings-card"><header><div><h3>角色头像库</h3><p>可以导入本地图片，也可以粘贴图床直链，再分配给任意角色。</p></div></header><div class="tf-avatar-add"><input id="tf-avatar-name" placeholder="头像名称"><input id="tf-avatar-url" placeholder="https://example.com/avatar.png"><button class="tf-primary-button" data-action="add-avatar-url">添加图床直链</button><button class="tf-secondary-button" data-action="upload-avatar-library">导入本地图片</button></div><div class="tf-avatar-library">${settings.avatarLibrary.length ? settings.avatarLibrary.map(item => `<div class="tf-avatar-item" data-avatar-id="${escapeHtml(item.id)}">${renderAvatar(item.name, { avatarUrl: item.url, avatarKey: item.imageKey })}<div><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.url || '本地图片')}</span></div><button class="tf-icon-button" data-action="delete-avatar-url" data-avatar-id="${escapeHtml(item.id)}">${icon('trash')}</button></div>`).join('') : '<p class="tf-empty-mini">头像库为空</p>'}</div></section>`;
}

function renderNpcList(data) {
    const settings = getSettings();
    const roles = getRoleLibrary(data);
    return `<section class="tf-section-page"><header><div><h2>角色与头像</h2><p>这里只显示已有人设的角色；当前 Char 会自动建立角色。</p></div><button class="tf-primary-button" data-action="add-npc">${icon('plus')}新建角色</button></header><div class="tf-npc-grid">${roles.length ? roles.map(npc => `<article class="tf-card tf-npc-card ${npc.blocked ? 'is-blocked' : ''}">${renderAvatar(npc.name, { large: true, npcId: npc.id, avatarUrl: npc.avatarUrl, avatarKey: npc.avatarKey })}<div><h3>${escapeHtml(npc.name)}${npc.systemRole ? '<small>当前 Char</small>' : ''}</h3><p>@${escapeHtml(npc.handle)}</p><span>${escapeHtml(npc.bio || npc.signature || npc.bindingLabel || '已建立角色人设')}</span><em>${npc.blocked ? '已拉黑' : npc.muted ? '已静音' : npc.socialState === 'quarrel' ? '争吵中' : npc.followedByUser && npc.followsUser ? '互相关注' : npc.followedByUser ? '已关注' : npc.followsUser ? '关注了你' : ''}</em></div><footer><button class="tf-text-button" data-action="edit-npc" data-npc-id="${escapeHtml(npc.id)}">编辑角色资料</button><button class="tf-primary-button" data-action="start-npc-dm" data-npc-id="${escapeHtml(npc.id)}" ${npc.blocked ? 'disabled' : ''}>私信</button></footer></article>`).join('') : '<div class="tf-card tf-empty"><div class="tf-empty-icon">'+icon('users')+'</div><h3>角色库还是空的</h3><p>点击帖子作者头像并生成人设后，角色才会进入这里。</p></div>'}</div>${renderAvatarLibrary(settings)}</section>`;
}

function renderNpcMemory(npc) {
    const memory = npc.memory;
    const area = (field, label, hint = '') => `<label class="is-wide"><span>${label}</span><textarea data-npc-memory-array="${field}" rows="4">${escapeHtml((memory[field] || []).join('\n'))}</textarea>${hint ? `<small>${hint}</small>` : ''}</label>`;
    return `<section class="tf-card tf-settings-card tf-memory-card" data-npc-id="${escapeHtml(npc.id)}"><header><div><h3>${escapeHtml(npc.name)}的独立社交记忆</h3><p>一行一条，可随时手动修改。私信秘密不会进入公共帖子注入。</p></div></header><div class="tf-form-grid"><label><span>与用户的关系</span><input data-npc-memory-field="relationshipToUser" value="${escapeHtml(memory.relationshipToUser)}" placeholder="陌生人、朋友、恋人…"></label><label><span>关系值（-100～100）</span><input type="number" min="-100" max="100" data-npc-memory-field="relationshipScore" value="${Number(memory.relationshipScore || 0)}"></label><label><span>社交状态</span><select data-npc-social-state><option value="normal" ${npc.socialState === 'normal' ? 'selected' : ''}>普通</option><option value="friendly" ${npc.socialState === 'friendly' ? 'selected' : ''}>亲近</option><option value="quarrel" ${npc.socialState === 'quarrel' ? 'selected' : ''}>争吵中</option><option value="blocked" ${npc.socialState === 'blocked' ? 'selected' : ''}>已拉黑</option></select></label>${area('publicHistory', '曾经发过什么', '新发帖和回帖会自动追加，也可以删改。')}${area('privateTalks', '私信里谈过的秘密', '仅该角色自己的私密生成可读。')}${area('knownFacts', '确定知道的事情')}${area('unknownFacts', '明确不知道的事情', '生成时会明确禁止角色使用这些信息。')}${area('attitudes', '对其他角色的态度', '例：@xiaoming：信任但不完全赞同') }<label class="is-wide"><span>其他记忆备注</span><textarea data-npc-memory-field="notes" rows="4">${escapeHtml(memory.notes)}</textarea></label></div></section>`;
}

function renderRoleMemoryPage(data) {
    const roles = getRoleLibrary(data);
    const selected = roles.find(npc => npc.id === viewState.selectedMemoryNpcId) || roles[0];
    if (selected) viewState.selectedMemoryNpcId = selected.id;
    return `<section class="tf-section-page tf-role-memory-page"><header><div><h2>角色记忆</h2><p>每个角色的经历、关系、秘密与认知边界彼此独立。</p></div></header>${roles.length ? `<div class="tf-role-memory-layout"><aside class="tf-card tf-memory-role-list">${roles.map(npc => `<button class="${selected?.id === npc.id ? 'is-active' : ''}" data-action="select-role-memory" data-npc-id="${escapeHtml(npc.id)}">${renderAvatar(npc.name, { avatarUrl: npc.avatarUrl, avatarKey: npc.avatarKey })}<span><b>${escapeHtml(npc.name)}</b><small>@${escapeHtml(npc.handle)} · ${escapeHtml(npc.memory?.relationshipToUser || '陌生人')}</small></span>${icon('chevron')}</button>`).join('')}</aside><div>${renderNpcMemory(selected)}</div></div>` : '<div class="tf-card tf-empty"><div class="tf-empty-icon">'+icon('book')+'</div><h3>还没有可编辑的角色记忆</h3><p>角色生成人设并进入角色库后，会出现在这里。</p></div>'}</section>`;
}

function renderPrivacyRelations(data) {
    const roles = getRoleLibrary(data);
    const muted = roles.filter(npc => npc.muted);
    const blocked = roles.filter(npc => npc.blocked);
    const rows = (items, action, empty) => items.length ? items.map(npc => `<article class="tf-relation-row" data-npc-id="${escapeHtml(npc.id)}">${renderAvatar(npc.name, { avatarUrl: npc.avatarUrl, avatarKey: npc.avatarKey })}<div><b>${escapeHtml(npc.name)}</b><small>@${escapeHtml(npc.handle)}</small></div><button class="tf-secondary-button" data-action="${action}" data-npc-id="${escapeHtml(npc.id)}">解除</button></article>`).join('') : `<p class="tf-empty-mini">${empty}</p>`;
    return `<section class="tf-section-page tf-privacy-relations"><header><div><h2>隐私与关系</h2><p>集中查看和解除静音、拉黑，不必再进入角色资料深处寻找。</p></div></header><section class="tf-card tf-settings-card"><header><div><h3>已静音角色</h3><p>不会出现在关注与推荐流，仍可查看主页和私信。</p></div></header><div class="tf-relation-list">${rows(muted, 'toggle-role-muted', '没有静音任何角色')}</div></section><section class="tf-card tf-settings-card"><header><div><h3>已拉黑角色</h3><p>隐藏其帖子、评论和通知，禁止私信并取消双方关注；解除后不会自动恢复关注。</p></div></header><div class="tf-relation-list">${rows(blocked, 'toggle-role-blocked', '没有拉黑任何角色')}</div></section></section>`;
}

function renderNpcProfileLegacy(data, npc) {
    const settings = getSettings();
    const busy = viewState.npcBusy.has(npc.id);
    const evidence = collectNpcEvidence(data, npc.id);
    const characters = getCharacterCatalog();
    const worldEntries = viewState.worldCatalog.flatMap(book => book.entries.map(entry => ({ ...entry, book: book.name })));
    const bindingOptions = npc.bindingType === 'char'
        ? characters.map(item => `<option value="${escapeHtml(item.id)}" ${npc.bindingTarget === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')
        : npc.bindingType === 'world'
            ? worldEntries.map(item => `<option value="${escapeHtml(item.key)}" ${npc.bindingTarget === item.key ? 'selected' : ''}>${escapeHtml(item.book)} · ${escapeHtml(item.title)}</option>`).join('')
            : '';
    return `<section class="tf-section-page" data-npc-id="${escapeHtml(npc.id)}"><header><button class="tf-back-button" data-action="back-npcs">${icon('chevron')}返回</button><div></div><button class="tf-danger-text" data-action="delete-npc" data-npc-id="${escapeHtml(npc.id)}" ${npc.systemRole ? 'disabled title="当前 Char 角色会自动保留"' : ''}>${npc.systemRole ? '当前 Char' : '删除角色'}</button></header><section class="tf-npc-profile-hero tf-card">${renderAvatar(npc.name, { large: true, avatarUrl: npc.avatarUrl, avatarKey: npc.avatarKey })}<div><h2>${escapeHtml(npc.name)}</h2><p>@${escapeHtml(npc.handle)}${npc.bindingLabel ? ` · 资料来源 ${escapeHtml(npc.bindingLabel)}` : ''}</p><span>${escapeHtml(npc.bio || '这个角色还没有主页简介。')}</span><small>${npc.blocked ? '已拉黑' : npc.muted ? '已静音' : npc.followedByUser && npc.followsUser ? '互相关注' : npc.followsUser ? '对方关注了你' : npc.followedByUser ? '你已关注对方' : '尚未关注'}</small></div><div class="tf-profile-buttons"><button class="tf-secondary-button" data-action="toggle-follow-role" data-npc-id="${escapeHtml(npc.id)}" ${npc.blocked ? 'disabled' : ''}>${npc.followedByUser ? '取消关注' : '关注'}</button><button class="tf-primary-button" data-action="generate-npc-profile" data-npc-id="${escapeHtml(npc.id)}" ${busy ? 'disabled' : ''}>${busy ? '<span class="tf-spinner"></span>' : icon('sparkles')}${npc.profileGenerated ? '重新生成' : '生成人设'}</button></div></section><section class="tf-card tf-settings-card"><header><div><h3>主页与人设库</h3><p>所有字段都可以手动修改。</p></div>${renderSwitch({ checked: npc.inject, action: 'toggle-npc-injection', label: '注入酒馆' })}</header><div class="tf-form-grid"><label><span>显示名称</span><input data-npc-field="name" value="${escapeHtml(npc.name)}"></label><label><span>论坛账号</span><input data-npc-field="handle" value="${escapeHtml(npc.handle)}"></label><label><span>头像库</span><select data-npc-avatar><option value="">保留当前头像</option>${settings.avatarLibrary.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === npc.avatarId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><label><span>头像图床直链</span><input data-npc-avatar-url value="${escapeHtml(npc.avatarKey ? '' : npc.avatarUrl)}" placeholder="https://example.com/avatar.png"></label><div class="tf-npc-avatar-actions"><button class="tf-secondary-button" data-action="upload-npc-avatar" data-npc-id="${escapeHtml(npc.id)}">导入本地头像</button><button class="tf-danger-text" data-action="clear-npc-avatar" data-npc-id="${escapeHtml(npc.id)}">恢复随机头像</button></div><div>${renderSwitch({ checked: npc.followsUser, action: 'toggle-role-follows-user', label: '该角色关注我' })}</div><label><span>人设资料来源</span><select data-npc-binding-type><option value="none" ${npc.bindingType === 'none' ? 'selected' : ''}>不引用</option><option value="char" ${npc.bindingType === 'char' ? 'selected' : ''}>引用酒馆 Char</option><option value="world" ${npc.bindingType === 'world' ? 'selected' : ''}>引用世界书条目</option></select></label><label><span>资料来源对象</span><select data-npc-binding-target ${npc.bindingType === 'none' ? 'disabled' : ''}><option value="">请选择</option>${bindingOptions}</select></label><label><span>所在地</span><input data-npc-field="location" value="${escapeHtml(npc.location)}"></label><label><span>个性签名</span><input data-npc-field="signature" value="${escapeHtml(npc.signature)}"></label><label class="is-wide"><span>主页简介</span><textarea data-npc-field="bio" rows="3">${escapeHtml(npc.bio)}</textarea></label><label class="is-wide"><span>详细人设库</span><textarea data-npc-field="persona" rows="8">${escapeHtml(npc.persona)}</textarea><small>引用资料会与此处人设一起用于私信、生成和注入。</small></label></div>${renderDefaultAvatarChoices('select-npc-default-avatar', npc.id)}<footer><button class="tf-secondary-button" data-action="refresh-world-info">刷新世界书</button><button class="tf-primary-button" data-action="start-npc-dm" data-npc-id="${escapeHtml(npc.id)}" ${npc.blocked ? 'disabled' : ''}>${icon('message')}与角色私信</button></footer></section>${renderNpcMemory(npc)}<section class="tf-card tf-settings-card"><header><div><h3>公开发言依据</h3><p>用于自动生成人设。</p></div></header><div class="tf-evidence">${evidence.length ? evidence.map(item => `<p>${escapeHtml(item)}</p>`).join('') : '<p class="tf-empty-mini">暂无发言</p>'}</div></section></section>`;
}

function renderNpcProfile(data, npc) {
    const page = renderNpcProfileLegacy(data, npc).replace(renderNpcMemory(npc), '');
    const avatarChoices = renderDefaultAvatarChoices('select-npc-default-avatar', npc.id);
    const backgroundPreview = renderStoredImage({ url: npc.backgroundUrl, imageKey: npc.backgroundKey, alt: `${npc.name} 的主页背景` });
    const backgroundEditor = `<section class="tf-npc-background-editor"><div class="tf-npc-background-preview">${backgroundPreview || '<span>尚未设置主页背景</span>'}</div><div><b>公开主页背景</b><p>显示在角色公开主页顶部，支持本地图片或图床直链。</p><div class="tf-image-source-row"><input data-npc-background-url value="${escapeHtml(npc.backgroundKey ? '' : npc.backgroundUrl)}" placeholder="粘贴背景图床直链"><button class="tf-secondary-button" data-action="upload-npc-background" data-npc-id="${escapeHtml(npc.id)}">导入本地图片</button><button class="tf-danger-text" data-action="clear-npc-background" data-npc-id="${escapeHtml(npc.id)}">清除</button></div></div></section>`;
    return page.replace(avatarChoices, `${backgroundEditor}${avatarChoices}`);
}

function renderNpcs(data) {
    const npc = data.npcs.find(item => item.id === viewState.selectedNpcId);
    return npc ? renderNpcProfile(data, npc) : renderNpcList(data);
}

function renderPublicNpcProfileLegacy(data, npc) {
    const posts = data.posts.filter(post => post.npcId === npc.id || String(post.handle || '').toLocaleLowerCase() === String(npc.handle || '').toLocaleLowerCase());
    const followingHandles = new Set((npc.followingHandles || []).map(handle => String(handle).replace(/^@/, '').toLocaleLowerCase()));
    const followingRoles = data.npcs.filter(role => role.id !== npc.id && followingHandles.has(String(role.handle || '').toLocaleLowerCase()));
    const followers = data.npcs.filter(role => (role.followingHandles || []).some(handle => String(handle).replace(/^@/, '').toLocaleLowerCase() === String(npc.handle || '').toLocaleLowerCase()));
    const cover = renderStoredImage({ url: npc.backgroundUrl, imageKey: npc.backgroundKey, alt: `${npc.name} 的主页背景` });
    const busy = viewState.npcBusy.has(npc.id);
    return `<section class="tf-public-profile"><header class="tf-detail-header"><button class="tf-back-button" data-action="back-public-profile">${icon('chevron')}返回</button><div><h2>${escapeHtml(npc.name)}</h2><p>${posts.length} 篇帖子</p></div></header><section class="tf-public-profile-hero tf-card"><div class="tf-public-profile-cover">${cover}</div><div class="tf-public-profile-main">${renderAvatar(npc.name, { large: true, avatarUrl: npc.avatarUrl, avatarKey: npc.avatarKey })}<div class="tf-public-profile-actions"><button class="tf-secondary-button" data-action="toggle-follow-role" data-npc-id="${escapeHtml(npc.id)}" ${npc.blocked ? 'disabled' : ''}>${npc.followedByUser ? '取消关注' : '关注'}</button><button class="tf-primary-button" data-action="start-npc-dm" data-npc-id="${escapeHtml(npc.id)}" ${npc.blocked || !isRoleLibraryMember(npc) ? 'disabled' : ''}>私信</button>${isRoleLibraryMember(npc) ? `<button class="tf-icon-button" data-action="edit-npc" data-npc-id="${escapeHtml(npc.id)}" title="编辑角色资料">${icon('edit')}</button>` : ''}</div><div class="tf-public-profile-copy"><h1>${escapeHtml(npc.name)}</h1><p>@${escapeHtml(npc.handle)}</p><span>${escapeHtml(npc.bio || npc.signature || '这个账号还没有填写个人简介。')}</span>${npc.location ? `<small>${escapeHtml(npc.location)}</small>` : ''}<div class="tf-public-profile-stats"><b>${numberLabel(posts.length)}<small>帖子</small></b><b>${numberLabel(npc.followers)}<small>粉丝</small></b><b>${numberLabel(npc.following)}<small>关注</small></b></div></div></div>${!npc.profileGenerated ? `<div class="tf-profile-draft"><p>${busy ? '正在根据公开发言生成主页与角色人设…' : '这个账号还没有完整的人设与主页。生成后才会进入角色库并开放私信。'}</p><button class="tf-primary-button" data-action="generate-npc-profile" data-npc-id="${escapeHtml(npc.id)}" ${busy ? 'disabled' : ''}>${busy ? '<span class="tf-spinner"></span>生成中' : `${icon('sparkles')}生成人设与主页`}</button></div>` : ''}</section><section class="tf-profile-social-list tf-card"><header><div><h3>关注列表</h3><p>主页公开可见的社交关系</p></div></header>${followingRoles.length ? followingRoles.map(role => `<button data-action="open-npc" data-npc-id="${escapeHtml(role.id)}">${renderAvatar(role.name, { avatarUrl: role.avatarUrl, avatarKey: role.avatarKey })}<span><b>${escapeHtml(role.name)}</b><small>@${escapeHtml(role.handle)}</small></span>${icon('chevron')}</button>`).join('') : '<p class="tf-empty-mini">暂时没有可显示的关注角色</p>'}${followers.length ? `<small class="tf-known-followers">已识别 ${followers.length} 位角色粉丝</small>` : ''}</section><section class="tf-public-posts"><header><h3>帖子</h3></header><div class="tf-feed-list">${posts.length ? [...posts].sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).map(post => renderPost(post)).join('') : '<div class="tf-card tf-empty"><h3>还没有发布帖子</h3></div>'}</div></section></section>`;
}

function renderPublicNpcProfile(data, npc) {
    const visibleData = npc.blocked ? { ...data, posts: data.posts.filter(post => post.npcId !== npc.id) } : data;
    const page = renderPublicNpcProfileLegacy(visibleData, npc);
    const menu = `<details class="tf-profile-menu"><summary class="tf-icon-button" aria-label="关系操作">${icon('more')}</summary><div><button data-action="toggle-role-muted" data-npc-id="${escapeHtml(npc.id)}">${icon('message')}<span>${npc.muted ? '取消静音' : '静音该角色'}</span></button><button class="${npc.blocked ? '' : 'is-danger'}" data-action="toggle-role-blocked" data-npc-id="${escapeHtml(npc.id)}">${icon('lock')}<span>${npc.blocked ? '解除拉黑' : '拉黑该角色'}</span></button>${npc.followedByUser ? `<button data-action="toggle-follow-role" data-npc-id="${escapeHtml(npc.id)}">${icon('user')}<span>取消关注</span></button>` : ''}</div></details>`;
    return page.replace('</div><div class="tf-public-profile-copy">', `${menu}</div><div class="tf-public-profile-copy">`);
}

function renderPrompts() {
    const entries = getSettings().promptEntries;
    const roleOptions = role => [['system', '系统'], ['user', '用户'], ['assistant', '助手']]
        .map(([value, label]) => `<option value="${value}" ${role === value ? 'selected' : ''}>${label}</option>`).join('');
    return `<section class="tf-section-page"><header><div><h2>论坛设定</h2><p>像酒馆预设一样排列消息，并为每条设定选择 system、user 或 assistant。</p></div><div><button class="tf-secondary-button" data-action="import-prompts">导入</button><button class="tf-secondary-button" data-action="export-prompts">导出</button><button class="tf-primary-button" data-action="add-prompt-entry">${icon('plus')}新增</button></div></header><div class="tf-prompt-list">${entries.map(entry => `<article class="tf-card tf-prompt-entry" data-entry-id="${escapeHtml(entry.id)}"><header><input data-entry-field="title" value="${escapeHtml(entry.title)}"><label class="tf-prompt-role"><span>role</span><select data-entry-field="role">${roleOptions(entry.role)}</select></label>${renderSwitch({ checked: entry.enabled, action: 'toggle-prompt-entry', label: '启用' })}<button class="tf-icon-button" data-action="delete-prompt-entry" data-entry-id="${escapeHtml(entry.id)}">${icon('trash')}</button></header><textarea data-entry-field="content" rows="7">${escapeHtml(entry.content)}</textarea><footer><label>触发词<input data-entry-field="keywords" value="${escapeHtml((entry.keywords || []).join(', '))}" placeholder="逗号分隔"></label><label>优先级<input type="number" data-entry-field="order" value="${Number(entry.order || 0)}"></label>${renderSwitch({ checked: entry.constant, action: 'toggle-prompt-constant', label: '常驻' })}</footer></article>`).join('')}</div></section>`;
}

function renderApiParameterRows(profile) {
    const parameters = profile.text.extraParameters || [];
    const types = selected => [['string', '文字'], ['number', '数字'], ['boolean', '开关'], ['json', 'JSON']]
        .map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
    return `<div class="tf-api-parameters">${parameters.length ? parameters.map(parameter => `<div class="tf-api-parameter" data-api-param-id="${escapeHtml(parameter.id)}"><input type="checkbox" data-api-param-field="enabled" ${parameter.enabled !== false ? 'checked' : ''} title="启用参数"><input data-api-param-field="key" value="${escapeHtml(parameter.key)}" placeholder="参数名，例如 top_p"><select data-api-param-field="type">${types(parameter.type)}</select><input data-api-param-field="value" value="${escapeHtml(parameter.value)}" placeholder="参数值"><button class="tf-icon-button" data-action="delete-api-param" data-param-id="${escapeHtml(parameter.id)}" title="删除参数">${icon('trash')}</button></div>`).join('') : '<p class="tf-empty-mini">还没有额外参数。温度和最大输出 Tokens 已在上方单独设置。</p>'}</div>`;
}

function renderApiSettings() {
    const settings = getSettings();
    const profile = getActiveApiProfile();
    const textConfig = getApiConfig('text');
    const imageConfig = getApiConfig('image');
    const isSt = textConfig.provider === 'sillytavern';
    const textPanel = isSt
        ? `<div class="tf-st-provider-note">无需填写地址或 Key。切换酒馆主界面的连接后，微坛会自动跟随；采样参数由酒馆当前连接管理。思考模型会消耗更多输出额度，建议论坛最大输出保持 8192 或更高。</div><div class="tf-form-grid"><label><span>论坛最大输出 Tokens</span><input type="number" data-api-setting="text.maxTokens" value="${Number(textConfig.maxTokens)}" min="1024" max="65536" step="256"></label></div>`
        : `<div class="tf-form-grid"><label><span>API 地址</span><input data-api-setting="text.endpoint" value="${escapeHtml(textConfig.endpoint)}" placeholder="https://api.example.com/v1"></label><label><span>模型名称</span><input data-api-setting="text.model" value="${escapeHtml(textConfig.model)}"></label><label><span>API Key</span><input type="password" data-secret="text" value="${escapeHtml(textConfig.apiKey)}"></label><label><span>温度</span><input type="number" data-api-setting="text.temperature" value="${Number(textConfig.temperature)}" min="0" max="2" step="0.1"></label><label><span>最大输出 Tokens</span><input type="number" data-api-setting="text.maxTokens" value="${Number(textConfig.maxTokens)}" min="1024" max="65536" step="256"></label></div><section class="tf-extra-parameter-panel"><header><div><h4>额外请求参数</h4><p>每行一个参数；点号可建立嵌套参数，例如 thinking.type。参数会随当前 API 配置保存。</p></div><button class="tf-secondary-button" data-action="add-api-param">新增一行</button></header><div class="tf-param-templates"><span>快速添加：</span><button data-action="add-api-param-template" data-key="top_p" data-value="1" data-type="number">top_p</button><button data-action="add-api-param-template" data-key="frequency_penalty" data-value="0" data-type="number">frequency_penalty</button><button data-action="add-api-param-template" data-key="presence_penalty" data-value="0" data-type="number">presence_penalty</button><button data-action="add-api-param-template" data-key="seed" data-value="0" data-type="number">seed</button></div>${renderApiParameterRows(profile)}<small>model、messages、stream 由插件负责，不能在这里覆盖。不同服务支持的参数不同，请按接口文档填写。</small></section>`;
    return `<section class="tf-section-page"><header><div><h2>API 配置</h2><p>可以直接使用酒馆当前连接，也可以保存多套独立 API 与参数。</p></div></header><section class="tf-card tf-api-profile-bar"><select data-action="select-api-profile">${settings.apiProfiles.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === profile.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select><button class="tf-secondary-button" data-action="new-api-profile">另存为</button><button class="tf-secondary-button" data-action="rename-api-profile" ${profile.reserved ? 'disabled' : ''}>重命名</button><button class="tf-danger-text" data-action="delete-api-profile" ${profile.reserved ? 'disabled' : ''}>删除</button></section><section class="tf-card tf-settings-card"><header><div><h3>文本生成</h3><p>${isSt ? '使用 SillyTavern 当前选中的 API 与模型。' : '使用独立的 OpenAI Chat Completions 兼容接口。'}</p></div><span class="tf-provider-badge">${isSt ? '酒馆默认' : '独立 API'}</span></header>${textPanel}</section><section class="tf-card tf-settings-card"><header><div><h3>帖子与评论图片</h3><p>帖子和评论共用这一套生图配置；没有 API 时可显示文字配图。</p></div></header><div class="tf-form-grid"><div>${renderSwitch({ checked: imageConfig.enabled, action: 'toggle-image-api', label: '启用真实生图 API' })}</div><div>${renderSwitch({ checked: imageConfig.textFallback, action: 'toggle-text-image-fallback', label: '无 API 时显示文字配图' })}</div><label><span>生图地址</span><input data-api-setting="image.endpoint" value="${escapeHtml(imageConfig.endpoint)}"></label><label><span>生图模型</span><input data-api-setting="image.model" value="${escapeHtml(imageConfig.model)}"></label><label><span>API Key</span><input type="password" data-secret="image" value="${escapeHtml(imageConfig.apiKey)}"></label><label><span>图片尺寸</span><select data-api-setting="image.size">${['1024x1024','1024x1536','1536x1024','512x512'].map(size => `<option ${imageConfig.size === size ? 'selected' : ''}>${size}</option>`).join('')}</select></label><div>${renderSwitch({ checked: imageConfig.autoGenerate, action: 'toggle-auto-image', label: '自动处理第一张配图' })}</div></div></section><section class="tf-card tf-settings-card"><header><div><h3>API Key 保存</h3><p>默认仅保留在当前页面会话。</p></div>${renderSwitch({ checked: settings.privacy.rememberApiKeys, action: 'toggle-remember-keys', label: '记住 API Key' })}</header></section></section>`;
}

function renderWorldInfoCatalogLegacy(settings) {
    if (viewState.worldLoading) return '<p class="tf-empty-mini"><span class="tf-spinner"></span> 正在读取世界书</p>';
    if (!viewState.worldCatalog.length) return '<p class="tf-empty-mini">没有找到世界书条目。请确认酒馆中已有世界书，然后点击右上角“刷新”。</p>';
    const masterNotice = settings.sources.worldInfo
        ? '<p class="tf-catalog-state is-on">已开启读取：勾选的条目会参与论坛生成。</p>'
        : '<p class="tf-catalog-state">总开关已关闭：可以预先选择条目，但当前不会参与论坛生成。</p>';
    return `${masterNotice}<div class="tf-world-books">${viewState.worldCatalog.map(book => `<details><summary><b>${escapeHtml(book.name)}</b><span>${book.entries.filter(entry => settings.sources.worldInfoEntries[entry.key]).length}/${book.entries.length}</span></summary><div class="tf-world-tools"><button data-action="select-world-book" data-book="${escapeHtml(book.name)}">选择酒馆已启用条目</button><button data-action="clear-world-book" data-book="${escapeHtml(book.name)}">清空</button></div>${book.entries.map(entry => `<label class="tf-world-entry"><input type="checkbox" data-world-entry="${escapeHtml(entry.key)}" ${settings.sources.worldInfoEntries[entry.key] ? 'checked' : ''}><span><b>${escapeHtml(entry.title)}</b><small>${entry.disabledInSillyTavern ? '酒馆中已禁用 · ' : ''}${escapeHtml(entry.content.slice(0, 100))}</small></span></label>`).join('')}</details>`).join('')}</div>`;
}

function renderWorldInfoCatalog(settings) {
    if (viewState.worldLoading) return '<p class="tf-empty-mini"><span class="tf-spinner"></span> 正在读取世界书</p>';
    if (!viewState.worldCatalog.length) return '<p class="tf-empty-mini">没有找到世界书条目。请确认酒馆中已有世界书，然后点击右上角“刷新”。</p>';
    const masterNotice = settings.sources.worldInfo
        ? '<p class="tf-catalog-state is-on">已开启世界书读取。当前 Char 的主要/附加世界书会自动识别，其他世界书需手动打开。</p>'
        : '<p class="tf-catalog-state">世界书总开关已关闭；以下选择会保留，但当前不会参与论坛生成。</p>';
    const renderBook = book => {
        const selectedCount = book.entries.filter(entry => entry.selected).length;
        const effectiveCount = book.enabled ? selectedCount : 0;
        const bindingLabels = {
            primary: '当前 Char · 主要',
            auxiliary: '当前 Char · 附加',
            'primary-and-auxiliary': '当前 Char · 主要/附加',
        };
        const badge = book.characterBound ? `<em class="tf-world-bound-badge">${bindingLabels[book.characterBinding] || '当前 Char 世界书'}</em>` : '';
        return `<details class="${book.enabled ? 'is-enabled' : 'is-disabled'}"><summary><span><b>${escapeHtml(book.name)}</b>${badge}</span><span>${effectiveCount}/${book.entries.length} 条参与读取</span></summary><div class="tf-world-book-master">${renderSwitch({ checked: book.enabled, action: 'toggle-world-book', label: book.enabled ? '读取此世界书' : '暂不读取此世界书', dataset: { book: book.name } })}<small>此开关只控制整本书是否读取，不会改变下面各条目的选择。</small></div><div class="tf-world-tools"><button data-action="select-world-book" data-book="${escapeHtml(book.name)}">按酒馆状态选择条目</button><button data-action="clear-world-book" data-book="${escapeHtml(book.name)}">取消所有条目选择</button></div>${book.entries.map(entry => `<label class="tf-world-entry"><input type="checkbox" data-world-entry="${escapeHtml(entry.key)}" ${entry.selected ? 'checked' : ''}><span><b>${escapeHtml(entry.title)}</b><small>${entry.disabledInSillyTavern ? '酒馆中已禁用 · ' : ''}${escapeHtml(entry.content.slice(0, 100))}</small></span></label>`).join('')}</details>`;
    };
    const visibleBooks = viewState.worldCatalog.filter(book => book.characterBound || book.enabled);
    const hiddenBooks = viewState.worldCatalog.filter(book => !book.characterBound && !book.enabled);
    const books = visibleBooks.length
        ? visibleBooks.map(renderBook).join('')
        : '<p class="tf-empty-mini">当前 Char 没有绑定世界书，也还没有手动打开其他世界书。</p>';
    const otherBooks = hiddenBooks.length
        ? `<details class="tf-world-other-books"><summary><span><b>其他世界书</b><small>默认不读取，手动打开后才显示条目</small></span><span>${hiddenBooks.length} 本</span></summary><div class="tf-world-other-list">${hiddenBooks.map(book => `<div class="tf-world-other-row"><span><b>${escapeHtml(book.name)}</b><small>${book.entries.length} 条</small></span><button class="tf-secondary-button" data-action="open-world-book" data-book="${escapeHtml(book.name)}">打开</button></div>`).join('')}</div></details>`
        : '';
    return `${masterNotice}<div class="tf-world-books">${books}${otherBooks}</div>`;
}

function renderSillyTavernPresetCatalog(settings) {
    const entries = getSillyTavernPresetCatalog();
    if (!entries.length) return '<p class="tf-empty-mini">当前酒馆连接没有可读取的文本预设条目。</p>';
    const roleLabel = { system: '系统', user: '用户', assistant: '助手' };
    const masterNotice = settings.sources.sillyTavernPreset
        ? '<p class="tf-catalog-state is-on">已开启读取：勾选的预设条目会复制到论坛请求。</p>'
        : '<p class="tf-catalog-state">总开关已关闭：可以预先选择条目，但当前不会复制到论坛请求。</p>';
    return `${masterNotice}<div class="tf-preset-catalog">${entries.map(entry => `<label class="tf-world-entry"><input type="checkbox" data-preset-entry="${escapeHtml(entry.id)}" ${settings.sources.presetEntries[entry.id] ? 'checked' : ''}><span><b>${escapeHtml(entry.title)}</b><small>${roleLabel[entry.role] || entry.role}${entry.disabledInSillyTavern ? ' · 酒馆中已禁用' : ' · 酒馆中已启用'} · ${escapeHtml(entry.content.slice(0, 120))}</small></span></label>`).join('')}</div>`;
}

function renderSourcesSettings() {
    const settings = getSettings();
    const tokens = viewState.injectionTokens;
    const overBudget = tokens.total > Number(settings.injection.tokenBudget || 2000);
    return `<section class="tf-section-page"><header><div><h2>内容与注入</h2><p>控制微坛读取什么，以及哪些内容进入主聊天。</p></div></header>
        <section class="tf-card tf-settings-card"><header><div><h3>酒馆资料读取</h3><p>正文、User、Char、世界书和酒馆预设完全独立，默认不读取酒馆预设。</p></div></header><div class="tf-form-grid"><div>${renderSwitch({ checked: settings.sources.chat, action: 'toggle-source-chat', label: '读取酒馆正文' })}</div><div>${renderSwitch({ checked: settings.sources.userPersona, action: 'toggle-source-user', label: '读取 User 人设' })}</div><div>${renderSwitch({ checked: settings.sources.characterPersona, action: 'toggle-source-character', label: '读取 Char 人设' })}</div><div>${renderSwitch({ checked: settings.sources.worldInfo, action: 'toggle-source-world', label: '读取世界书' })}</div><div>${renderSwitch({ checked: settings.sources.sillyTavernPreset, action: 'toggle-source-preset', label: '读取酒馆当前预设' })}</div><div>${renderSwitch({ checked: settings.generation.autoRefreshOnMessage, action: 'toggle-auto-refresh', label: '酒馆正文生成后自动更新论坛' })}<small class="tf-setting-hint">收到新的 Char 正文后自动生成一轮动态；开场白不会触发。</small></div><label><span>最近消息数</span><input type="number" data-setting="generation.contextMessages" value="${Number(settings.generation.contextMessages)}" min="1" max="200"></label></div>
        <div class="tf-generation-ranges"><div><b>每轮帖子数量</b><label>最少<input type="number" data-setting="generation.postsMin" value="${Number(settings.generation.postsMin)}" min="1" max="10"></label><label>最多<input type="number" data-setting="generation.postsMax" value="${Number(settings.generation.postsMax)}" min="1" max="10"></label></div><div><b>每篇初始评论</b><label>最少<input type="number" data-setting="generation.commentsMin" value="${Number(settings.generation.commentsMin)}" min="0" max="8"></label><label>最多<input type="number" data-setting="generation.commentsMax" value="${Number(settings.generation.commentsMax)}" min="0" max="8"></label></div><div><b>回帖后的 AI 跟帖</b><label>最少<input type="number" data-setting="generation.repliesMin" value="${Number(settings.generation.repliesMin)}" min="1" max="8"></label><label>最多<input type="number" data-setting="generation.repliesMax" value="${Number(settings.generation.repliesMax)}" min="1" max="8"></label></div></div>
        <div class="tf-world-head"><b>酒馆预设逐条选择（只读副本）</b><small>这里的开关不会修改酒馆预设原条目</small></div>${renderSillyTavernPresetCatalog(settings)}<div class="tf-world-head"><b>世界书逐条选择</b><button class="tf-secondary-button" data-action="refresh-world-info">刷新</button></div>${renderWorldInfoCatalog(settings)}</section>
        <section class="tf-card tf-settings-card"><header><div><h3>注入主聊天</h3><p>每篇帖子可在右上角“三个点”中单独选择。</p></div></header><div class="tf-token-meter ${overBudget ? 'is-over' : ''}"><div><span>当前实际注入</span><b data-injection-token-total>${tokens.loading ? '计算中…' : `${numberLabel(tokens.total)} Tokens`}</b><small data-injection-token-parts>帖子 ${numberLabel(tokens.forum)} · 角色人设 ${numberLabel(tokens.roles)}</small></div><progress max="${Number(settings.injection.tokenBudget || 2000)}" value="${Math.min(tokens.total, Number(settings.injection.tokenBudget || 2000))}"></progress>${overBudget ? '<strong>已超过提醒预算，请减少注入帖子、评论或角色人设。</strong>' : ''}</div><div class="tf-form-grid"><div>${renderSwitch({ checked: settings.injection.enabled, action: 'toggle-master-injection', label: '启用帖子注入' })}</div><div>${renderSwitch({ checked: settings.injection.includeComments, action: 'toggle-include-comments', label: '连同评论注入' })}</div><div>${renderSwitch({ checked: settings.injection.npcEnabled, action: 'toggle-npc-master-injection', label: '启用角色人设注入' })}</div><label><span>Token 提醒预算</span><input type="number" data-setting="injection.tokenBudget" value="${Number(settings.injection.tokenBudget || 2000)}" min="100" max="100000"></label><label><span>注入深度</span><input type="number" data-setting="injection.depth" value="${Number(settings.injection.depth)}" min="0" max="10000"></label><label><span>最多注入帖子</span><input type="number" data-setting="injection.maxPosts" value="${Number(settings.injection.maxPosts)}" min="1" max="50"></label></div></section>
        <section class="tf-card tf-settings-card"><header><div><h3>自动清理</h3><p>收藏帖始终保留。</p></div></header><div class="tf-form-grid"><div>${renderSwitch({ checked: settings.retention.autoCleanup, action: 'toggle-auto-cleanup', label: '启用自动清理' })}</div><label><span>帖子数量上限</span><input type="number" data-setting="retention.maxPosts" value="${Number(settings.retention.maxPosts)}" min="1" max="5000"></label></div><footer><button class="tf-secondary-button" data-action="cleanup-now">立即清理</button></footer></section></section>`;
}

function renderAppearanceSettingsLegacyOld() {
    const appearance = getSettings().appearance;
    return `<section class="tf-section-page"><header><div><h2>外观</h2><p>名称、字体、颜色和自定义 CSS 都会即时生效。</p></div></header><section class="tf-card tf-settings-card"><header><div><h3>基础外观</h3><p>字体留空时自动跟随 SillyTavern。</p></div></header><div class="tf-form-grid"><label><span>论坛名称</span><input data-appearance="forumName" value="${escapeHtml(appearance.forumName)}" maxlength="30"></label><label><span>自定义字体</span><input data-appearance="fontFamily" value="${escapeHtml(appearance.fontFamily)}" placeholder="留空跟随酒馆；例：霞鹜文楷"></label><label class="tf-color-field"><span>主题色</span><input type="color" data-appearance="primaryColor" value="${escapeHtml(appearance.primaryColor)}"><code>${escapeHtml(appearance.primaryColor)}</code></label><label class="tf-color-field"><span>背景色</span><input type="color" data-appearance="backgroundColor" value="${escapeHtml(appearance.backgroundColor)}"><code>${escapeHtml(appearance.backgroundColor)}</code></label><label class="tf-color-field"><span>卡片色</span><input type="color" data-appearance="cardColor" value="${escapeHtml(appearance.cardColor)}"><code>${escapeHtml(appearance.cardColor)}</code></label><label class="tf-color-field"><span>文字色</span><input type="color" data-appearance="textColor" value="${escapeHtml(appearance.textColor)}"><code>${escapeHtml(appearance.textColor)}</code></label></div></section><section class="tf-card tf-settings-card"><header><div><h3>导入 CSS 美化</h3><p>导入 .css 文件或直接粘贴。建议只使用 #tavern-forum-root 下的选择器。</p></div><div><button class="tf-secondary-button" data-action="import-css">导入 CSS</button><button class="tf-danger-text" data-action="clear-css">清空</button></div></header><textarea class="tf-custom-css" data-appearance="customCss" rows="16" placeholder="#tavern-forum-root .tf-post { ... }">${escapeHtml(appearance.customCss)}</textarea></section></section>`;
}

function renderAppearanceSettingsLegacy(beforeCss = '') {
    const appearance = getSettings().appearance;
    const colorField = (field, label) => `<label class="tf-color-field"><span>${label}</span><input type="color" data-appearance="${field}" value="${escapeHtml(appearance[field])}"><code>${escapeHtml(appearance[field])}</code></label>`;
    const cssValue = appearance.customCss || (appearance.customCssCleared ? '' : BUILTIN_CUSTOM_CSS_TEMPLATE);
    return `<section class="tf-section-page"><header><div><h2>外观</h2><p>名称、字体、颜色和自定义 CSS 都会即时生效。</p></div></header>
        <section class="tf-card tf-settings-card"><header><div><h3>基础外观</h3><p>字体留空时自动跟随 SillyTavern。</p></div></header><div class="tf-form-grid"><label><span>论坛名称</span><input data-appearance="forumName" value="${escapeHtml(appearance.forumName)}" maxlength="30"></label><label><span>自定义字体</span><input data-appearance="fontFamily" value="${escapeHtml(appearance.fontFamily)}" placeholder="留空跟随酒馆；例：霞鹜文楷"></label>${colorField('primaryColor', '主题色')}${colorField('backgroundColor', '整体背景色')}${colorField('cardColor', '普通卡片色')}${colorField('textColor', '文字色')}</div></section>
        <section class="tf-card tf-settings-card"><header><div><h3>界面区域颜色</h3><p>可直接去掉原来的固定蓝色，不需要编写 CSS。</p></div></header><div class="tf-form-grid">${colorField('topNavColor', '顶部导航')}${colorField('sideNavColor', '左侧设置导航')}${colorField('activeNavColor', '选中导航项')}${colorField('postColor', '帖子卡片')}${colorField('commentColor', '评论区域')}</div></section>
        ${beforeCss}
        <section class="tf-card tf-settings-card"><header><div><h3>导入 CSS 美化</h3><p>模板已按全局、导航、帖子、评论、主页、私信、设置和手机端分区，可直接修改。</p></div><div class="tf-css-actions"><button class="tf-secondary-button" data-action="import-css">导入 CSS</button><button class="tf-secondary-button" data-action="restore-standard-css">恢复标准模板</button><button class="tf-danger-text" data-action="clear-css">清空</button></div></header><textarea class="tf-custom-css" data-appearance="customCss" rows="24" placeholder="#tavern-forum-root .tf-post { ... }">${escapeHtml(cssValue)}</textarea></section>
    </section>`;
}

function renderAppearanceSettings() {
    const settings = getSettings();
    const appearance = settings.appearance;
    const ui = settings.ui;
    const brandImage = renderStoredImage({ url: appearance.brandIconUrl, imageKey: appearance.brandIconKey, alt: '论坛名称图标' });
    const wallpaper = renderStoredImage({ url: appearance.wallpaperUrl, imageKey: appearance.wallpaperKey, alt: '论坛壁纸' });
    const launcherImage = renderStoredImage({ url: ui.floatingButtonImageUrl, imageKey: ui.floatingButtonImageKey, alt: '悬浮入口图片' });
    const visualSection = `<section class="tf-card tf-settings-card tf-visual-assets-settings"><header><div><h3>图标、壁纸与帖子毛玻璃</h3><p>透明度只作用于帖子和评论承载区；文字、头像、图标与照片始终保持清晰。</p></div></header><div class="tf-visual-assets-grid"><div><b>论坛名称图标</b><div class="tf-brand-icon-preview">${brandImage || '◎'}</div><label><span>图床直链</span><input data-appearance-image-url="brandIcon" value="${escapeHtml(appearance.brandIconKey ? '' : appearance.brandIconUrl)}" placeholder="https://example.com/icon.png"></label><div class="tf-image-source-row"><button class="tf-secondary-button" data-action="upload-brand-icon">导入本地图片</button><button class="tf-danger-text" data-action="clear-brand-icon">恢复默认</button></div></div><div><b>论坛壁纸</b><div class="tf-wallpaper-preview">${wallpaper || '<span>尚未设置壁纸</span>'}</div><label><span>图床直链</span><input data-appearance-image-url="wallpaper" value="${escapeHtml(appearance.wallpaperKey ? '' : appearance.wallpaperUrl)}" placeholder="https://example.com/wallpaper.jpg"></label><div class="tf-image-source-row"><button class="tf-secondary-button" data-action="upload-forum-wallpaper">导入本地图片</button><button class="tf-danger-text" data-action="clear-forum-wallpaper">清除壁纸</button></div></div></div><div class="tf-glass-controls"><label><span>帖子透明度 <output>${Math.round(Number(appearance.postOpacity ?? 0.85) * 100)}%</output></span><input type="range" min="0.2" max="1" step="0.01" value="${Number(appearance.postOpacity ?? 0.85)}" data-appearance-number="postOpacity"></label><label><span>评论透明度 <output>${Math.round(Number(appearance.commentOpacity ?? 0.94) * 100)}%</output></span><input type="range" min="0.2" max="1" step="0.01" value="${Number(appearance.commentOpacity ?? 0.94)}" data-appearance-number="commentOpacity"></label><label><span>帖子模糊强度 <output>${Number(appearance.postBlur ?? 16)}px</output></span><input type="range" min="0" max="40" step="1" value="${Number(appearance.postBlur ?? 16)}" data-appearance-number="postBlur"></label></div></section>`;
    const launcherSection = `<section class="tf-card tf-settings-card tf-launcher-settings"><header><div><h3>悬浮入口</h3><p>可显示或关闭，也可以更换图片。关闭后仍可从酒馆扩展菜单打开论坛。</p></div>${renderSwitch({ checked: ui.floatingButton, action: 'toggle-floating-button', label: '显示悬浮入口' })}</header><div class="tf-launcher-settings-body"><div class="tf-launcher-preview">${launcherImage || icon('message')}</div><div><label><span>图片图床直链</span><input data-floating-button-image-url value="${escapeHtml(ui.floatingButtonImageKey ? '' : ui.floatingButtonImageUrl)}" placeholder="https://example.com/forum-icon.png"></label><div class="tf-image-source-row"><button class="tf-secondary-button" data-action="upload-floating-button-image">导入本地图片</button><button class="tf-danger-text" data-action="clear-floating-button-image">恢复默认图标</button><button class="tf-secondary-button" data-action="reset-floating-button-position">恢复默认位置</button></div><small>关闭设置页后，可直接拖动页面上的悬浮入口改变位置；手机端也支持触摸拖动。</small></div></div></section>`;
    const page = renderAppearanceSettingsLegacy(visualSection);
    const end = page.lastIndexOf('</section>');
    const additions = launcherSection;
    return end === -1 ? `${page}${additions}` : `${page.slice(0, end)}${additions}${page.slice(end)}`;
}

function renderRuntimeBackend(data) {
    const logs = [...(data.generationLogs || [])].reverse();
    return `<section class="tf-section-page tf-runtime-page"><header><div><h2>运行后台</h2><p>查看论坛生成的原始输出、模型推理字段与真正的失败详情；这里的内容不会进入正文注入。</p></div><button class="tf-danger-text" data-action="clear-generation-logs" ${logs.length || data.lastGenerationTrace ? '' : 'disabled'}>清空记录</button></header><section class="tf-runtime-summary tf-card"><span><b>${logs.length}</b>最近记录</span><span><b>${logs.filter(log => log.status === 'success').length}</b>成功</span><span><b>${logs.filter(log => log.status === 'error').length}</b>失败</span><small>本地格式整理属于成功；最多保存 20 条，每次论坛生成最多调用一次文本 API。</small></section><div class="tf-runtime-list">${logs.length ? logs.map(log => `<details class="tf-runtime-entry tf-card is-${escapeHtml(log.status)}"><summary><i></i><div><b>${log.status === 'success' ? '成功' : '失败'}${log.locallyRepaired ? ' · 已本地整理' : ''}</b><span>${escapeHtml(new Date(log.createdAt).toLocaleString('zh-CN'))} · ${escapeHtml(log.provider)} / ${escapeHtml(log.model)}</span></div><em>${log.automatic ? '自动更新' : '手动生成'}${log.postCount ? ` · ${log.postCount} 篇` : ''}</em>${icon('chevron')}</summary><div class="tf-runtime-detail">${log.error ? `<section class="is-error"><h3>失败详情</h3><pre>${escapeHtml(log.error)}</pre></section>` : ''}${log.reasoning ? `<details><summary>模型返回的推理记录</summary><pre>${escapeHtml(log.reasoning)}</pre></details>` : ''}${log.output ? `<details><summary>模型原始输出</summary><pre>${escapeHtml(log.output)}</pre></details>` : ''}${!log.error && !log.reasoning && !log.output ? '<p>该次请求没有可显示的文本记录。</p>' : ''}</div></details>`).join('') : data.lastGenerationTrace ? `<details class="tf-runtime-entry tf-card"><summary><i></i><div><b>最近一次旧版记录</b><span>${data.lastGenerationAt ? escapeHtml(new Date(data.lastGenerationAt).toLocaleString('zh-CN')) : '时间未知'}</span></div>${icon('chevron')}</summary><div class="tf-runtime-detail"><section><h3>模型原始记录</h3><pre>${escapeHtml(data.lastGenerationTrace)}</pre></section></div></details>` : '<div class="tf-card tf-empty"><div class="tf-empty-icon">'+icon('database')+'</div><h3>后台还没有记录</h3><p>生成一次论坛动态后，成功记录或真正的失败详情会显示在这里。</p></div>'}</div></section>`;
}

function renderDataSettings() {
    const settings = getSettings();
    return `<section class="tf-section-page"><header><div><h2>数据</h2><p>导入、导出与清理微坛数据。</p></div></header><section class="tf-card tf-settings-card"><header><div><h3>界面入口</h3><p>控制右下角快捷按钮。</p></div>${renderSwitch({ checked: settings.ui.floatingButton, action: 'toggle-floating-button', label: '显示悬浮按钮' })}</header></section><section class="tf-card tf-data-actions"><button class="tf-secondary-button" data-action="export-forum">导出当前论坛 JSON</button><button class="tf-secondary-button" data-action="import-forum">导入论坛 JSON</button><button class="tf-danger-button" data-action="clear-data">清空微坛数据</button></section></section>`;
}

function renderNotificationSettings() {
    const settings = getSettings().notifications;
    return `<section class="tf-section-page"><header><div><h2>通知设置</h2><p>选择你希望在消息页收到哪些社交提醒。</p></div></header><section class="tf-card tf-settings-card"><header><div><h3>接收的消息类型</h3><p>关闭后只是不再产生该类新通知，不会删除旧通知。</p></div></header><div class="tf-notification-settings"><div>${renderSwitch({ checked: settings.reply, action: 'toggle-notification-reply', label: '别人回复了我的评论' })}<small>AI 角色跟帖回复你的评论时提醒。</small></div><div>${renderSwitch({ checked: settings.mention, action: 'toggle-notification-mention', label: '@提及了我' })}<small>帖子或评论中提及你的账号时提醒。</small></div><div>${renderSwitch({ checked: settings.like, action: 'toggle-notification-like', label: '赞了我的内容' })}<small>角色赞了你的帖子或评论时提醒。</small></div><div>${renderSwitch({ checked: settings.follow, action: 'toggle-notification-follow', label: '有人关注了我' })}<small>角色开始关注你的个人主页时提醒。</small></div><div>${renderSwitch({ checked: settings.mutual, action: 'toggle-notification-mutual', label: '成为互相关注' })}<small>你们双方都关注对方时提醒。</small></div><div>${renderSwitch({ checked: settings.system, action: 'toggle-notification-system', label: '系统通知' })}<small>数据迁移和功能状态等必要提醒。</small></div></div></section></section>`;
}

function renderBoundarySettings(data) {
    const settings = getSettings();
    const boundary = settings.informationBoundary;
    const visibilityOptions = selected => [['public', '公开：所有角色可知'], ['restricted', '指定角色可知'], ['private', '仅私信可使用'], ['forbidden', '任何生成都不可读']].map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
    const roleChecks = fact => `<div class="tf-boundary-roles">${data.npcs.map(npc => `<label><input type="checkbox" data-fact-known-role="${escapeHtml(fact.id)}" data-role-id="${escapeHtml(npc.id)}" ${(fact.knownBy || []).includes(npc.id) ? 'checked' : ''}>${escapeHtml(npc.name)}</label>`).join('') || '<small>暂无角色</small>'}</div>`;
    const world = viewState.worldCatalog.length ? `<div class="tf-world-boundaries">${viewState.worldCatalog.map(book => `<details><summary>${escapeHtml(book.name)}</summary>${book.entries.map(entry => {
        const policy = boundary.worldInfoEntries[entry.key] || { visibility: 'public', knownBy: [] };
        return `<div class="tf-world-boundary-row"><div><b>${escapeHtml(entry.title)}</b><small>${escapeHtml(entry.content.slice(0, 80))}</small></div><select data-world-boundary="${escapeHtml(entry.key)}">${visibilityOptions(policy.visibility)}</select><input data-world-boundary-roles="${escapeHtml(entry.key)}" value="${escapeHtml((policy.knownBy || []).map(id => data.npcs.find(npc => npc.id === id)?.handle || id).join(', '))}" placeholder="指定角色账号，逗号分隔"></div>`;
    }).join('')}</details>`).join('')}</div>` : '<p class="tf-empty-mini">点击“读取世界书边界”后，可逐条设置公开范围。</p>';
    return `<section class="tf-section-page"><header><div><h2>信息边界</h2><p>控制每条事实由谁知道；角色之间私信默认关闭且永不注入公共正文。</p></div><button class="tf-secondary-button" data-action="refresh-world-info">读取世界书边界</button></header><section class="tf-card tf-settings-card"><header><div><h3>总开关</h3><p>关闭信息边界只建议用于测试。</p></div></header><div class="tf-notification-settings"><div>${renderSwitch({ checked: boundary.enabled, action: 'toggle-information-boundary', label: '启用角色知识隔离' })}<small>公开生成只读取公开事实；私信按参与者过滤。</small></div><div>${renderSwitch({ checked: settings.social.roleDirectMessages, action: 'toggle-role-direct-messages', label: '允许角色之间私信' })}<small>开启后，用户可创建 A ↔ B 私密会话并决定下一位发言者。</small></div></div></section><section class="tf-card tf-settings-card"><header><div><h3>事实库</h3><p>把容易泄露的秘密或认知差异拆成单独事实。</p></div></header><div class="tf-boundary-add"><input id="tf-new-fact" placeholder="例如：A 已经知道钥匙藏在书房"><select id="tf-new-fact-visibility">${visibilityOptions('restricted')}</select><button class="tf-primary-button" data-action="add-fact">新增事实</button></div><div class="tf-fact-list">${data.facts.length ? data.facts.map(fact => `<article class="tf-fact" data-fact-id="${escapeHtml(fact.id)}"><textarea data-fact-content rows="2">${escapeHtml(fact.content)}</textarea><div><select data-fact-visibility>${visibilityOptions(fact.visibility)}</select>${renderSwitch({ checked: fact.publishable, action: 'toggle-fact-publishable', label: '允许公开发布' })}<button class="tf-icon-button" data-action="delete-fact" data-fact-id="${escapeHtml(fact.id)}">${icon('trash')}</button></div>${['restricted', 'private'].includes(fact.visibility) ? roleChecks(fact) : ''}</article>`).join('') : '<p class="tf-empty-mini">还没有手动事实。公开正文仍按原有读取开关工作。</p>'}</div></section><section class="tf-card tf-settings-card"><header><div><h3>世界书条目的知识边界</h3><p>“指定角色/仅私信”的角色用账号填写；未设置时默认公开。</p></div></header>${world}</section></section>`;
}

function renderMe(data) {
    const section = getSettings().ui.meSection || 'overview';
    const pages = {
        overview: () => renderMeOverview(data), favorites: () => renderFavorites(data), npcs: () => renderNpcs(data),
        memory: () => renderRoleMemoryPage(data), privacyRelations: () => renderPrivacyRelations(data),
        prompts: renderPrompts, api: renderApiSettings, sources: renderSourcesSettings,
        boundaries: () => renderBoundarySettings(data), appearance: renderAppearanceSettings, notifications: renderNotificationSettings, runtime: () => renderRuntimeBackend(data), data: renderDataSettings,
    };
    return `<div class="tf-me-page">${renderMeNav()}<div class="tf-me-content">${(pages[section] || pages.overview)()}</div></div>`;
}

function renderMain(data) {
    if (viewState.selectedPostId) return renderPostDetail(data, data.posts.find(post => post.id === viewState.selectedPostId));
    if (viewState.publicNpcId) {
        const npc = data.npcs.find(item => item.id === viewState.publicNpcId);
        if (npc) return renderPublicNpcProfile(data, npc);
        viewState.publicNpcId = '';
    }
    const tab = getSettings().ui.activeTab;
    if (tab === 'messages') return renderMessages(data);
    if (tab === 'me') return renderMe(data);
    return renderHome(data);
}

function renderMainNav() {
    const tab = getSettings().ui.activeTab;
    const unread = getForumData().notifications.filter(item => !item.read && !npcForId(item.actorNpcId)?.blocked).length;
    return `<nav class="tf-main-nav"><button class="${tab === 'home' ? 'is-active' : ''}" data-action="switch-tab" data-tab="home">${icon('home')}<span>首页</span></button><button class="${tab === 'messages' ? 'is-active' : ''}" data-action="switch-tab" data-tab="messages">${icon('message')}<span>消息</span>${unread ? `<i class="tf-nav-badge">${unread > 99 ? '99+' : unread}</i>` : ''}</button><button class="${tab === 'me' ? 'is-active' : ''}" data-action="switch-tab" data-tab="me">${icon('user')}<span>我</span></button></nav>`;
}

function renderShellLegacy() {
    const settings = getSettings();
    const data = getForumData();
    if (hasActiveChat()) {
        const before = data.npcs.length;
        ensureCharacterRole(data, getChatSnapshot());
        if (data.npcs.length !== before) void saveForumData(data, true);
    }
    const tab = settings.ui.activeTab;
    const searchPlaceholder = tab === 'messages' ? '搜索联系人' : tab === 'home' ? '搜索帖子、用户或话题' : '搜索仅在首页和消息中显示';
    return `<div class="tf-backdrop" data-action="close"></div><section class="tf-app" data-tf-version="5"><header class="tf-topbar"><button class="tf-brand" data-action="switch-tab" data-tab="home"><span class="tf-brand-mark">◎</span><b class="tf-brand-name">${escapeHtml(settings.appearance.forumName)}</b></button><label class="tf-search"><span>${icon('search')}</span><input class="tf-search-input" value="${escapeHtml(viewState.searchQuery)}" placeholder="${searchPlaceholder}" ${tab === 'me' ? 'disabled' : ''}></label>${renderMainNav()}<div class="tf-top-actions"><button class="tf-injection-dot ${settings.injection.enabled ? 'is-on' : ''}" data-action="go-injection-settings" title="${settings.injection.enabled ? '注入已开启' : '注入未开启'}" aria-label="注入状态"></button><button class="tf-close" data-action="close" title="关闭">${icon('close')}</button></div></header><main class="tf-view">${renderMain(data)}</main><div class="tf-mobile-main-nav">${renderMainNav()}</div><input id="tf-import-prompts-file" type="file" accept="application/json,.json" hidden><input id="tf-import-forum-file" type="file" accept="application/json,.json" hidden><input id="tf-import-css-file" type="file" accept="text/css,.css" hidden><input id="tf-import-profile-avatar-file" type="file" accept="image/*" hidden><input id="tf-import-profile-background-file" type="file" accept="image/*" hidden><input id="tf-import-avatar-library-file" type="file" accept="image/*" hidden><input id="tf-import-npc-avatar-file" type="file" accept="image/*" hidden></section>`;
}

function renderShell() {
    const settings = getSettings();
    const brandImage = renderStoredImage({ url: settings.appearance.brandIconUrl, imageKey: settings.appearance.brandIconKey, alt: `${settings.appearance.forumName} 图标`, className: 'tf-brand-icon-image' });
    const wallpaper = renderStoredImage({ url: settings.appearance.wallpaperUrl, imageKey: settings.appearance.wallpaperKey, alt: '论坛壁纸', className: 'tf-wallpaper-image' });
    const shell = renderShellLegacy()
        .replace('data-tf-version="5"', 'data-tf-version="7"')
        .replace(/<span class="tf-brand-mark">.*?<\/span>/, `<span class="tf-brand-mark">${brandImage || '◎'}</span>`)
        .replace(/(<section class="tf-app"[^>]*>)/, `$1<div class="tf-wallpaper">${wallpaper}</div>`);
    return wallpaper ? shell.replace('class="tf-app"', 'class="tf-app has-wallpaper"') : shell;
}

function colorWithOpacity(color, opacity) {
    const value = String(color || '').trim();
    const match = /^#([\da-f]{6})$/i.exec(value);
    if (!match) return value;
    const integer = Number.parseInt(match[1], 16);
    const alpha = Math.min(1, Math.max(0.15, Number(opacity) || 0.92));
    return `rgb(${(integer >> 16) & 255} ${(integer >> 8) & 255} ${integer & 255} / ${alpha})`;
}

function applyAppearance() {
    const settings = getSettings();
    const root = getRoot();
    if (root) {
        root.style.setProperty('--tf-primary', settings.appearance.primaryColor);
        root.style.setProperty('--tf-bg', settings.appearance.backgroundColor);
        root.style.setProperty('--tf-card', settings.appearance.cardColor);
        root.style.setProperty('--tf-text', settings.appearance.textColor);
        root.style.setProperty('--tf-font', settings.appearance.fontFamily ? settings.appearance.fontFamily : 'inherit');
        root.style.setProperty('--tf-top-nav-bg', settings.appearance.topNavColor);
        root.style.setProperty('--tf-side-nav-bg', settings.appearance.sideNavColor);
        root.style.setProperty('--tf-nav-active-bg', settings.appearance.activeNavColor);
        root.style.setProperty('--tf-nav-border', settings.appearance.navDividerColor);
        root.style.setProperty('--tf-post-bg', colorWithOpacity(settings.appearance.postColor, settings.appearance.postOpacity));
        root.style.setProperty('--tf-comment-bg', colorWithOpacity(settings.appearance.commentColor, settings.appearance.commentOpacity));
        root.style.setProperty('--tf-post-solid', settings.appearance.postColor);
        root.style.setProperty('--tf-comment-solid', settings.appearance.commentColor);
        root.style.setProperty('--tf-post-blur', `${Math.min(40, Math.max(0, Number(settings.appearance.postBlur) || 0))}px`);
    }
    let custom = document.getElementById(CUSTOM_STYLE_ID);
    if (!custom) {
        custom = document.createElement('style');
        custom.id = CUSTOM_STYLE_ID;
        document.head.append(custom);
    }
    custom.textContent = settings.appearance.customCss || (settings.appearance.customCssCleared ? '' : BUILTIN_CUSTOM_CSS_TEMPLATE);
}

function applySearchFilter() {
    const query = viewState.searchQuery.trim().toLocaleLowerCase();
    const tab = getSettings().ui.activeTab;
    const selector = tab === 'messages' ? '[data-contact-search]' : '[data-search-text]';
    let visible = 0;
    getRoot()?.querySelectorAll(selector).forEach(element => {
        const text = tab === 'messages' ? element.dataset.contactSearch : element.dataset.searchText;
        const matches = !query || String(text || '').includes(query);
        element.toggleAttribute('hidden', !matches);
        if (matches) visible += 1;
    });
    const label = getRoot()?.querySelector('[data-search-count]');
    if (label) label.textContent = String(visible);
}

function render() {
    const root = getRoot();
    if (!root) return;
    root.innerHTML = renderShell();
    if (!root.querySelector('#tf-import-npc-background-file')) root.insertAdjacentHTML('beforeend', '<input id="tf-import-npc-background-file" type="file" accept="image/*" hidden>');
    if (!root.querySelector('#tf-import-floating-button-file')) root.insertAdjacentHTML('beforeend', '<input id="tf-import-floating-button-file" type="file" accept="image/*" hidden>');
    if (!root.querySelector('#tf-import-brand-icon-file')) root.insertAdjacentHTML('beforeend', '<input id="tf-import-brand-icon-file" type="file" accept="image/*" hidden>');
    if (!root.querySelector('#tf-import-forum-wallpaper-file')) root.insertAdjacentHTML('beforeend', '<input id="tf-import-forum-wallpaper-file" type="file" accept="image/*" hidden>');
    root.toggleAttribute('hidden', !viewState.open);
    document.body.classList.toggle('tf-modal-open', viewState.open);
    applyAppearance();
    applySearchFilter();
    updateLaunchers();
    if (getSettings().ui.activeTab === 'me' && getSettings().ui.meSection === 'sources') void refreshInjectionTokenCount();
    void hydrateImages();
    queueMicrotask(() => {
        const messages = root.querySelector('.tf-dm-messages');
        if (messages) messages.scrollTop = messages.scrollHeight;
    });
}

async function refreshInjectionTokenCount() {
    if (viewState.injectionTokens.loading) return;
    viewState.injectionTokens.loading = true;
    try {
        const { forumValue, npcValue } = syncInjection();
        const context = globalThis.SillyTavern?.getContext?.();
        const count = async value => {
            if (!value) return 0;
            if (typeof context?.getTokenCountAsync === 'function') return Number(await context.getTokenCountAsync(value) || 0);
            return Math.ceil(Array.from(value).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 1 : 0.28), 0));
        };
        const [forum, roles, total] = await Promise.all([count(forumValue), count(npcValue), count([forumValue, npcValue].filter(Boolean).join('\n'))]);
        viewState.injectionTokens = { total, forum, roles, loading: false };
        const root = getRoot();
        root?.querySelector('[data-injection-token-total]')?.replaceChildren(`${numberLabel(total)} Tokens`);
        root?.querySelector('[data-injection-token-parts]')?.replaceChildren(`帖子 ${numberLabel(forum)} · 角色人设 ${numberLabel(roles)}`);
        const meter = root?.querySelector('.tf-token-meter');
        const budget = Number(getSettings().injection.tokenBudget || 2000);
        meter?.classList.toggle('is-over', total > budget);
        const progress = meter?.querySelector('progress');
        if (progress) { progress.max = budget; progress.value = Math.min(total, budget); }
    } catch (error) {
        viewState.injectionTokens.loading = false;
        console.warn('[微坛] 注入 Token 统计失败', error);
    }
}

async function hydrateImages() {
    const localforage = globalThis.SillyTavern?.libs?.localforage;
    if (!localforage) return;
    for (const image of document.querySelectorAll(`#${ROOT_ID} img[data-image-key], #${FAB_ID} img[data-image-key]`)) {
        const key = image.dataset.imageKey;
        try {
            const value = imageMemory.get(key) || await localforage.getItem(key);
            if (!value) { image.closest('.tf-image-loading')?.remove(); continue; }
            imageMemory.set(key, value);
            image.src = value;
            image.closest('.tf-image-loading')?.classList.add('is-loaded');
        } catch (error) {
            console.warn('[微坛] 读取图片失败', error);
        }
    }
}

function setActiveTab(tab) {
    if (!['home', 'messages', 'me'].includes(tab)) tab = 'home';
    getSettings().ui.activeTab = tab;
    viewState.selectedPostId = '';
    viewState.publicNpcId = '';
    viewState.searchQuery = '';
    if (tab === 'messages') prepareConversations(getForumData());
    saveSettings();
    render();
}

function setMeSection(section) {
    getSettings().ui.activeTab = 'me';
    getSettings().ui.meSection = section;
    viewState.selectedPostId = '';
    viewState.publicNpcId = '';
    saveSettings();
    render();
    if (['sources', 'boundaries'].includes(section) && !viewState.worldCatalog.length) void refreshWorldCatalog();
}

function findPost(postId) {
    return getForumData().posts.find(post => post.id === postId);
}

async function removePostImages(posts) {
    for (const post of posts || []) {
        const keys = [post.imageKey, ...(post.comments || []).map(comment => comment.imageKey)].filter(Boolean);
        for (const key of keys) {
            await globalThis.SillyTavern?.libs?.localforage?.removeItem(key);
            imageMemory.delete(key);
        }
    }
}

async function enforcePostRetention(data, force = false) {
    const settings = getSettings();
    if (!force && !settings.retention.autoCleanup) return 0;
    const result = prunePosts(data.posts, settings.retention.maxPosts);
    if (!result.removed.length) return 0;
    await removePostImages(result.removed);
    data.posts = result.posts;
    return result.removed.length;
}

async function refreshWorldCatalog(showNotice = false) {
    if (viewState.worldLoading) return;
    viewState.worldLoading = true;
    render();
    try {
        viewState.worldCatalog = await getWorldInfoCatalog();
        if (showNotice) notify('success', `已读取 ${viewState.worldCatalog.reduce((sum, book) => sum + book.entries.length, 0)} 条世界书条目`);
    } catch (error) {
        notify('error', `世界书读取失败：${error.message}`);
    } finally {
        viewState.worldLoading = false;
        render();
    }
}

function addMentionNotifications(data, posts) {
    if (!getSettings().notifications.mention) return;
    const myHandle = String(getSettings().profile.handle || 'me').replace(/^@/, '').toLocaleLowerCase();
    for (const post of posts || []) {
        const items = [post, ...(post.comments || [])];
        for (const item of items) {
            if (!extractMentions(item.content).includes(myHandle) || isMyHandle(item.handle)) continue;
            const npc = data.npcs.find(role => role.id === item.npcId);
            if (npc?.muted || npc?.blocked) continue;
            data.notifications.unshift(createNotification({ type: 'mention', actorNpcId: item.npcId, actorName: item.author, postId: post.id, content: `${item.author} 在${item === post ? '帖子' : '评论'}中提及了你：${item.content}` }));
        }
    }
}

async function runGeneration({ automatic = false } = {}) {
    if (viewState.busy) return;
    if (!hasActiveChat()) {
        if (!automatic) notify('warning', '请先打开一个角色聊天');
        return;
    }
    viewState.busy = true;
    render();
    let result = null;
    let raw = '';
    let textConfig = null;
    let logEntry = null;
    let generationComplete = false;
    try {
        const settings = getSettings();
        const data = getForumData();
        const request = buildForumGenerationRequest({ ...getChatSnapshot(), settings, existingPosts: data.posts, sourceContext: await getGenerationSourceContext(), excludedRoles: data.npcs.filter(npc => npc.blocked) });
        textConfig = getApiConfig('text');
        result = await generateForumTextResult(textConfig, request, { captureTrace: true });
        raw = result.text;
        let generated;
        let repairedFormat = false;
        try {
            generated = normalizeGeneratedForum(raw);
        } catch (firstError) {
            try {
                generated = recoverGeneratedForum(raw, Date.now(), [result.reasoning]);
                repairedFormat = true;
                console.info('[微坛] 已在本地整理模型格式并读取完整帖子；没有再次调用 API。', firstError);
            } catch (localError) {
                console.error('[微坛] 模型内容无法在本地恢复。', firstError, localError, raw);
                throw localError;
            }
        }
        const postsMaximum = Math.max(1, Math.min(10, Number(settings.generation.postsMax || 5)));
        const commentsMaximum = Math.max(0, Math.min(8, Number(settings.generation.commentsMax ?? 3)));
        generated.posts = generated.posts.slice(0, postsMaximum);
        const isBlockedAuthor = author => data.npcs.some(npc => npc.blocked && (
            (String(npc.handle || '').replace(/^@/, '').toLocaleLowerCase() === String(author?.handle || '').replace(/^@/, '').toLocaleLowerCase())
            || (String(npc.name || '').trim() && String(npc.name || '').trim() === String(author?.author || author?.name || '').trim())
        ));
        generated.posts = generated.posts.filter(post => !isBlockedAuthor(post));
        for (const post of generated.posts) post.comments = (post.comments || []).filter(comment => !isBlockedAuthor(comment)).slice(0, commentsMaximum);
        if (!generated.posts.length) throw new Error('模型只返回了已拉黑角色的内容，请重新刷新论坛');
        data.topic = generated.topic;
        data.lastGenerationTrace = buildGenerationTrace(raw, result.reasoning);
        data.lastGenerationAt = Date.now();
        advanceSocialEngagement(data.posts);
        connectGeneratedReposts(data.posts, generated.posts);
        data.posts.push(...generated.posts);
        linkNpcAuthors(data, generated.posts);
        addMentionNotifications(data, generated.posts);
        const removed = await enforcePostRetention(data);
        logEntry = appendGenerationLog(data, {
            status: 'success',
            locallyRepaired: repairedFormat,
            automatic,
            provider: textConfig.provider,
            model: textConfig.provider === 'sillytavern' ? '酒馆当前模型' : textConfig.model,
            postCount: generated.posts.length,
            reasoning: result.reasoning,
            output: raw,
        });
        await saveForumData(data, true);
        syncInjection();
        notify('success', `${automatic ? '论坛已自动更新' : `已生成 ${generated.posts.length} 篇动态`}${removed ? `，清理 ${removed} 篇旧帖` : ''}`);
        generationComplete = true;
        if (getApiConfig('image').autoGenerate) {
            const target = generated.posts.find(post => post.imagePrompt);
            if (target) await runImageGeneration(target.id, false);
            else {
                const postWithCommentImage = generated.posts.find(post => post.comments?.some(comment => comment.imagePrompt));
                const comment = postWithCommentImage?.comments.find(item => item.imagePrompt);
                if (postWithCommentImage && comment) await runCommentImageGeneration(postWithCommentImage.id, comment.id, false);
            }
        }
    } catch (error) {
        console.error('[微坛] 生成失败', error);
        if (!generationComplete) {
            const data = getForumData();
            if (logEntry) {
                logEntry.status = 'error';
                logEntry.error = String(error?.stack || error?.message || error || '生成失败').slice(0, 10000);
            } else {
                logEntry = appendGenerationLog(data, {
                    status: 'error',
                    automatic,
                    provider: textConfig?.provider || 'unknown',
                    model: textConfig?.provider === 'sillytavern' ? '酒馆当前模型' : textConfig?.model,
                    reasoning: result?.reasoning,
                    output: raw,
                    error: error?.stack || error?.message || error,
                });
            }
            data.lastGenerationTrace = buildGenerationTrace(raw, result?.reasoning);
            data.lastGenerationAt = Date.now();
            try { await saveForumData(data, true); } catch (saveError) { console.error('[微坛] 无法保存运行后台记录', saveError); }
        }
        notify('error', `${automatic ? '论坛自动更新失败' : '论坛生成失败'}，详情已保存到“我 → 运行后台”`);
    } finally {
        viewState.busy = false;
        render();
    }
}

async function runThreadContinuation(postId, userComment) {
    const post = findPost(postId);
    if (!post || viewState.replyingPosts.has(postId)) return;
    viewState.replyingPosts.add(postId);
    render();
    try {
        const data = getForumData();
        const request = buildThreadReplyRequest({ post, userComment, npcs: data.npcs, sourceContext: await getGenerationSourceContext(), settings: getSettings() });
        const replyMaximum = Math.max(1, Math.min(8, Number(getSettings().generation.repliesMax || 3)));
        const replies = normalizeThreadReplies(await generateForumText(getApiConfig('text'), request)).filter(reply => !data.npcs.some(npc => npc.blocked && (
            String(npc.handle || '').replace(/^@/, '').toLocaleLowerCase() === String(reply.handle || '').replace(/^@/, '').toLocaleLowerCase()
            || (String(npc.name || '').trim() && String(npc.name || '').trim() === String(reply.author || '').trim())
        ))).slice(0, replyMaximum);
        for (const reply of replies) {
            const targetComment = [...post.comments].reverse().find(comment => String(comment.handle || '').replace(/^@/, '').toLocaleLowerCase() === String(reply.replyTo || '').toLocaleLowerCase());
            reply.parentId = reply.parentId || targetComment?.id || userComment?.id || '';
        }
        post.comments.push(...replies);
        linkNpcAuthors(data, [{ ...post, comments: replies }]);
        if (getSettings().notifications.reply) {
            for (const reply of replies) {
                data.notifications.unshift(createNotification({
                    type: 'reply',
                    actorNpcId: reply.npcId,
                    actorName: reply.author,
                    postId: post.id,
                    content: `${reply.author} 回复了你的评论：${reply.content}`,
                }));
            }
        }
        addMentionNotifications(data, [{ ...post, comments: replies }]);
        if (getSettings().notifications.like && userComment && replies[0]) {
            userComment.likes = Number(userComment.likes || 0) + 1;
            data.notifications.unshift(createNotification({ type: 'like', actorNpcId: replies[0].npcId, actorName: replies[0].author, postId: post.id, content: `${replies[0].author} 赞了你的评论` }));
        }
        await saveForumData(data, true);
        syncInjection();
    } catch (error) {
        notify('error', `你的评论已保存，但 AI 续回复失败：${error.message}`);
    } finally {
        viewState.replyingPosts.delete(postId);
        render();
    }
}

async function runNpcProfileGeneration(npcId) {
    const data = getForumData();
    const npc = data.npcs.find(item => item.id === npcId);
    if (!npc || viewState.npcBusy.has(npcId)) return;
    viewState.npcBusy.add(npcId);
    render();
    try {
        const evidence = collectNpcEvidence(data, npcId);
        if (npc.bindingContent) evidence.push(`绑定资料（${npc.bindingLabel || '已绑定'}）：${npc.bindingContent}`);
        const request = buildNpcProfileRequest({ npc, evidence, sourceContext: await getGenerationSourceContext() });
        applyNpcProfile(npc, normalizeNpcProfile(await generateForumText(getApiConfig('text'), request)));
        await saveForumData(data, true);
        syncInjection();
        notify('success', `${npc.name} 的主页与人设已生成`);
    } catch (error) {
        notify('error', `角色人设生成失败：${error.message}`);
    } finally {
        viewState.npcBusy.delete(npcId);
        render();
    }
}

async function runImageGeneration(postId, rerender = true) {
    const post = findPost(postId);
    if (!post || viewState.imageBusy.has(postId)) return;
    let promptText = String(post.imagePrompt || '').trim();
    if (promptText && !/[\u3400-\u9fff]/u.test(promptText)) {
        promptText = localizedImagePrompt(post);
        post.imagePrompt = promptText;
    }
    if (!promptText) {
        promptText = window.prompt('请输入配图画面描述：', post.content.slice(0, 200))?.trim() || '';
        if (!promptText) return;
        post.imagePrompt = promptText;
    }
    const config = getApiConfig('image');
    if (!hasUsableImageApi(config)) {
        await saveForumData(getForumData(), true);
        notify(config.textFallback ? 'success' : 'warning', config.textFallback ? '已使用文字配图' : '请先开启生图 API 或文字配图');
        if (rerender) render();
        return;
    }
    viewState.imageBusy.add(postId);
    if (rerender) render();
    try {
        const image = await generateForumImage(config, promptText);
        if (post.imageKey) await globalThis.SillyTavern?.libs?.localforage?.removeItem(post.imageKey);
        if (image.type === 'base64') {
            const key = `tavern-forum:image:${post.id}`;
            if (!globalThis.SillyTavern?.libs?.localforage) throw new Error('当前酒馆不支持本地图片存储');
            await globalThis.SillyTavern.libs.localforage.setItem(key, image.value);
            imageMemory.set(key, image.value);
            post.imageKey = key;
            post.imageUrl = '';
        } else {
            post.imageUrl = image.value;
            post.imageKey = '';
        }
        await saveForumData(getForumData(), true);
    } catch (error) {
        notify('error', error.message || '生图失败');
    } finally {
        viewState.imageBusy.delete(postId);
        if (rerender) render();
    }
}

async function runCommentImageGeneration(postId, commentId, rerender = true) {
    const post = findPost(postId);
    const comment = post?.comments?.find(item => item.id === commentId);
    const busyKey = `comment-${commentId}`;
    if (!comment || viewState.imageBusy.has(busyKey)) return;
    let promptText = String(comment.imagePrompt || '').trim();
    if (promptText && !/[\u3400-\u9fff]/u.test(promptText)) {
        promptText = localizedImagePrompt(comment);
        comment.imagePrompt = promptText;
    }
    if (!promptText) {
        promptText = window.prompt('请输入评论配图画面描述：', comment.content.slice(0, 200))?.trim() || '';
        if (!promptText) return;
        comment.imagePrompt = promptText;
    }
    const config = getApiConfig('image');
    if (!hasUsableImageApi(config)) {
        await saveForumData(getForumData(), true);
        notify(config.textFallback ? 'success' : 'warning', config.textFallback ? '已使用文字配图' : '请先开启生图 API 或文字配图');
        if (rerender) render();
        return;
    }
    viewState.imageBusy.add(busyKey);
    if (rerender) render();
    try {
        const image = await generateForumImage(config, promptText);
        if (comment.imageKey) await globalThis.SillyTavern?.libs?.localforage?.removeItem(comment.imageKey);
        if (image.type === 'base64') {
            const key = `tavern-forum:comment-image:${comment.id}`;
            if (!globalThis.SillyTavern?.libs?.localforage) throw new Error('当前酒馆不支持本地图片存储');
            await globalThis.SillyTavern.libs.localforage.setItem(key, image.value);
            imageMemory.set(key, image.value);
            comment.imageKey = key;
            comment.imageUrl = '';
        } else {
            comment.imageUrl = image.value;
            comment.imageKey = '';
        }
        await saveForumData(getForumData(), true);
    } catch (error) {
        notify('error', error.message || '评论生图失败');
    } finally {
        viewState.imageBusy.delete(busyKey);
        if (rerender) render();
    }
}

async function sendDirectMessage(conversationId, content) {
    const data = getForumData();
    const conversation = data.conversations.find(item => item.id === conversationId);
    if (!conversation || viewState.dmBusy) return;
    if (!isConversationAllowed(data, conversation)) return notify('warning', '已拉黑的角色不能继续私信');
    const clean = String(content || '').trim();
    if (!clean) return;
    conversation.messages.push({ id: createId('dm'), role: 'user', content: clean, createdAt: Date.now() });
    conversation.updatedAt = Date.now();
    await saveForumData(data, true);
    render();
}

async function runDirectMessageReply(conversationId) {
    const data = getForumData();
    const conversation = data.conversations.find(item => item.id === conversationId);
    if (!conversation || viewState.dmBusy) return;
    if (!isConversationAllowed(data, conversation)) return notify('warning', '已拉黑的角色不能继续私信');
    if (!(conversation.messages || []).length) return notify('warning', '请先发送一条私信，再让角色回复');
    viewState.dmBusy = true;
    render();
    try {
        const baseNpc = conversation.type === 'npc' ? data.npcs.find(item => item.id === conversation.targetId) : null;
        const npc = baseNpc ? { ...baseNpc, persona: [baseNpc.persona, baseNpc.bindingContent].filter(Boolean).join('\n绑定资料：') } : null;
        const charRole = conversation.type === 'char' ? data.npcs.find(item => item.bindingType === 'char' && item.bindingTarget === conversation.targetId) : null;
        const scopedRole = baseNpc || charRole;
        const request = buildDirectMessageRequest({ conversation, messages: conversation.messages, npc, sourceContext: scopedRole ? await getRoleScopedSourceContext(scopedRole.id) : await getGenerationSourceContext(), userName: getChatSnapshot().names.user || 'User' });
        const reply = normalizeDirectMessage(await generateForumText(getApiConfig('text'), request));
        conversation.messages.push({ id: createId('dm'), role: 'assistant', content: reply, createdAt: Date.now() });
        if (scopedRole) {
            const lastUserMessage = [...conversation.messages].reverse().find(message => message.role === 'user')?.content || '';
            scopedRole.memory.privateTalks.push(`与用户私信：用户说“${lastUserMessage}”；${scopedRole.name}回复“${reply}”`);
            scopedRole.memory.privateTalks = scopedRole.memory.privateTalks.slice(-80);
        }
        conversation.updatedAt = Date.now();
        await saveForumData(data, true);
    } catch (error) {
        notify('error', `AI 回复生成失败：${error.message}`);
    } finally {
        viewState.dmBusy = false;
        render();
    }
}

async function runRoleDirectMessage(conversationId, speakerId, direction = '') {
    if (!getSettings().social.roleDirectMessages) return notify('warning', '角色之间私信当前已关闭');
    const data = getForumData();
    const conversation = data.conversations.find(item => item.id === conversationId && item.type === 'role_dm');
    if (!conversation || viewState.dmBusy) return;
    const speaker = data.npcs.find(npc => npc.id === speakerId && conversation.participantIds.includes(npc.id));
    const otherRole = data.npcs.find(npc => conversation.participantIds.includes(npc.id) && npc.id !== speaker?.id);
    if (!speaker || !otherRole || speaker.blocked || otherRole.blocked) return notify('warning', '私信参与者不存在或已被拉黑');
    viewState.dmBusy = true;
    render();
    try {
        const request = buildRoleDirectMessageRequest({ conversation, messages: conversation.messages, speaker, otherRole, sourceContext: await getRoleScopedSourceContext(speaker.id, { channel: 'private', otherRoleId: otherRole.id }), direction });
        const reply = normalizeDirectMessage(await generateForumText(getApiConfig('text'), request));
        conversation.messages.push({ id: createId('dm'), role: 'assistant', senderNpcId: speaker.id, senderName: speaker.name, content: reply, private: true, createdAt: Date.now() });
        conversation.updatedAt = Date.now();
        const memoryLine = `与${otherRole.name}的私信：${speaker.name}说“${reply}”`;
        for (const npc of [speaker, otherRole]) {
            npc.memory.privateTalks.push(memoryLine);
            npc.memory.privateTalks = npc.memory.privateTalks.slice(-80);
            npc.updatedAt = Date.now();
        }
        await saveForumData(data, true);
    } catch (error) {
        notify('error', `角色私信生成失败：${error.message}`);
    } finally {
        viewState.dmBusy = false;
        render();
    }
}

function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFile(input) {
    const file = input.files?.[0];
    input.value = '';
    return file ? file.text() : Promise.resolve(null);
}

async function readImageAsset(input, prefix) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return null;
    if (!String(file.type || '').startsWith('image/')) throw new Error('请选择图片文件');
    if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10MB');
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
    });
    const localforage = globalThis.SillyTavern?.libs?.localforage;
    if (!localforage) return { url: dataUrl, imageKey: '', name: file.name };
    const imageKey = `tavern-forum:asset:${prefix}:${createId('image')}`;
    await localforage.setItem(imageKey, dataUrl);
    imageMemory.set(imageKey, dataUrl);
    return { url: '', imageKey, name: file.name };
}

async function removeImageAsset(imageKey) {
    if (!imageKey) return;
    await globalThis.SillyTavern?.libs?.localforage?.removeItem(imageKey);
    imageMemory.delete(imageKey);
}

function updateNpcAvatar(npc, { url = '', imageKey = '', avatarId = '' } = {}) {
    if (!npc) return;
    npc.avatarUrl = url;
    npc.avatarKey = imageKey;
    npc.avatarId = avatarId;
    npc.avatarCustomized = true;
    npc.updatedAt = Date.now();
    for (const conversation of getForumData().conversations.filter(item => item.type === 'npc' && item.targetId === npc.id)) {
        conversation.avatarUrl = url;
        conversation.avatarKey = imageKey;
    }
}

function applyNpcBinding(npc, type, targetId = '') {
    npc.bindingType = ['char', 'world'].includes(type) ? type : 'none';
    npc.bindingTarget = targetId;
    npc.bindingLabel = '';
    npc.bindingContent = '';
    if (npc.bindingType === 'char') {
        const character = getCharacterCatalog().find(item => item.id === targetId);
        if (character) {
            npc.bindingLabel = character.name;
            npc.bindingContent = character.persona;
            if (character.avatarUrl && !npc.avatarCustomized) npc.avatarUrl = character.avatarUrl;
        }
    } else if (npc.bindingType === 'world') {
        for (const book of viewState.worldCatalog) {
            const entry = book.entries.find(item => item.key === targetId);
            if (!entry) continue;
            npc.bindingLabel = `${book.name} · ${entry.title}`;
            npc.bindingContent = entry.content;
            break;
        }
    }
    npc.updatedAt = Date.now();
}

function getSettingByPath(path) {
    return path.split('.').reduce((value, key) => value?.[key], getSettings());
}

function setSettingByPath(path, value) {
    const parts = path.split('.');
    const key = parts.pop();
    const parent = parts.reduce((target, part) => target[part], getSettings());
    parent[key] = value;
    saveSettings();
    if (path.startsWith('injection.')) syncInjection();
}

function handleSwitchAction(action, checked) {
    const paths = {
        'toggle-master-injection': 'injection.enabled', 'toggle-include-comments': 'injection.includeComments',
        'toggle-npc-master-injection': 'injection.npcEnabled', 'toggle-source-chat': 'sources.chat',
        'toggle-source-user': 'sources.userPersona', 'toggle-source-character': 'sources.characterPersona',
        'toggle-source-world': 'sources.worldInfo', 'toggle-source-preset': 'sources.sillyTavernPreset', 'toggle-auto-refresh': 'generation.autoRefreshOnMessage',
        'toggle-auto-cleanup': 'retention.autoCleanup',
        'toggle-notification-reply': 'notifications.reply', 'toggle-notification-mention': 'notifications.mention',
        'toggle-notification-like': 'notifications.like', 'toggle-notification-follow': 'notifications.follow',
        'toggle-notification-mutual': 'notifications.mutual', 'toggle-notification-system': 'notifications.system',
        'toggle-information-boundary': 'informationBoundary.enabled', 'toggle-role-direct-messages': 'social.roleDirectMessages',
        'toggle-floating-button': 'ui.floatingButton',
    };
    if (paths[action]) setSettingByPath(paths[action], checked);
    else if (action === 'toggle-image-api') updateApiConfig('image', 'enabled', checked);
    else if (action === 'toggle-text-image-fallback') updateApiConfig('image', 'textFallback', checked);
    else if (action === 'toggle-auto-image') updateApiConfig('image', 'autoGenerate', checked);
    else if (action === 'toggle-remember-keys') setRememberApiKeys(checked);
    if (action === 'toggle-source-world' && checked && !viewState.worldCatalog.length) void refreshWorldCatalog();
    render();
}

async function setRoleModeration(npcId, kind, enabled) {
    const data = getForumData();
    const npc = data.npcs.find(item => item.id === npcId);
    if (!npc) return false;
    if (kind === 'muted') {
        npc.muted = Boolean(enabled);
    } else {
        npc.blocked = Boolean(enabled);
        npc.socialState = npc.blocked ? 'blocked' : 'normal';
        if (npc.blocked) {
            npc.followedByUser = false;
            npc.followsUser = false;
            data.notifications = data.notifications.filter(item => item.actorNpcId !== npc.id);
            if (!isConversationAllowed(data, data.conversations.find(item => item.id === viewState.selectedConversationId))) {
                viewState.selectedConversationId = '';
                viewState.mobileDmChat = false;
            }
        }
    }
    npc.updatedAt = Date.now();
    await saveForumData(data, true);
    syncInjection();
    return true;
}

async function handleRootClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'close') return closeForum();
    if (action === 'switch-tab') { if (target.dataset.tab === 'messages') viewState.mobileDmChat = false; return setActiveTab(target.dataset.tab); }
    if (action === 'me-section') return setMeSection(target.dataset.section);
    if (action === 'message-mode') { viewState.messageMode = target.dataset.mode === 'notifications' ? 'notifications' : 'dm'; if (viewState.messageMode === 'dm') viewState.mobileDmChat = false; return render(); }
    if (action === 'mark-all-notifications') {
        for (const item of getForumData().notifications) item.read = true;
        await saveForumData(getForumData(), true);
        return render();
    }
    if (action === 'clear-generation-logs') {
        if (!window.confirm('确定清空运行后台中的生成记录和报错吗？帖子不会受到影响。')) return;
        const data = getForumData();
        data.generationLogs = [];
        data.lastGenerationTrace = '';
        data.lastGenerationAt = 0;
        await saveForumData(data, true);
        notify('success', '运行后台记录已清空');
        return render();
    }
    if (action === 'open-notification') {
        const item = getForumData().notifications.find(entry => entry.id === target.dataset.notificationId);
        if (item) item.read = true;
        await saveForumData(getForumData(), true);
        if (item?.postId && findPost(item.postId)) {
            getSettings().ui.activeTab = 'home';
            viewState.selectedPostId = item.postId;
            viewState.publicNpcId = '';
            saveSettings();
            return render();
        }
        return render();
    }
    if (action === 'go-injection-settings') return setMeSection('sources');
    if (action === 'generate-posts') return void runGeneration();
    if (action === 'toggle-composer') { viewState.composerOpen = !viewState.composerOpen; return render(); }
    if (action === 'feed-mode') { viewState.feedMode = ['following', 'recommended', 'latest', 'hot'].includes(target.dataset.feed) ? target.dataset.feed : 'recommended'; return render(); }
    if (action === 'clear-topic') { viewState.selectedTopic = ''; return render(); }
    if (action === 'topic-search') {
        viewState.selectedTopic = target.dataset.topic || '';
        setActiveTab('home');
        return;
    }
    if (action === 'add-composer-poll') {
        const question = window.prompt('投票问题：', '你怎么看？')?.trim();
        if (!question) return;
        const options = window.prompt('投票选项（每行一个，至少两个）：', '赞成\n反对')?.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        if (!options || options.length < 2) return notify('warning', '投票至少需要两个选项');
        viewState.composerPoll = { question, options: options.slice(0, 10) };
        return render();
    }
    if (action === 'remove-composer-poll') { viewState.composerPoll = null; return render(); }
    if (action === 'publish-manual') {
        try {
            const data = getForumData();
            data.posts.push(createManualPost({ author: getRoot().querySelector('#tf-compose-author')?.value, handle: getRoot().querySelector('#tf-compose-handle')?.value, content: getRoot().querySelector('#tf-compose-content')?.value, tags: getRoot().querySelector('#tf-compose-tags')?.value.split(/[,，]/).map(value => value.trim()).filter(Boolean), poll: viewState.composerPoll }));
            await enforcePostRetention(data);
            await saveForumData(data, true);
            syncInjection();
            viewState.composerOpen = false;
            viewState.composerPoll = null;
            render();
        } catch (error) { notify('warning', error.message); }
        return;
    }

    if (action === 'open-char-dm') {
        const data = getForumData();
        const conversation = ensureCharacterConversation(data, getChatSnapshot());
        await saveForumData(data, true);
        viewState.selectedConversationId = conversation.id;
        viewState.mobileDmChat = true;
        return setActiveTab('messages');
    }
    if (action === 'open-my-profile') return setMeSection('overview');
    if (action === 'open-conversation') {
        viewState.selectedConversationId = target.dataset.conversationId;
        viewState.mobileDmChat = true;
        const conversation = getForumData().conversations.find(item => item.id === viewState.selectedConversationId);
        if (conversation) { conversation.unread = 0; void saveForumData(getForumData()); }
        return render();
    }
    if (action === 'back-dm-list') { viewState.mobileDmChat = false; return render(); }
    if (action === 'start-npc-dm') {
        const data = getForumData();
        const npc = data.npcs.find(item => item.id === target.dataset.npcId);
        if (!isRoleLibraryMember(npc)) return notify('warning', '请先生成该角色的人设，加入角色库后才能开启私信');
        const conversation = npc.systemRole ? ensureCharacterConversation(data, getChatSnapshot()) : ensureNpcConversation(data, npc);
        if (!conversation) return;
        await saveForumData(data, true);
        viewState.selectedConversationId = conversation.id;
        viewState.mobileDmChat = true;
        return setActiveTab('messages');
    }
    if (action === 'new-dm-npc') {
        const data = getForumData();
        const roles = getRoleLibrary(data).filter(npc => !npc.systemRole && !npc.blocked);
        if (!roles.length) return notify('warning', '角色库中还没有可私信的角色');
        const menu = roles.map((npc, index) => `${index + 1}. ${npc.name} (@${npc.handle})`).join('\n');
        const value = window.prompt(`选择要私信的角色\n可填写序号、名称或账号：\n${menu}`)?.trim();
        if (!value) return;
        const key = value.replace(/^@/, '').toLocaleLowerCase();
        const npc = roles[Number(value) - 1] || roles.find(role => role.name.toLocaleLowerCase() === key || role.handle.toLocaleLowerCase() === key);
        if (!npc) return notify('warning', '没有找到这个角色');
        const conversation = ensureNpcConversation(data, npc);
        await saveForumData(data, true);
        viewState.selectedConversationId = conversation.id;
        viewState.mobileDmChat = true;
        return render();
    }
    if (action === 'new-role-dm') {
        if (!getSettings().social.roleDirectMessages) return notify('warning', '请先在“我 → 信息边界”开启角色之间私信');
        const data = getForumData();
        const roles = getRoleLibrary(data).filter(npc => !npc.blocked);
        if (roles.length < 2) return notify('warning', '至少需要两个未拉黑的角色');
        const menu = roles.map((npc, index) => `${index + 1}. ${npc.name} (@${npc.handle})`).join('\n');
        const pick = label => {
            const value = window.prompt(`${label}\n可填写序号、名称或账号：\n${menu}`)?.trim();
            const byNumber = roles[Number(value) - 1];
            const key = String(value || '').replace(/^@/, '').toLocaleLowerCase();
            return byNumber || roles.find(npc => npc.name.toLocaleLowerCase() === key || npc.handle.toLocaleLowerCase() === key);
        };
        const first = pick('选择角色 A');
        if (!first) return;
        const second = pick('选择角色 B');
        if (!second) return;
        if (first.id === second.id) return notify('warning', 'A 和 B 不能是同一个角色');
        const conversation = ensureRoleConversation(data, first, second);
        await saveForumData(data, true);
        viewState.selectedConversationId = conversation.id;
        viewState.messageMode = 'dm';
        viewState.mobileDmChat = true;
        return render();
    }
    if (action === 'send-dm') {
        event.preventDefault();
        const composer = target.closest('.tf-dm-composer');
        return void sendDirectMessage(target.dataset.conversationId, composer?.querySelector('#tf-dm-input')?.value);
    }
    if (action === 'generate-dm-reply') {
        event.preventDefault();
        return void runDirectMessageReply(target.dataset.conversationId);
    }
    if (action === 'generate-role-dm') {
        event.preventDefault();
        const composer = target.closest('.tf-role-dm-composer');
        return void runRoleDirectMessage(target.dataset.conversationId, composer?.querySelector('#tf-role-dm-speaker')?.value, composer?.querySelector('#tf-role-dm-direction')?.value);
    }

    if (action === 'open-npc') {
        const npcId = target.dataset.npcId;
        const npc = getForumData().npcs.find(item => item.id === npcId);
        if (!npc) return;
        viewState.publicNpcId = npcId;
        viewState.selectedPostId = '';
        getSettings().ui.activeTab = 'home';
        saveSettings();
        render();
        return;
    }
    if (action === 'edit-npc') {
        const npcId = target.dataset.npcId;
        const npc = getForumData().npcs.find(item => item.id === npcId);
        if (!isRoleLibraryMember(npc)) return notify('warning', '该角色尚未生成人设');
        viewState.selectedNpcId = npcId;
        viewState.publicNpcId = '';
        viewState.selectedPostId = '';
        setMeSection('npcs');
        if (!viewState.worldCatalog.length) void refreshWorldCatalog();
        return;
    }
    if (action === 'back-public-profile') { viewState.publicNpcId = ''; return render(); }
    if (action === 'back-post') { viewState.selectedPostId = ''; viewState.replyTarget = null; return render(); }
    if (action === 'back-npcs') { viewState.selectedNpcId = ''; return render(); }
    if (action === 'select-role-memory') { viewState.selectedMemoryNpcId = target.dataset.npcId || ''; return render(); }
    if (action === 'add-npc') {
        const name = window.prompt('角色显示名称：', '新角色')?.trim();
        if (!name) return;
        const handle = window.prompt('论坛账号：', `role${Math.floor(Math.random() * 9000 + 1000)}`)?.trim();
        const data = getForumData();
        const npc = createNpc({ name, handle });
        data.npcs.push(npc);
        await saveForumData(data, true);
        viewState.selectedNpcId = npc.id;
        return render();
    }
    if (action === 'generate-npc-profile') {
        const npc = getForumData().npcs.find(item => item.id === target.dataset.npcId);
        if (!npc) return;
        const message = npc.profileGenerated
            ? `确定重新生成 ${npc.name} 的人设与主页吗？这会调用一次文本 API，并覆盖现有的自动生成字段。`
            : `是否生成 ${npc.name} 的人设与主页？只有确认后才会调用一次文本 API。`;
        if (!window.confirm(message)) return;
        return void runNpcProfileGeneration(npc.id);
    }
    if (action === 'delete-npc') {
        const selected = getForumData().npcs.find(item => item.id === target.dataset.npcId);
        if (selected?.systemRole) return notify('warning', '当前 Char 的默认角色会自动保留');
        if (!window.confirm('确定删除这个角色配置和对应私信吗？帖子不会删除。')) return;
        const data = getForumData();
        const npcId = target.dataset.npcId;
        data.npcs = data.npcs.filter(npc => npc.id !== npcId);
        data.conversations = data.conversations.filter(item => !(item.type === 'npc' && item.targetId === npcId) && !(item.type === 'role_dm' && item.participantIds?.includes(npcId)));
        for (const fact of data.facts) fact.knownBy = (fact.knownBy || []).filter(id => id !== npcId);
        for (const post of data.posts) {
            if (post.npcId === npcId) { post.npcId = ''; post.isAi = false; }
            for (const comment of post.comments || []) if (comment.npcId === npcId) { comment.npcId = ''; comment.isAi = false; }
        }
        await saveForumData(data, true);
        syncInjection();
        viewState.selectedNpcId = '';
        return render();
    }
    if (action === 'add-avatar-url') {
        const name = getRoot().querySelector('#tf-avatar-name')?.value.trim();
        const url = getRoot().querySelector('#tf-avatar-url')?.value.trim();
        if (!name || !isSafeImageUrl(url)) return notify('warning', '请填写头像名称和有效的 http/https 图片直链');
        getSettings().avatarLibrary.push({ id: createId('avatar'), name, url, imageKey: '' });
        saveSettings();
        return render();
    }
    if (action === 'upload-avatar-library') return getRoot().querySelector('#tf-import-avatar-library-file')?.click();
    if (action === 'upload-profile-avatar') return getRoot().querySelector('#tf-import-profile-avatar-file')?.click();
    if (action === 'upload-profile-background') return getRoot().querySelector('#tf-import-profile-background-file')?.click();
    if (action === 'upload-brand-icon') return getRoot().querySelector('#tf-import-brand-icon-file')?.click();
    if (action === 'upload-forum-wallpaper') return getRoot().querySelector('#tf-import-forum-wallpaper-file')?.click();
    if (action === 'clear-brand-icon' || action === 'clear-forum-wallpaper') {
        const appearance = getSettings().appearance;
        const kind = action === 'clear-brand-icon' ? 'brandIcon' : 'wallpaper';
        await removeImageAsset(appearance[`${kind}Key`]);
        appearance[`${kind}Url`] = '';
        appearance[`${kind}Key`] = '';
        saveSettings();
        return render();
    }
    if (action === 'upload-floating-button-image') return getRoot().querySelector('#tf-import-floating-button-file')?.click();
    if (action === 'clear-floating-button-image') {
        const ui = getSettings().ui;
        await removeImageAsset(ui.floatingButtonImageKey);
        ui.floatingButtonImageUrl = '';
        ui.floatingButtonImageKey = '';
        saveSettings();
        updateLaunchers();
        return render();
    }
    if (action === 'reset-floating-button-position') {
        getSettings().ui.floatingButtonPosition = { x: null, y: null };
        saveSettings();
        updateLaunchers();
        return render();
    }
    if (action === 'upload-npc-avatar') {
        viewState.pendingNpcAvatarId = target.dataset.npcId || '';
        return getRoot().querySelector('#tf-import-npc-avatar-file')?.click();
    }
    if (action === 'upload-npc-background') {
        viewState.pendingNpcBackgroundId = target.dataset.npcId || '';
        return getRoot().querySelector('#tf-import-npc-background-file')?.click();
    }
    if (action === 'clear-profile-avatar' || action === 'clear-profile-background') {
        const profile = getSettings().profile;
        const kind = action.endsWith('background') ? 'background' : 'avatar';
        await removeImageAsset(profile[`${kind}Key`]);
        profile[`${kind}Url`] = '';
        profile[`${kind}Key`] = '';
        saveSettings();
        return render();
    }
    if (action === 'select-profile-default-avatar') {
        const profile = getSettings().profile;
        await removeImageAsset(profile.avatarKey);
        profile.avatarUrl = DEFAULT_AVATARS[Number(target.dataset.avatarIndex)]?.url || createDefaultAvatarDataUrl(profile.displayName || 'me');
        profile.avatarKey = '';
        saveSettings();
        return render();
    }
    if (action === 'select-npc-default-avatar' || action === 'clear-npc-avatar') {
        const npc = getForumData().npcs.find(item => item.id === target.dataset.npcId);
        if (!npc) return;
        await removeImageAsset(npc.avatarKey);
        const index = action === 'select-npc-default-avatar' ? Number(target.dataset.avatarIndex) : null;
        updateNpcAvatar(npc, { url: Number.isInteger(index) ? DEFAULT_AVATARS[index]?.url : createDefaultAvatarDataUrl(`${npc.name}:${Date.now()}`) });
        await saveForumData(getForumData(), true);
        return render();
    }
    if (action === 'clear-npc-background') {
        const npc = getForumData().npcs.find(item => item.id === target.dataset.npcId);
        if (!npc) return;
        await removeImageAsset(npc.backgroundKey);
        npc.backgroundUrl = '';
        npc.backgroundKey = '';
        await saveForumData(getForumData(), true);
        return render();
    }
    if (action === 'toggle-follow-role') {
        const npc = getForumData().npcs.find(item => item.id === target.dataset.npcId);
        if (!npc) return;
        if (npc.blocked) return notify('warning', '请先取消拉黑再关注');
        npc.followedByUser = !npc.followedByUser;
        await saveForumData(getForumData(), true);
        return render();
    }
    if (action === 'toggle-role-muted' || action === 'toggle-role-blocked') {
        const npc = getForumData().npcs.find(item => item.id === target.dataset.npcId);
        if (!npc) return;
        const kind = action === 'toggle-role-muted' ? 'muted' : 'blocked';
        const next = !npc[kind];
        if (kind === 'blocked' && next && !window.confirm(`拉黑 ${npc.name} 后会隐藏其内容、通知并取消双方关注，且不能继续私信。确定吗？`)) return;
        await setRoleModeration(npc.id, kind, next);
        viewState.openPostMenuId = '';
        return render();
    }
    if (action === 'add-fact') {
        const content = getRoot().querySelector('#tf-new-fact')?.value.trim();
        if (!content) return notify('warning', '请先填写事实内容');
        const data = getForumData();
        data.facts.push(createFact({ content, visibility: getRoot().querySelector('#tf-new-fact-visibility')?.value }));
        await saveForumData(data, true);
        return render();
    }
    if (action === 'delete-fact') {
        const data = getForumData();
        data.facts = data.facts.filter(fact => fact.id !== target.dataset.factId);
        await saveForumData(data, true);
        return render();
    }
    if (action === 'delete-avatar-url') {
        const item = getSettings().avatarLibrary.find(entry => entry.id === target.dataset.avatarId);
        await removeImageAsset(item?.imageKey);
        getSettings().avatarLibrary = getSettings().avatarLibrary.filter(entry => entry.id !== target.dataset.avatarId);
        saveSettings();
        return render();
    }

    const postId = target.dataset.postId;
    const post = postId ? findPost(postId) : null;
    if (action === 'open-post' && post) { viewState.selectedPostId = postId; viewState.publicNpcId = ''; viewState.replyTarget = null; return render(); }
    if (action === 'toggle-post-menu' && post) { viewState.openPostMenuId = viewState.openPostMenuId === postId ? '' : postId; return render(); }
    if (action === 'like-post' && post) { post.likedByUser = !post.likedByUser; post.likes = Math.max(0, Number(post.likes || 0) + (post.likedByUser ? 1 : -1)); await saveForumData(getForumData()); return render(); }
    if (action === 'favorite-post' && post) { post.favorite = !post.favorite; viewState.openPostMenuId = ''; await saveForumData(getForumData(), true); return render(); }
    if (action === 'toggle-post-image-editor' && post) {
        viewState.openPostImageEditorId = viewState.openPostImageEditorId === post.id ? '' : post.id;
        return render();
    }
    if (action === 'save-post-image-prompt' && post) {
        const value = target.closest('.tf-post')?.querySelector('.tf-post-image-prompt-input')?.value?.trim() || '';
        if (!value) return notify('warning', '请先填写配图画面描述');
        post.imagePrompt = value;
        viewState.openPostImageEditorId = '';
        await saveForumData(getForumData(), true);
        if (hasUsableImageApi()) return void runImageGeneration(post.id);
        return render();
    }
    if (action === 'quote-post' && post) {
        const quote = window.prompt('写下引用内容；留空则直接转发：', '') ?? null;
        if (quote === null) return;
        const profile = getSettings().profile;
        const data = getForumData();
        data.posts.push(createManualPost({ author: profile.displayName || getChatSnapshot().names.user || '我', handle: profile.handle || 'me', content: quote.trim() || `转发了 @${post.handle} 的帖子`, repostOf: post.id, quoteText: `${post.author}：${post.content}`, tags: post.tags || [] }));
        post.reposts = Number(post.reposts || 0) + 1;
        await saveForumData(data, true);
        return render();
    }
    if (action === 'vote-poll' && post?.poll) {
        const option = post.poll.options.find(item => item.id === target.dataset.optionId);
        if (!option || post.poll.closed) return;
        if (!post.poll.multiple) for (const item of post.poll.options) { if (item.votedByUser) { item.votedByUser = false; item.votes = Math.max(0, Number(item.votes || 0) - 1); } }
        option.votedByUser = !option.votedByUser;
        option.votes = Math.max(0, Number(option.votes || 0) + (option.votedByUser ? 1 : -1));
        await saveForumData(getForumData(), true);
        return render();
    }
    if (action === 'like-comment' && post) {
        const comment = post.comments.find(item => item.id === target.dataset.commentId);
        if (!comment) return;
        comment.likedByUser = !comment.likedByUser;
        comment.likes = Math.max(0, Number(comment.likes || 0) + (comment.likedByUser ? 1 : -1));
        await saveForumData(getForumData());
        return render();
    }
    if (action === 'toggle-comments' && post) { viewState.selectedPostId = postId; return render(); }
    if (action === 'start-reply' && post) { viewState.replyTarget = { postId, commentId: target.dataset.commentId || '', handle: target.dataset.replyHandle || post.handle }; viewState.selectedPostId = postId; return render(); }
    if (action === 'submit-reply' && post) {
        try {
            const card = target.closest('.tf-post');
            const reply = createManualComment({ author: card.querySelector('.tf-reply-author')?.value, handle: card.querySelector('.tf-reply-handle')?.value, content: card.querySelector('.tf-reply-content')?.value, imagePrompt: card.querySelector('.tf-reply-image-prompt')?.value, replyTo: viewState.replyTarget?.postId === postId ? viewState.replyTarget.handle : post.handle, parentId: viewState.replyTarget?.postId === postId ? viewState.replyTarget.commentId : '' });
            post.comments.push(reply);
            viewState.replyTarget = null;
            await saveForumData(getForumData(), true);
            syncInjection();
            return void runThreadContinuation(postId, reply);
        } catch (error) { notify('warning', error.message); return; }
    }
    if (action === 'toggle-post-injection' && post) { post.selectedForInjection = !post.selectedForInjection; viewState.openPostMenuId = ''; await saveForumData(getForumData()); syncInjection(); return render(); }
    if (action === 'generate-image' && post) return void runImageGeneration(postId);
    if (action === 'generate-comment-image' && post) return void runCommentImageGeneration(postId, target.dataset.commentId);
    if (action === 'delete-post' && post) {
        if (!window.confirm(post.favorite ? '这是收藏帖，仍要永久删除吗？' : '确定删除这篇帖子吗？')) return;
        const data = getForumData();
        data.posts = data.posts.filter(item => item.id !== postId);
        if (viewState.selectedPostId === postId) viewState.selectedPostId = '';
        viewState.openPostMenuId = '';
        await removePostImages([post]);
        await saveForumData(data, true);
        syncInjection();
        return render();
    }

    if (action === 'new-api-profile') {
        const name = window.prompt('新 API 配置名称：', '新的独立 API')?.trim();
        if (!name) return;
        createApiProfile(name, true);
        return render();
    }
    if (action === 'rename-api-profile') {
        const profile = getActiveApiProfile();
        const name = window.prompt('重命名 API 配置：', profile.name)?.trim();
        if (name && !renameApiProfile(profile.id, name)) notify('warning', '内置配置不能重命名');
        return render();
    }
    if (action === 'delete-api-profile') {
        const profile = getActiveApiProfile();
        if (!window.confirm(`确定删除“${profile.name}”吗？`)) return;
        try { deleteApiProfile(profile.id); } catch (error) { notify('warning', error.message); }
        return render();
    }
    if (action === 'add-api-param' || action === 'add-api-param-template') {
        const profile = getActiveApiProfile();
        if (profile.text.provider === 'sillytavern') return notify('warning', '酒馆默认连接的参数请在酒馆中设置');
        profile.text.extraParameters ||= [];
        profile.text.extraParameters.push({
            id: createId('api-param'),
            key: action === 'add-api-param-template' ? String(target.dataset.key || '') : '',
            value: action === 'add-api-param-template' ? String(target.dataset.value || '') : '',
            type: action === 'add-api-param-template' ? String(target.dataset.type || 'string') : 'string',
            enabled: true,
        });
        saveSettings();
        return render();
    }
    if (action === 'delete-api-param') {
        const profile = getActiveApiProfile();
        profile.text.extraParameters = (profile.text.extraParameters || []).filter(parameter => parameter.id !== target.dataset.paramId);
        saveSettings();
        return render();
    }
    if (action === 'refresh-world-info') return void refreshWorldCatalog(true);
    if (action === 'open-world-book') {
        const bookName = target.dataset.book || '';
        const book = viewState.worldCatalog.find(item => item.name === bookName);
        if (!book) return;
        getSettings().sources.worldInfoBooks[bookName] = true;
        book.enabled = true;
        saveSettings();
        return render();
    }
    if (action === 'select-world-book' || action === 'clear-world-book') {
        const book = viewState.worldCatalog.find(item => item.name === target.dataset.book);
        if (!book) return;
        for (const entry of book.entries) {
            entry.selected = action === 'select-world-book' ? !entry.disabledInSillyTavern : false;
            getSettings().sources.worldInfoEntries[entry.key] = entry.selected;
        }
        saveSettings();
        return render();
    }
    if (action === 'cleanup-now') {
        const data = getForumData();
        const removed = await enforcePostRetention(data, true);
        await saveForumData(data, true);
        syncInjection();
        notify('success', removed ? `已清理 ${removed} 篇旧帖` : '当前无需清理');
        return render();
    }
    if (action === 'add-prompt-entry') { getSettings().promptEntries.unshift({ id: createId('prompt'), title: '新设定', enabled: true, constant: false, keywords: [], order: 0, role: 'system', content: '' }); saveSettings(); return render(); }
    if (action === 'delete-prompt-entry') { if (window.confirm('确定删除这条论坛设定吗？')) { getSettings().promptEntries = getSettings().promptEntries.filter(entry => entry.id !== target.dataset.entryId); saveSettings(); render(); } return; }
    if (action === 'export-prompts') return downloadJson('tavern-forum-prompts.json', { version: 1, promptEntries: getSettings().promptEntries });
    if (action === 'import-prompts') return getRoot().querySelector('#tf-import-prompts-file')?.click();
    if (action === 'export-forum') return downloadJson(`tavern-forum-${Date.now()}.json`, getForumData());
    if (action === 'import-forum') return getRoot().querySelector('#tf-import-forum-file')?.click();
    if (action === 'import-css') return getRoot().querySelector('#tf-import-css-file')?.click();
    if (action === 'clear-css') { getSettings().appearance.customCss = ''; getSettings().appearance.customCssCleared = true; saveSettings(); applyAppearance(); return render(); }
    if (action === 'load-builtin-css' || action === 'restore-standard-css') {
        const appearance = getSettings().appearance;
        if (appearance.customCss.trim() && appearance.customCss !== BUILTIN_CUSTOM_CSS_TEMPLATE && !window.confirm('恢复模板会替换当前自定义 CSS，确定继续吗？')) return;
        appearance.customCss = BUILTIN_CUSTOM_CSS_TEMPLATE;
        appearance.customCssCleared = false;
        saveSettings();
        applyAppearance();
        return render();
    }
    if (action === 'clear-data') { if (window.confirm('这会清空微坛设置和当前聊天数据，且无法撤销。确定继续吗？')) { await clearAllData(); notify('success', '微坛数据已清空'); render(); } }
}

function handleRootInput(event) {
    const target = event.target;
    if (target.matches('.tf-search-input')) { viewState.searchQuery = target.value; applySearchFilter(); return; }
    if (target.dataset.secret) { setSessionApiKey(target.dataset.secret, target.value); return; }
    if (target.dataset.apiParamField) {
        const parameter = (getActiveApiProfile().text.extraParameters || []).find(item => item.id === target.closest('[data-api-param-id]')?.dataset.apiParamId);
        if (!parameter) return;
        parameter[target.dataset.apiParamField] = target.dataset.apiParamField === 'enabled' ? target.checked : target.value;
        saveSettings();
        return;
    }
    if (target.dataset.profileField) {
        getSettings().profile[target.dataset.profileField] = target.value;
        saveSettings();
        return;
    }
    if (target.dataset.appearance) {
        const field = target.dataset.appearance;
        getSettings().appearance[field] = target.value;
        if (field === 'customCss') getSettings().appearance.customCssCleared = false;
        saveSettings();
        applyAppearance();
        if (field === 'forumName') getRoot().querySelectorAll('.tf-brand-name').forEach(element => { element.textContent = target.value || '微坛'; });
        if (target.type === 'color') target.parentElement?.querySelector('code')?.replaceChildren(target.value);
        return;
    }
    if (target.dataset.appearanceNumber) {
        const field = target.dataset.appearanceNumber;
        const value = Number(target.value);
        const opacityField = field === 'postOpacity' || field === 'commentOpacity' || field === 'cardOpacity';
        getSettings().appearance[field] = opacityField
            ? Math.min(1, Math.max(0.2, value))
            : Math.min(40, Math.max(0, value));
        const output = target.parentElement?.querySelector('output');
        if (output) output.textContent = opacityField ? `${Math.round(value * 100)}%` : `${Math.round(value)}px`;
        saveSettings();
        applyAppearance();
        return;
    }
    if (target.dataset.npcField) {
        const npc = getForumData().npcs.find(item => item.id === target.closest('[data-npc-id]')?.dataset.npcId);
        if (!npc) return;
        npc[target.dataset.npcField] = target.value;
        if (target.dataset.npcField === 'persona' && target.value.trim()) npc.profileGenerated = true;
        npc.updatedAt = Date.now();
        void saveForumData(getForumData());
        if (target.dataset.npcField === 'persona') syncInjection();
        return;
    }
    if (target.dataset.npcMemoryField || target.dataset.npcMemoryArray) {
        const npc = getForumData().npcs.find(item => item.id === target.closest('[data-npc-id]')?.dataset.npcId);
        if (!npc) return;
        if (target.dataset.npcMemoryArray) npc.memory[target.dataset.npcMemoryArray] = target.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        else if (target.dataset.npcMemoryField === 'relationshipScore') npc.memory.relationshipScore = Math.min(100, Math.max(-100, Number(target.value || 0)));
        else npc.memory[target.dataset.npcMemoryField] = target.value;
        npc.updatedAt = Date.now();
        void saveForumData(getForumData());
        return;
    }
    if (target.dataset.factContent !== undefined) {
        const fact = getForumData().facts.find(item => item.id === target.closest('[data-fact-id]')?.dataset.factId);
        if (fact) { fact.content = target.value; fact.updatedAt = Date.now(); void saveForumData(getForumData()); }
        return;
    }
    const entryElement = target.closest('[data-entry-id]');
    if (entryElement && target.dataset.entryField) {
        const entry = getSettings().promptEntries.find(item => item.id === entryElement.dataset.entryId);
        if (!entry) return;
        const field = target.dataset.entryField;
        if (field === 'keywords') entry.keywords = target.value.split(/[,，\n]/).map(value => value.trim()).filter(Boolean);
        else if (field === 'order') entry.order = Number(target.value || 0);
        else entry[field] = target.value;
        saveSettings();
    }
}

function handleRootChange(event) {
    const target = event.target;
    if (target.dataset.apiParamField) {
        const parameter = (getActiveApiProfile().text.extraParameters || []).find(item => item.id === target.closest('[data-api-param-id]')?.dataset.apiParamId);
        if (parameter) {
            parameter[target.dataset.apiParamField] = target.dataset.apiParamField === 'enabled' ? target.checked : target.value;
            saveSettings();
        }
        return;
    }
    if (target.dataset.entryField) {
        handleRootInput(event);
        return;
    }
    if (target.dataset.action?.startsWith('toggle-') && target.type === 'checkbox') {
        if (target.dataset.action === 'toggle-world-book') {
            const bookName = target.dataset.book || '';
            if (!bookName) return;
            getSettings().sources.worldInfoBooks[bookName] = target.checked;
            const book = viewState.worldCatalog.find(item => item.name === bookName);
            if (book) book.enabled = target.checked;
            saveSettings();
            return render();
        }
        if (target.dataset.action === 'toggle-prompt-entry' || target.dataset.action === 'toggle-prompt-constant') {
            const entry = getSettings().promptEntries.find(item => item.id === target.closest('[data-entry-id]')?.dataset.entryId);
            if (entry) entry[target.dataset.action === 'toggle-prompt-entry' ? 'enabled' : 'constant'] = target.checked;
            saveSettings();
            return render();
        }
        if (target.dataset.action === 'toggle-npc-injection') {
            const npc = getForumData().npcs.find(item => item.id === target.closest('[data-npc-id]')?.dataset.npcId);
            if (npc) { npc.inject = target.checked; void saveForumData(getForumData()); syncInjection(); }
            return render();
        }
        if (target.dataset.action === 'toggle-role-follows-user') {
            const data = getForumData();
            const npc = data.npcs.find(item => item.id === target.closest('[data-npc-id]')?.dataset.npcId);
            if (npc) {
                const wasMutual = npc.followsUser && npc.followedByUser;
                npc.followsUser = target.checked;
                const type = npc.followsUser && npc.followedByUser ? 'mutual' : 'follow';
                const preferences = getSettings().notifications;
                if (npc.followsUser && !wasMutual && preferences[type]) data.notifications.unshift(createNotification({ type, actorNpcId: npc.id, actorName: npc.name, content: type === 'mutual' ? `${npc.name} 与你互相关注了` : `${npc.name} 关注了你` }));
                void saveForumData(data, true);
            }
            return render();
        }
        if (target.dataset.action === 'toggle-role-muted' || target.dataset.action === 'toggle-role-blocked') {
            const npc = getForumData().npcs.find(item => item.id === target.closest('[data-npc-id]')?.dataset.npcId);
            if (!npc) return;
            const kind = target.dataset.action === 'toggle-role-muted' ? 'muted' : 'blocked';
            void setRoleModeration(npc.id, kind, target.checked).then(() => render());
            return;
        }
        if (target.dataset.action === 'toggle-fact-publishable') {
            const fact = getForumData().facts.find(item => item.id === target.closest('[data-fact-id]')?.dataset.factId);
            if (fact) { fact.publishable = target.checked; fact.updatedAt = Date.now(); void saveForumData(getForumData(), true); }
            return render();
        }
        return handleSwitchAction(target.dataset.action, target.checked);
    }
    if (target.dataset.action === 'select-api-profile') { setActiveApiProfile(target.value); return render(); }
    if (target.dataset.apiSetting) {
        const [kind, field] = target.dataset.apiSetting.split('.');
        const current = getApiConfig(kind)[field];
        updateApiConfig(kind, field, typeof current === 'number' ? Number(target.value) : target.value);
        return;
    }
    if (target.dataset.npcAvatar !== undefined) {
        const data = getForumData();
        const npc = data.npcs.find(item => item.id === target.closest('[data-npc-id]')?.dataset.npcId);
        const item = getSettings().avatarLibrary.find(entry => entry.id === target.value);
        if (npc && item) { updateNpcAvatar(npc, { url: item.url, imageKey: item.imageKey, avatarId: item.id }); void saveForumData(data); render(); }
        return;
    }
    if (target.dataset.npcAvatarUrl !== undefined) {
        const npc = getForumData().npcs.find(item => item.id === target.closest('[data-npc-id]')?.dataset.npcId);
        const url = target.value.trim();
        if (url && !isSafeImageUrl(url)) return notify('warning', '请填写有效的 http/https 图片直链');
        if (npc) { void removeImageAsset(npc.avatarKey); updateNpcAvatar(npc, { url }); void saveForumData(getForumData(), true); render(); }
        return;
    }
    if (target.dataset.npcBackgroundUrl !== undefined) {
        const npc = getForumData().npcs.find(item => item.id === target.closest('[data-npc-id]')?.dataset.npcId);
        const url = target.value.trim();
        if (url && !isSafeImageUrl(url)) return notify('warning', '请填写有效的 http/https 图片直链');
        if (npc) {
            void removeImageAsset(npc.backgroundKey);
            npc.backgroundUrl = url;
            npc.backgroundKey = '';
            npc.updatedAt = Date.now();
            void saveForumData(getForumData(), true);
            render();
        }
        return;
    }
    if (target.dataset.npcBindingType !== undefined) {
        const npc = getForumData().npcs.find(item => item.id === target.closest('[data-npc-id]')?.dataset.npcId);
        if (npc) { applyNpcBinding(npc, target.value); void saveForumData(getForumData(), true); render(); }
        return;
    }
    if (target.dataset.npcBindingTarget !== undefined) {
        const npc = getForumData().npcs.find(item => item.id === target.closest('[data-npc-id]')?.dataset.npcId);
        if (npc) { applyNpcBinding(npc, npc.bindingType, target.value); void saveForumData(getForumData(), true); render(); }
        return;
    }
    if (target.dataset.npcSocialState !== undefined) {
        const npc = getForumData().npcs.find(item => item.id === target.closest('[data-npc-id]')?.dataset.npcId);
        if (npc) {
            const state = ['normal', 'friendly', 'quarrel', 'blocked'].includes(target.value) ? target.value : 'normal';
            void (async () => {
                if (state === 'blocked') await setRoleModeration(npc.id, 'blocked', true);
                else {
                    if (npc.blocked) await setRoleModeration(npc.id, 'blocked', false);
                    npc.socialState = state;
                    await saveForumData(getForumData(), true);
                }
                render();
            })();
        }
        return;
    }
    if (target.dataset.profileImageUrl) {
        const kind = target.dataset.profileImageUrl;
        const url = target.value.trim();
        if (url && !isSafeImageUrl(url)) return notify('warning', '请填写有效的 http/https 图片直链');
        const profile = getSettings().profile;
        void removeImageAsset(profile[`${kind}Key`]);
        profile[`${kind}Url`] = url;
        profile[`${kind}Key`] = '';
        saveSettings(); render();
        return;
    }
    if (target.dataset.appearanceImageUrl) {
        const kind = target.dataset.appearanceImageUrl;
        const url = target.value.trim();
        if (url && !isSafeImageUrl(url)) return notify('warning', '请填写有效的 http/https 图片直链');
        const appearance = getSettings().appearance;
        void removeImageAsset(appearance[`${kind}Key`]);
        appearance[`${kind}Url`] = url;
        appearance[`${kind}Key`] = '';
        saveSettings();
        render();
        return;
    }
    if (target.dataset.floatingButtonImageUrl !== undefined) {
        const url = target.value.trim();
        if (url && !isSafeImageUrl(url)) return notify('warning', '请填写有效的 http/https 图片直链');
        const ui = getSettings().ui;
        void removeImageAsset(ui.floatingButtonImageKey);
        ui.floatingButtonImageUrl = url;
        ui.floatingButtonImageKey = '';
        saveSettings();
        updateLaunchers();
        render();
        return;
    }
    if (target.dataset.worldEntry) {
        getSettings().sources.worldInfoEntries[target.dataset.worldEntry] = target.checked;
        for (const book of viewState.worldCatalog) {
            const entry = book.entries.find(item => item.key === target.dataset.worldEntry);
            if (entry) entry.selected = target.checked;
        }
        saveSettings();
        return;
    }
    if (target.dataset.presetEntry) { getSettings().sources.presetEntries[target.dataset.presetEntry] = target.checked; saveSettings(); return; }
    if (target.dataset.factVisibility !== undefined) {
        const fact = getForumData().facts.find(item => item.id === target.closest('[data-fact-id]')?.dataset.factId);
        if (fact) { fact.visibility = target.value; fact.updatedAt = Date.now(); void saveForumData(getForumData(), true); render(); }
        return;
    }
    if (target.dataset.factKnownRole !== undefined) {
        const fact = getForumData().facts.find(item => item.id === target.dataset.factKnownRole);
        if (fact) {
            const ids = new Set(fact.knownBy || []);
            target.checked ? ids.add(target.dataset.roleId) : ids.delete(target.dataset.roleId);
            fact.knownBy = [...ids];
            fact.updatedAt = Date.now();
            void saveForumData(getForumData(), true);
        }
        return;
    }
    if (target.dataset.worldBoundary !== undefined) {
        const key = target.dataset.worldBoundary;
        const current = getSettings().informationBoundary.worldInfoEntries[key] || { visibility: 'public', knownBy: [] };
        getSettings().informationBoundary.worldInfoEntries[key] = { ...current, visibility: target.value };
        saveSettings();
        return;
    }
    if (target.dataset.worldBoundaryRoles !== undefined) {
        const key = target.dataset.worldBoundaryRoles;
        const data = getForumData();
        const handles = target.value.split(/[,，]/).map(value => value.trim().replace(/^@/, '').toLocaleLowerCase()).filter(Boolean);
        const knownBy = handles.map(handle => data.npcs.find(npc => npc.handle.toLocaleLowerCase() === handle || npc.name.toLocaleLowerCase() === handle)?.id).filter(Boolean);
        const current = getSettings().informationBoundary.worldInfoEntries[key] || { visibility: 'restricted', knownBy: [] };
        getSettings().informationBoundary.worldInfoEntries[key] = { ...current, knownBy: [...new Set(knownBy)] };
        saveSettings();
        render();
        return;
    }
    if (target.dataset.setting) {
        const current = getSettingByPath(target.dataset.setting);
        setSettingByPath(target.dataset.setting, typeof current === 'number' ? Number(target.value) : target.value);
        return;
    }
    if (target.id === 'tf-import-css-file') {
        void readFile(target).then(text => { if (text === null) return; getSettings().appearance.customCss = text; getSettings().appearance.customCssCleared = false; saveSettings(); applyAppearance(); render(); notify('success', 'CSS 美化已导入'); }).catch(error => notify('error', `CSS 导入失败：${error.message}`));
    }
    if (['tf-import-profile-avatar-file', 'tf-import-profile-background-file', 'tf-import-avatar-library-file', 'tf-import-npc-avatar-file', 'tf-import-npc-background-file', 'tf-import-floating-button-file', 'tf-import-brand-icon-file', 'tf-import-forum-wallpaper-file'].includes(target.id)) {
        void (async () => {
            const asset = await readImageAsset(target, target.id.replace('tf-import-', '').replace('-file', ''));
            if (!asset) return;
            if (target.id === 'tf-import-floating-button-file') {
                const ui = getSettings().ui;
                await removeImageAsset(ui.floatingButtonImageKey);
                ui.floatingButtonImageUrl = asset.url;
                ui.floatingButtonImageKey = asset.imageKey;
                saveSettings();
                updateLaunchers();
            } else if (target.id === 'tf-import-brand-icon-file' || target.id === 'tf-import-forum-wallpaper-file') {
                const kind = target.id === 'tf-import-brand-icon-file' ? 'brandIcon' : 'wallpaper';
                const appearance = getSettings().appearance;
                await removeImageAsset(appearance[`${kind}Key`]);
                appearance[`${kind}Url`] = asset.url;
                appearance[`${kind}Key`] = asset.imageKey;
                saveSettings();
            } else if (target.id === 'tf-import-profile-avatar-file' || target.id === 'tf-import-profile-background-file') {
                const kind = target.id.includes('background') ? 'background' : 'avatar';
                const profile = getSettings().profile;
                await removeImageAsset(profile[`${kind}Key`]);
                profile[`${kind}Url`] = asset.url;
                profile[`${kind}Key`] = asset.imageKey;
                saveSettings();
            } else if (target.id === 'tf-import-avatar-library-file') {
                const name = getRoot().querySelector('#tf-avatar-name')?.value.trim() || asset.name.replace(/\.[^.]+$/, '');
                getSettings().avatarLibrary.push({ id: createId('avatar'), name, url: asset.url, imageKey: asset.imageKey });
                saveSettings();
            } else if (target.id === 'tf-import-npc-avatar-file') {
                const npc = getForumData().npcs.find(item => item.id === viewState.pendingNpcAvatarId);
                if (npc) {
                    await removeImageAsset(npc.avatarKey);
                    updateNpcAvatar(npc, asset);
                    await saveForumData(getForumData(), true);
                }
                viewState.pendingNpcAvatarId = '';
            } else {
                const npc = getForumData().npcs.find(item => item.id === viewState.pendingNpcBackgroundId);
                if (npc) {
                    await removeImageAsset(npc.backgroundKey);
                    npc.backgroundUrl = asset.url;
                    npc.backgroundKey = asset.imageKey;
                    npc.updatedAt = Date.now();
                    await saveForumData(getForumData(), true);
                }
                viewState.pendingNpcBackgroundId = '';
            }
            render();
        })().catch(error => notify('error', `图片导入失败：${error.message}`));
        return;
    }
    if (target.id === 'tf-import-prompts-file') {
        void readFile(target).then(text => {
            if (text === null) return;
            const payload = JSON.parse(text);
            const entries = Array.isArray(payload) ? payload : payload?.promptEntries;
            if (!Array.isArray(entries)) throw new Error('文件中没有 promptEntries');
            getSettings().promptEntries.push(...entries.filter(entry => typeof entry?.content === 'string').map(entry => ({ id: createId('prompt'), title: String(entry.title || '导入设定'), enabled: entry.enabled !== false, constant: Boolean(entry.constant), keywords: Array.isArray(entry.keywords) ? entry.keywords.map(String) : [], order: Number(entry.order || 0), role: ['system', 'user', 'assistant'].includes(entry.role) ? entry.role : 'system', content: entry.content })));
            saveSettings(); render();
        }).catch(error => notify('error', `导入失败：${error.message}`));
    }
    if (target.id === 'tf-import-forum-file') {
        void readFile(target).then(async text => {
            if (text === null) return;
            const payload = JSON.parse(text);
            if (!Array.isArray(payload?.posts)) throw new Error('文件中没有 posts');
            const data = { ...payload, version: 9, updatedAt: Date.now() };
            linkNpcAuthors(data);
            await enforcePostRetention(data);
            await saveForumData(data, true);
            syncInjection(); render();
        }).catch(error => notify('error', `导入失败：${error.message}`));
    }
}

function clampFloatingButtonPosition(fab, x, y) {
    const rect = fab.getBoundingClientRect();
    const margin = 8;
    return {
        x: Math.min(Math.max(margin, Number(x) || margin), Math.max(margin, window.innerWidth - rect.width - margin)),
        y: Math.min(Math.max(margin, Number(y) || margin), Math.max(margin, window.innerHeight - rect.height - margin)),
    };
}

function applyFloatingButtonPosition(fab, position) {
    const hasPosition = Number.isFinite(Number(position?.x)) && Number.isFinite(Number(position?.y));
    if (!hasPosition || position?.x === null || position?.y === null) {
        fab.style.removeProperty('left');
        fab.style.removeProperty('top');
        fab.style.removeProperty('right');
        fab.style.removeProperty('bottom');
        return;
    }
    const next = clampFloatingButtonPosition(fab, position.x, position.y);
    fab.style.left = `${next.x}px`;
    fab.style.top = `${next.y}px`;
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
}

function installFloatingButtonDrag(fab) {
    let drag = null;
    fab.addEventListener('pointerdown', event => {
        if (event.button !== 0 && event.pointerType !== 'touch') return;
        const rect = fab.getBoundingClientRect();
        drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
        try { fab.setPointerCapture(event.pointerId); } catch { /* pointer capture is optional */ }
    });
    fab.addEventListener('pointermove', event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 5) return;
        drag.moved = true;
        fab.classList.add('is-dragging');
        const next = clampFloatingButtonPosition(fab, drag.left + dx, drag.top + dy);
        fab.style.left = `${next.x}px`;
        fab.style.top = `${next.y}px`;
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
        event.preventDefault();
    });
    const finish = event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (drag.moved) {
            const rect = fab.getBoundingClientRect();
            getSettings().ui.floatingButtonPosition = { x: Math.round(rect.left), y: Math.round(rect.top) };
            saveSettings();
            fab.dataset.ignoreClickUntil = String(Date.now() + 350);
        }
        fab.classList.remove('is-dragging');
        try { fab.releasePointerCapture(event.pointerId); } catch { /* pointer capture is optional */ }
        drag = null;
    };
    fab.addEventListener('pointerup', finish);
    fab.addEventListener('pointercancel', finish);
}

function updateLaunchers() {
    const settings = getSettings();
    const fab = document.getElementById(FAB_ID);
    if (fab) {
        fab.toggleAttribute('hidden', !settings.ui.floatingButton);
        const customImage = renderStoredImage({ url: settings.ui.floatingButtonImageUrl, imageKey: settings.ui.floatingButtonImageKey, alt: '打开论坛', className: 'tf-floating-button-image' });
        const content = fab.querySelector('span');
        if (content) content.innerHTML = customImage || icon('message');
        applyFloatingButtonPosition(fab, settings.ui.floatingButtonPosition);
    }
    const dot = document.querySelector(`#${MENU_ID} .tf-menu-dot`);
    if (dot) dot.classList.toggle('is-on', settings.injection.enabled);
    const fabDot = fab?.querySelector('i');
    if (fabDot) fabDot.classList.toggle('is-on', settings.injection.enabled);
}

function installLaunchers() {
    if (!document.getElementById(MENU_ID)) {
        const menu = document.getElementById('extensionsMenu');
        if (menu) {
            const item = document.createElement('div');
            item.id = MENU_ID;
            item.className = 'list-group-item flex-container flexGap5 interactable tavern-forum-launcher';
            item.tabIndex = 0;
            item.innerHTML = `${icon('message')}<span>打开微坛</span><i class="tf-menu-dot"></i>`;
            item.addEventListener('click', () => openForum('home'));
            menu.append(item);
        }
    }
    if (!document.getElementById(FAB_ID)) {
        const fab = document.createElement('button');
        fab.id = FAB_ID;
        fab.type = 'button';
        fab.title = '打开微坛';
        fab.innerHTML = `<span>${icon('message')}</span><i></i>`;
        installFloatingButtonDrag(fab);
        fab.addEventListener('click', event => {
            if (Number(fab.dataset.ignoreClickUntil || 0) > Date.now()) {
                event.preventDefault();
                return;
            }
            openForum('home');
        });
        document.body.append(fab);
    }
    if (!document.getElementById(SETTINGS_BLOCK_ID)) {
        const panel = document.getElementById('extensions_settings2');
        if (panel) {
            const block = document.createElement('div');
            block.id = SETTINGS_BLOCK_ID;
            block.className = 'extension_container';
            block.innerHTML = '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>微坛 · 故事社交</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><p>故事世界动态、私信与角色社交。</p><button type="button" class="menu_button">打开微坛</button></div></div>';
            block.querySelector('button').addEventListener('click', () => openForum('me'));
            panel.append(block);
        }
    }
    updateLaunchers();
}

function openForum(tab = '') {
    if (tab) getSettings().ui.activeTab = ['home', 'messages', 'me'].includes(tab) ? tab : 'home';
    viewState.open = true;
    render();
}

function closeForum() {
    viewState.open = false;
    render();
}

function bindSillyTavernEvents() {
    const context = globalThis.SillyTavern.getContext();
    const refresh = () => { syncInjection(); if (viewState.open) render(); };
    const cancelAutoRefresh = () => {
        if (viewState.autoRefreshTimer) window.clearTimeout(viewState.autoRefreshTimer);
        viewState.autoRefreshTimer = 0;
    };
    if (context.eventTypes?.CHAT_CHANGED) context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => { cancelAutoRefresh(); viewState.selectedNpcId = ''; viewState.publicNpcId = ''; viewState.selectedPostId = ''; viewState.selectedConversationId = ''; viewState.replyTarget = null; viewState.expandedComments.clear(); refresh(); });
    if (context.eventTypes?.MESSAGE_RECEIVED) context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, (_messageId, type) => {
        if (type === 'first_message' || !getSettings().generation.autoRefreshOnMessage || !hasActiveChat()) return;
        cancelAutoRefresh();
        const scheduledChatId = getChatSnapshot().chatId;
        viewState.autoRefreshTimer = window.setTimeout(() => {
            viewState.autoRefreshTimer = 0;
            if (!getSettings().generation.autoRefreshOnMessage || getChatSnapshot().chatId !== scheduledChatId || viewState.busy) return;
            void runGeneration({ automatic: true });
        }, 900);
    });
    if (context.eventTypes?.MESSAGE_EDITED) context.eventSource.on(context.eventTypes.MESSAGE_EDITED, refresh);
    if (context.eventTypes?.MESSAGE_DELETED) context.eventSource.on(context.eventTypes.MESSAGE_DELETED, refresh);
    if (context.eventTypes?.WORLDINFO_UPDATED) context.eventSource.on(context.eventTypes.WORLDINFO_UPDATED, () => { viewState.worldCatalog = []; });
}

export async function initializeForumUi() {
    if (viewState.initialized) return;
    let root = getRoot();
    if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        root.hidden = true;
        root.addEventListener('click', event => void handleRootClick(event));
        root.addEventListener('input', handleRootInput);
        root.addEventListener('change', handleRootChange);
        root.addEventListener('submit', event => event.preventDefault());
        document.body.append(root);
    }
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && viewState.open) closeForum(); });
    window.addEventListener('resize', updateLaunchers);
    installLaunchers();
    bindSillyTavernEvents();
    viewState.initialized = true;
    render();
}

export function refreshForumUi() {
    if (viewState.initialized) render();
}
