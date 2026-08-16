import { generateForumImage, generateForumText } from './api.js';
import {
    buildForumGenerationRequest,
    buildNpcProfileRequest,
    buildThreadReplyRequest,
    createId,
    createManualComment,
    createManualPost,
    normalizeGeneratedForum,
    normalizeNpcProfile,
    normalizeThreadReplies,
    prunePosts,
} from './prompt.js';
import {
    applyNpcProfile,
    collectNpcEvidence,
    createNpc,
    linkNpcAuthors,
} from './forum.js';
import {
    clearAllData,
    createApiProfile,
    deleteApiProfile,
    getActiveApiProfile,
    getApiConfig,
    getChatSnapshot,
    getForumData,
    getGenerationSourceContext,
    getSettings,
    getWorldInfoCatalog,
    hasActiveChat,
    makeWorldInfoEntryKey,
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
const imageMemory = new Map();

const viewState = {
    open: false,
    busy: false,
    composerOpen: false,
    imageBusy: new Set(),
    replyingPosts: new Set(),
    npcBusy: new Set(),
    expandedComments: new Set(),
    replyTarget: null,
    selectedNpcId: '',
    worldCatalog: [],
    worldLoading: false,
    initialized: false,
};

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function notify(type, message) {
    if (globalThis.toastr?.[type]) globalThis.toastr[type](message);
    else console[type === 'error' ? 'error' : 'log'](`[微坛] ${message}`);
}

function setBusy(busy) {
    viewState.busy = busy;
    render();
}

function getRoot() {
    return document.getElementById(ROOT_ID);
}

function getActiveTab() {
    return getSettings().ui.activeTab || 'feed';
}

function setActiveTab(tab) {
    getSettings().ui.activeTab = tab;
    saveSettings();
    render();
    if (tab === 'settings' && !viewState.worldCatalog.length) void refreshWorldCatalog();
}

function isSafeImageUrl(value) {
    return /^(https?:\/\/|data:image\/)/i.test(String(value || ''));
}

function initials(name) {
    const normalized = String(name || '匿').trim();
    return escapeHtml(Array.from(normalized)[0] || '匿');
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

function renderSwitch({ checked, action, label, small = false, disabled = false }) {
    return `<label class="tf-switch ${small ? 'tf-switch-small' : ''} ${disabled ? 'is-disabled' : ''}">
        <input type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} data-action="${escapeHtml(action)}">
        <span class="tf-switch-track"><span></span></span>
        ${label ? `<span class="tf-switch-label">${escapeHtml(label)}</span>` : ''}
    </label>`;
}

function renderAvatar(name, large = false, npcId = '') {
    const className = `tf-avatar ${large ? 'tf-avatar-large' : ''} ${npcId ? 'tf-avatar-clickable' : ''}`;
    if (npcId) {
        return `<button class="${className}" style="--tf-avatar-hue:${avatarHue(name)}" data-action="open-npc" data-npc-id="${escapeHtml(npcId)}" title="查看 ${escapeHtml(name)} 的主页">${initials(name)}</button>`;
    }
    return `<span class="${className}" style="--tf-avatar-hue:${avatarHue(name)}">${initials(name)}</span>`;
}

function hasRealImage(post) {
    return Boolean((post.imageUrl && isSafeImageUrl(post.imageUrl)) || post.imageKey);
}

function hasUsableImageApi(config = getApiConfig('image')) {
    return Boolean(config.enabled && String(config.endpoint || '').trim() && String(config.model || '').trim());
}

function usesTextImage(post, config = getApiConfig('image')) {
    return !hasRealImage(post)
        && Boolean(String(post.imagePrompt || '').trim())
        && Boolean(config.textFallback)
        && !hasUsableImageApi(config);
}

function renderPostImage(post) {
    if (post.imageUrl && isSafeImageUrl(post.imageUrl)) {
        return `<img class="tf-post-image" src="${escapeHtml(post.imageUrl)}" alt="帖子配图" loading="lazy">`;
    }
    if (post.imageKey) {
        const memoryValue = imageMemory.get(post.imageKey);
        if (memoryValue) return `<img class="tf-post-image" src="${escapeHtml(memoryValue)}" alt="帖子配图" loading="lazy">`;
        return `<div class="tf-image-loading"><span class="tf-spinner"></span> 正在读取图片…<img data-image-key="${escapeHtml(post.imageKey)}" alt="帖子配图"></div>`;
    }
    if (usesTextImage(post)) {
        return `<figure class="tf-text-image" aria-label="文字配图">
            <figcaption><span>文</span> 文字配图</figcaption>
            <p>${escapeHtml(post.imagePrompt)}</p>
        </figure>`;
    }
    return '';
}

function renderComments(post) {
    if (!viewState.expandedComments.has(post.id)) return '';
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const target = viewState.replyTarget?.postId === post.id ? viewState.replyTarget : null;
    const snapshot = getChatSnapshot();
    const replying = viewState.replyingPosts.has(post.id);
    return `<div class="tf-comments">
        ${comments.length ? comments.map(comment => `<div class="tf-comment tf-thread-comment">
            ${renderAvatar(comment.author, false, comment.npcId)}
            <div><div class="tf-comment-author"><b>${escapeHtml(comment.author)}</b><span>@${escapeHtml(comment.handle || 'user')}</span>${comment.replyTo ? `<em>回复 @${escapeHtml(comment.replyTo)}</em>` : ''}</div><p>${escapeHtml(comment.content)}</p><button data-action="start-reply" data-post-id="${escapeHtml(post.id)}" data-comment-id="${escapeHtml(comment.id)}" data-reply-handle="${escapeHtml(comment.handle || '')}">回复</button></div>
        </div>`).join('') : '<div class="tf-empty-mini">暂时还没有评论，来抢沙发吧</div>'}
        <div class="tf-reply-composer">
            <div class="tf-reply-who"><input class="tf-reply-author" value="${escapeHtml(snapshot.names.user || '我')}" maxlength="30"><span>@</span><input class="tf-reply-handle" value="me" maxlength="30">${target ? `<b>回复 @${escapeHtml(target.handle)}</b>` : ''}</div>
            <textarea class="tf-reply-content" rows="2" maxlength="1500" placeholder="${target ? `回复 @${escapeHtml(target.handle)}…` : '写下你的回帖，发布后 NPC 会继续回复…'}"></textarea>
            <div><button class="tf-ghost-button" data-action="cancel-reply" data-post-id="${escapeHtml(post.id)}">清空</button><button class="tf-primary-button" data-action="submit-reply" data-post-id="${escapeHtml(post.id)}" ${replying ? 'disabled' : ''}>${replying ? '<span class="tf-spinner"></span> NPC 回复中' : '发布并继续生成'}</button></div>
        </div>
    </div>`;
}

function renderPost(post) {
    const injecting = Boolean(post.selectedForInjection);
    const imageBusy = viewState.imageBusy.has(post.id);
    const imageConfig = getApiConfig('image');
    const imageButtonLabel = imageBusy
        ? '生成中'
        : hasRealImage(post)
            ? '换图'
            : usesTextImage(post, imageConfig)
                ? '改文字配图'
                : hasUsableImageApi(imageConfig) ? '配图' : '文字配图';
    const commentsCount = Array.isArray(post.comments) ? post.comments.length : 0;
    return `<article class="tf-card tf-post ${injecting ? 'is-selected' : ''}" data-post-id="${escapeHtml(post.id)}">
        <div class="tf-post-main">
            ${renderAvatar(post.author, false, post.npcId)}
            <div class="tf-post-body">
                <div class="tf-post-author-row">
                    <div><b>${escapeHtml(post.author)}</b><span class="tf-handle">@${escapeHtml(post.handle || 'user')}</span></div>
                    <button class="tf-icon-button" data-action="delete-post" data-post-id="${escapeHtml(post.id)}" title="删除帖子" aria-label="删除帖子">•••</button>
                </div>
                <div class="tf-post-meta">${formatTime(post.createdAt)} · 来自故事现场</div>
                <p class="tf-post-content">${escapeHtml(post.content)}</p>
                ${Array.isArray(post.tags) && post.tags.length ? `<div class="tf-tags">${post.tags.map(tag => `<button data-action="topic-search">#${escapeHtml(String(tag).replace(/^#/, ''))}#</button>`).join('')}</div>` : ''}
                ${renderPostImage(post)}
                <div class="tf-post-tools">
                    <button data-action="toggle-comments" data-post-id="${escapeHtml(post.id)}"><span>◯</span> ${commentsCount || '评论'}</button>
                    <button data-action="noop"><span>↻</span> ${numberLabel(post.reposts) || '转发'}</button>
                    <button class="${post.likedByUser ? 'is-liked' : ''}" data-action="like-post" data-post-id="${escapeHtml(post.id)}"><span>♡</span> ${numberLabel(post.likes) || '赞'}</button>
                    <button class="${post.favorite ? 'is-favorite' : ''}" data-action="favorite-post" data-post-id="${escapeHtml(post.id)}"><span>${post.favorite ? '★' : '☆'}</span> ${post.favorite ? '已收藏' : '收藏'}</button>
                    <button data-action="generate-image" data-post-id="${escapeHtml(post.id)}" ${imageBusy ? 'disabled' : ''}><span>${imageBusy ? '◌' : '▧'}</span> ${imageButtonLabel}</button>
                    <button class="tf-inject-button ${injecting ? 'is-on' : ''}" data-action="toggle-post-injection" data-post-id="${escapeHtml(post.id)}" title="控制这篇帖子是否进入酒馆上下文"><span>${injecting ? '✓' : '+'}</span> ${injecting ? '已选' : '注入'}</button>
                </div>
                ${renderComments(post)}
            </div>
        </div>
    </article>`;
}

function renderComposer() {
    if (!viewState.composerOpen) {
        return `<button class="tf-card tf-compose-collapsed" data-action="toggle-composer"><span>分享故事世界里正在发生的新鲜事…</span><b>我来发帖</b></button>`;
    }
    const snapshot = getChatSnapshot();
    return `<section class="tf-card tf-composer">
        <div class="tf-composer-author">
            ${renderAvatar(snapshot.names.user || '我')}
            <input id="tf-compose-author" value="${escapeHtml(snapshot.names.user || '我')}" maxlength="30" aria-label="发帖昵称">
            <span>@</span><input id="tf-compose-handle" value="me" maxlength="30" aria-label="发帖账号">
        </div>
        <textarea id="tf-compose-content" rows="3" maxlength="2000" placeholder="分享故事世界里正在发生的新鲜事…"></textarea>
        <div class="tf-composer-actions"><button class="tf-ghost-button" data-action="toggle-composer">取消</button><button class="tf-primary-button" data-action="publish-manual">发布</button></div>
    </section>`;
}

function renderFeed(data) {
    const settings = getSettings();
    const active = hasActiveChat();
    return `<div class="tf-feed-column">
        <section class="tf-feed-header">
            <div><h2>${escapeHtml(data.topic || '故事广场')}</h2><p>${active ? `正在浏览「${escapeHtml(getChatSnapshot().characterName)}」聊天专属论坛` : '请先在 SillyTavern 中打开一个角色聊天'}</p></div>
            <div class="tf-feed-header-actions">
                ${renderSwitch({ checked: settings.injection.enabled, action: 'toggle-master-injection', label: '注入酒馆', disabled: !active })}
                <button class="tf-primary-button" data-action="generate-posts" ${viewState.busy || !active ? 'disabled' : ''}>${viewState.busy ? '<span class="tf-spinner"></span> 生成中' : '✦ 刷新论坛'}</button>
            </div>
        </section>
        ${renderComposer()}
        ${viewState.busy ? '<div class="tf-card tf-skeleton"><i></i><p></p><p></p><p></p></div>' : ''}
        <div class="tf-feed-list">
            ${data.posts.length ? [...data.posts].reverse().map(renderPost).join('') : `<section class="tf-card tf-empty"><div>◎</div><h3>论坛还是空的</h3><p>点击“刷新论坛”，AI 会读取最近的故事正文并生成第一批讨论。</p></section>`}
        </div>
    </div>`;
}

function getHotTopics(data) {
    const counts = new Map();
    for (const post of data.posts) {
        for (const tag of post.tags || []) {
            const normalized = String(tag).replace(/^#/, '').trim();
            if (normalized) counts.set(normalized, (counts.get(normalized) || 0) + 1);
        }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
}

function renderSidebar() {
    const tab = getActiveTab();
    const nav = [
        ['feed', '⌂', '首页'],
        ['hot', '⌁', '热议'],
        ['favorites', '☆', '收藏'],
        ['npcs', '♙', 'NPC'],
        ['prompts', '◇', '论坛设定集'],
        ['settings', '⚙', '设置'],
    ];
    return `<aside class="tf-sidebar">
        <nav>${nav.map(([id, icon, label]) => `<button class="${tab === id ? 'is-active' : ''}" data-action="switch-tab" data-tab="${id}"><span>${icon}</span>${label}</button>`).join('')}</nav>
        <div class="tf-sidebar-tip"><b>小提示</b><p>总开关和帖子右下角的“已选”需要同时开启，内容才会进入酒馆上下文。</p></div>
    </aside>`;
}

function renderRightRail(data) {
    const topics = getHotTopics(data);
    const selectedCount = data.posts.filter(post => post.selectedForInjection).length;
    return `<aside class="tf-right-rail">
        <section class="tf-card tf-status-card"><div class="tf-status-title"><span class="tf-live-dot"></span><b>论坛状态</b></div><dl><div><dt>帖子</dt><dd>${data.posts.length}</dd></div><div><dt>待注入</dt><dd>${selectedCount}</dd></div></dl></section>
        <section class="tf-card tf-hot-card"><div class="tf-card-heading"><b>正在热议</b><button data-action="switch-tab" data-tab="hot">查看全部</button></div>
            ${topics.length ? `<ol>${topics.map(([topic, count], index) => `<li><span>${index + 1}</span><div><b>#${escapeHtml(topic)}#</b><small>${count} 条讨论</small></div></li>`).join('')}</ol>` : '<p class="tf-empty-mini">生成帖子后，这里会自动汇总热门话题。</p>'}
        </section>
        <p class="tf-footer-note">微坛只在你配置的 API 请求时联网。<br>帖子按当前酒馆聊天分别保存。</p>
    </aside>`;
}

function renderHot(data) {
    const topics = getHotTopics(data);
    return `<div class="tf-page-column"><section class="tf-page-title"><span>⌁</span><div><h2>热议榜</h2><p>从当前聊天的论坛帖子中实时整理</p></div></section>
        <section class="tf-card tf-hot-page">${topics.length ? topics.map(([topic, count], index) => `<div class="tf-hot-row"><strong>${index + 1}</strong><div><h3>#${escapeHtml(topic)}#</h3><p>${count} 条相关讨论</p></div><span>${index < 3 ? '热' : '新'}</span></div>`).join('') : '<div class="tf-empty"><div>⌁</div><h3>还没有热议话题</h3><p>先回首页生成几篇论坛帖子吧。</p></div>'}</section></div>`;
}

function renderFavorites(data) {
    const favorites = data.posts.filter(post => post.favorite);
    return `<div class="tf-page-column"><section class="tf-page-title"><span>☆</span><div><h2>收藏帖子</h2><p>收藏内容不会被自动清理，只能由你手动取消收藏或删除。</p></div></section>
        <div class="tf-feed-list">${favorites.length ? [...favorites].reverse().map(renderPost).join('') : '<section class="tf-card tf-empty"><div>☆</div><h3>还没有收藏</h3><p>点击帖子下方的“收藏”，它就会永久保留在这里。</p></section>'}</div></div>`;
}

function renderNpcCard(npc, data) {
    const postCount = data.posts.reduce((count, post) => count + (post.npcId === npc.id ? 1 : 0)
        + (post.comments || []).filter(comment => comment.npcId === npc.id).length, 0);
    return `<button class="tf-card tf-npc-card" data-action="open-npc" data-npc-id="${escapeHtml(npc.id)}">
        ${renderAvatar(npc.name, true)}
        <div><h3>${escapeHtml(npc.name)}</h3><p>@${escapeHtml(npc.handle)}</p><span>${escapeHtml(npc.bio || npc.signature || '点击生成 NPC 主页与人设')}</span></div>
        <aside><b>${postCount}</b><small>条发言</small><em class="${npc.inject ? 'is-on' : ''}">${npc.inject ? '注入中' : '未注入'}</em></aside>
    </button>`;
}

function renderNpcProfile(data, npc) {
    const busy = viewState.npcBusy.has(npc.id);
    const evidence = collectNpcEvidence(data, npc.id);
    return `<div class="tf-page-column tf-npc-profile" data-npc-id="${escapeHtml(npc.id)}">
        <button class="tf-back-link" data-action="back-npcs">← 返回 NPC 列表</button>
        <section class="tf-card tf-profile-hero">
            <div class="tf-profile-cover"></div>
            <div class="tf-profile-identity">${renderAvatar(npc.name, true)}<div><h2>${escapeHtml(npc.name)}</h2><p>@${escapeHtml(npc.handle)}</p></div><button class="tf-primary-button" data-action="generate-npc-profile" data-npc-id="${escapeHtml(npc.id)}" ${busy ? 'disabled' : ''}>${busy ? '<span class="tf-spinner"></span> 生成中' : npc.profileGenerated ? '重新生成主页与人设' : '✦ 生成主页与人设'}</button></div>
            <p class="tf-profile-bio">${escapeHtml(npc.bio || '这个 NPC 还没有填写主页简介。')}</p>
            <div class="tf-profile-stats"><span><b>${numberLabel(npc.following)}</b> 关注</span><span><b>${numberLabel(npc.followers)}</b> 粉丝</span><span><b>${evidence.length}</b> 发言</span></div>
        </section>
        <section class="tf-card tf-npc-editor">
            <header><div><h3>NPC 配置与人设库</h3><p>内容可以由 AI 生成，也可以随时手动修改。</p></div>${renderSwitch({ checked: npc.inject, action: 'toggle-npc-injection', label: '注入酒馆' })}</header>
            <div class="tf-settings-grid">
                ${renderField('显示名称', `<input data-npc-field="name" value="${escapeHtml(npc.name)}">`)}
                ${renderField('论坛账号', `<input data-npc-field="handle" value="${escapeHtml(npc.handle)}">`)}
                ${renderField('所在地', `<input data-npc-field="location" value="${escapeHtml(npc.location)}">`)}
                ${renderField('个性签名', `<input data-npc-field="signature" value="${escapeHtml(npc.signature)}">`)}
                ${renderField('主页简介', `<textarea data-npc-field="bio" rows="3">${escapeHtml(npc.bio)}</textarea>`)}
                ${renderField('主页置顶帖', `<textarea data-npc-field="pinnedPost" rows="3">${escapeHtml(npc.pinnedPost)}</textarea>`)}
            </div>
            <label class="tf-npc-persona"><span>详细人设库</span><textarea data-npc-field="persona" rows="10" placeholder="身份、经历、性格、立场、说话方式、关系和信息边界…">${escapeHtml(npc.persona)}</textarea><small>只有上方“注入酒馆”开启时，这段内容才会进入主聊天上下文。</small></label>
            <footer><button class="tf-danger-button" data-action="delete-npc" data-npc-id="${escapeHtml(npc.id)}">删除 NPC 配置</button></footer>
        </section>
        <section class="tf-card tf-npc-evidence"><h3>用于生成人设的公开发言</h3>${evidence.length ? evidence.map(item => `<p>${escapeHtml(item)}</p>`).join('') : '<div class="tf-empty-mini">暂无发言。AI 会根据名字与已选择的故事资料自由生成。</div>'}</section>
    </div>`;
}

function renderNpcs(data) {
    const selected = data.npcs.find(npc => npc.id === viewState.selectedNpcId);
    if (selected) return renderNpcProfile(data, selected);
    return `<div class="tf-page-column"><section class="tf-page-title tf-page-title-actions"><span>♙</span><div><h2>NPC 管理</h2><p>AI 帖子和回帖作者会自动进入这里；点击头像也能打开主页。</p></div><div><button class="tf-primary-button" data-action="add-npc">＋ 手动创建 NPC</button></div></section>
        <div class="tf-info-banner"><b>NPC 人设</b><span>点击任意 NPC 后生成主页，插件会收集该 NPC 已有发言作为证据。每位 NPC 都有独立的人设注入开关。</span></div>
        <div class="tf-npc-grid">${data.npcs.length ? data.npcs.map(npc => renderNpcCard(npc, data)).join('') : '<section class="tf-card tf-empty"><div>♙</div><h3>还没有 NPC</h3><p>生成论坛内容后，AI 作者会自动出现在这里。</p></section>'}</div>
    </div>`;
}

function renderPromptEntry(entry) {
    const keywords = Array.isArray(entry.keywords) ? entry.keywords.join(', ') : '';
    return `<article class="tf-card tf-prompt-entry" data-entry-id="${escapeHtml(entry.id)}">
        <header>
            <div class="tf-prompt-title">${renderSwitch({ checked: entry.enabled, action: 'toggle-prompt-entry', small: true })}<input data-entry-field="title" value="${escapeHtml(entry.title)}" maxlength="80" aria-label="设定名称"></div>
            <button class="tf-danger-link" data-action="delete-prompt-entry" data-entry-id="${escapeHtml(entry.id)}">删除</button>
        </header>
        <div class="tf-prompt-options">
            <label><input type="checkbox" data-entry-field="constant" ${entry.constant ? 'checked' : ''}> 常驻生效</label>
            <label>优先级 <input type="number" data-entry-field="order" value="${Number(entry.order || 0)}" min="-9999" max="9999"></label>
            <label class="tf-keywords">触发词 <input data-entry-field="keywords" value="${escapeHtml(keywords)}" placeholder="多个词用逗号分隔" ${entry.constant ? 'disabled' : ''}></label>
        </div>
        <textarea data-entry-field="content" rows="7" placeholder="写下世界观、论坛风格、常驻人物、禁忌或当前板块规则…">${escapeHtml(entry.content)}</textarea>
        <footer><span>${entry.constant ? '每次生成都会注入' : '最近正文或论坛命中触发词时注入'}</span><span>${String(entry.content || '').length} 字</span></footer>
    </article>`;
}

function renderPrompts() {
    const entries = getSettings().promptEntries;
    return `<div class="tf-page-column tf-prompts-page">
        <section class="tf-page-title tf-page-title-actions"><span>◇</span><div><h2>论坛设定集</h2><p>像世界书一样，控制 AI 如何生成论坛内容；不会直接注入主聊天。</p></div><div><button class="tf-ghost-button" data-action="import-prompts">导入</button><button class="tf-ghost-button" data-action="export-prompts">导出</button><button class="tf-primary-button" data-action="add-prompt-entry">＋ 新建条目</button></div></section>
        <div class="tf-info-banner"><b>触发规则</b><span>“常驻生效”的条目始终加入论坛生成指令；其他条目会扫描最近正文和已有帖子，命中任一触发词后加入。</span></div>
        <div class="tf-prompt-list">${entries.map(renderPromptEntry).join('')}</div>
    </div>`;
}

function renderField(label, body, hint = '') {
    return `<label class="tf-field"><span>${escapeHtml(label)}</span>${body}${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</label>`;
}

function renderWorldInfoCatalog(settings) {
    if (!settings.sources.worldInfo) return '<div class="tf-source-disabled">开启“世界书”总开关后，可逐条选择要给论坛读取的条目。</div>';
    if (viewState.worldLoading) return '<div class="tf-empty-mini"><span class="tf-spinner"></span> 正在读取 SillyTavern 世界书…</div>';
    if (!viewState.worldCatalog.length) return '<div class="tf-empty-mini">没有找到世界书。可以点击“刷新条目”重新读取。</div>';
    return `<div class="tf-world-books">${viewState.worldCatalog.map(book => `<details class="tf-world-book">
        <summary><b>${escapeHtml(book.name)}</b><span>${book.entries.filter(entry => settings.sources.worldInfoEntries[entry.key]).length}/${book.entries.length} 已选择</span></summary>
        <div class="tf-world-book-tools"><button data-action="select-world-book" data-book="${escapeHtml(book.name)}">选择酒馆中启用的条目</button><button data-action="clear-world-book" data-book="${escapeHtml(book.name)}">本书全不选</button></div>
        <div class="tf-world-entry-list">${book.entries.length ? book.entries.map(entry => `<label class="tf-world-entry ${entry.disabledInSillyTavern ? 'is-disabled-in-st' : ''}">
            <input type="checkbox" data-world-entry="${escapeHtml(entry.key)}" ${settings.sources.worldInfoEntries[entry.key] ? 'checked' : ''}>
            <span><b>${escapeHtml(entry.title)}</b><small>UID ${escapeHtml(entry.uid)}${entry.disabledInSillyTavern ? ' · 酒馆中已禁用' : ''}${entry.keywords.length ? ` · ${escapeHtml(entry.keywords.join(', '))}` : ''}</small><em>${escapeHtml(entry.content.slice(0, 140))}${entry.content.length > 140 ? '…' : ''}</em></span>
        </label>`).join('') : '<div class="tf-empty-mini">本书没有条目</div>'}</div>
    </details>`).join('')}</div>`;
}

function renderSettings() {
    const settings = getSettings();
    const profile = getActiveApiProfile();
    const textConfig = getApiConfig('text');
    const imageConfig = getApiConfig('image');
    return `<div class="tf-page-column tf-settings-page">
        <section class="tf-page-title"><span>⚙</span><div><h2>微坛设置</h2><p>所有选项都在这里；带星号的 API 项是开始生成前必填的。</p></div></section>
        <section class="tf-card tf-api-profile-bar">
            <div><b>当前 API 配置</b><p>文本与生图参数会作为一个配置组保存，可随时切换。</p></div>
            <select data-action="select-api-profile">${settings.apiProfiles.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === profile.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select>
            <button class="tf-ghost-button" data-action="new-api-profile">另存为新配置</button><button class="tf-ghost-button" data-action="rename-api-profile">重命名</button><button class="tf-danger-button" data-action="delete-api-profile" ${settings.apiProfiles.length <= 1 ? 'disabled' : ''}>删除</button>
        </section>
        <section class="tf-card tf-settings-section">
            <header><div><span class="tf-section-icon tf-orange">AI</span><div><h3>文本 API</h3><p>独立于 SillyTavern 主聊天连接，兼容 OpenAI Chat Completions 格式。</p></div></div></header>
            <div class="tf-settings-grid">
                ${renderField('API 地址 *', `<input data-api-setting="text.endpoint" value="${escapeHtml(textConfig.endpoint)}" placeholder="https://api.example.com/v1">`, '可填 Base URL，插件会自动补 /chat/completions；也可填完整接口。')}
                ${renderField('API Key', `<input type="password" autocomplete="off" data-secret="text" value="${escapeHtml(textConfig.apiKey)}" placeholder="sk-…">`)}
                ${renderField('模型名称 *', `<input data-api-setting="text.model" value="${escapeHtml(textConfig.model)}" placeholder="例如：gpt-4.1-mini">`)}
                ${renderField('温度', `<input type="number" data-api-setting="text.temperature" value="${Number(textConfig.temperature)}" min="0" max="2" step="0.1">`)}
                ${renderField('最大输出 Tokens', `<input type="number" data-api-setting="text.maxTokens" value="${Number(textConfig.maxTokens)}" min="256" max="32000" step="128">`)}
            </div>
        </section>
        <section class="tf-card tf-settings-section">
            <header><div><span class="tf-section-icon tf-purple">图</span><div><h3>帖子图片</h3><p>可启用独立生图 API；不配置时也能把画面描述显示成文字配图。</p></div></div></header>
            <div class="tf-settings-grid">
                <div class="tf-setting-toggle">${renderSwitch({ checked: imageConfig.enabled, action: 'toggle-image-api', label: '启用真实生图 API' })}</div>
                <div class="tf-setting-toggle">${renderSwitch({ checked: imageConfig.textFallback, action: 'toggle-text-image-fallback', label: '无可用生图配置时显示文字配图' })}</div>
                ${renderField('API 地址（启用生图时必填）', `<input data-api-setting="image.endpoint" value="${escapeHtml(imageConfig.endpoint)}" placeholder="https://api.example.com/v1">`, '可填 Base URL，插件会自动补 /images/generations；也可填完整接口。')}
                ${renderField('API Key', `<input type="password" autocomplete="off" data-secret="image" value="${escapeHtml(imageConfig.apiKey)}" placeholder="留空则不发送 Authorization">`)}
                ${renderField('模型名称（启用生图时必填）', `<input data-api-setting="image.model" value="${escapeHtml(imageConfig.model)}" placeholder="例如：gpt-image-1">`)}
                ${renderField('图片尺寸', `<select data-api-setting="image.size"><option ${imageConfig.size === '1024x1024' ? 'selected' : ''}>1024x1024</option><option ${imageConfig.size === '1024x1536' ? 'selected' : ''}>1024x1536</option><option ${imageConfig.size === '1536x1024' ? 'selected' : ''}>1536x1024</option><option ${imageConfig.size === '512x512' ? 'selected' : ''}>512x512</option></select>`)}
                <div class="tf-setting-toggle">${renderSwitch({ checked: imageConfig.autoGenerate, action: 'toggle-auto-image', label: '每轮自动处理第一篇有画面描述的帖子' })}</div>
            </div>
            <p class="tf-settings-note">当前模式：${hasUsableImageApi(imageConfig) ? '使用真实生图 API。' : imageConfig.textFallback ? '不请求生图接口，帖子将显示文字配图。' : '图片功能已停用，也不会显示文字配图。'}</p>
        </section>
        <section class="tf-card tf-settings-section">
            <header><div><span class="tf-section-icon tf-blue">源</span><div><h3>酒馆内容读取来源</h3><p>四类资料完全独立；世界书还可以精确到每一条。</p></div></div></header>
            <div class="tf-settings-grid">
                <div class="tf-setting-toggle">${renderSwitch({ checked: settings.sources.chat, action: 'toggle-source-chat', label: '读取酒馆正文' })}</div>
                <div class="tf-setting-toggle">${renderSwitch({ checked: settings.sources.userPersona, action: 'toggle-source-user', label: '读取 User 人设' })}</div>
                <div class="tf-setting-toggle">${renderSwitch({ checked: settings.sources.characterPersona, action: 'toggle-source-character', label: '读取 Char 人设与场景' })}</div>
                <div class="tf-setting-toggle">${renderSwitch({ checked: settings.sources.worldInfo, action: 'toggle-source-world', label: '读取选中的世界书条目' })}</div>
                ${renderField('读取最近消息数', `<input type="number" data-setting="generation.contextMessages" value="${Number(settings.generation.contextMessages)}" min="1" max="200">`)}
                ${renderField('每次生成帖子数', `<input type="number" data-setting="generation.postsPerRun" value="${Number(settings.generation.postsPerRun)}" min="1" max="10">`)}
                ${renderField('用户回帖后 AI 回复数', `<input type="number" data-setting="generation.repliesPerRun" value="${Number(settings.generation.repliesPerRun)}" min="1" max="6">`)}
            </div>
            <div class="tf-world-info-picker"><div class="tf-world-picker-head"><div><b>世界书逐条目选择</b><p>这里的选择只影响微坛读取，不会改动 SillyTavern 原世界书。</p></div><button class="tf-ghost-button" data-action="refresh-world-info">刷新条目</button></div>${renderWorldInfoCatalog(settings)}</div>
        </section>
        <section class="tf-card tf-settings-section">
            <header><div><span class="tf-section-icon tf-green">入</span><div><h3>注入主聊天</h3><p>只把总开关开启且逐篇选中的帖子作为系统上下文发送。</p></div></div></header>
            <div class="tf-settings-grid">
                <div class="tf-setting-toggle">${renderSwitch({ checked: settings.injection.enabled, action: 'toggle-master-injection', label: '启用论坛内容注入' })}</div>
                ${renderField('注入深度', `<input type="number" data-setting="injection.depth" value="${Number(settings.injection.depth)}" min="0" max="10000">`, '0 表示靠近最新消息；建议使用 1。')}
                ${renderField('最多注入帖子数', `<input type="number" data-setting="injection.maxPosts" value="${Number(settings.injection.maxPosts)}" min="1" max="50">`)}
                <div class="tf-setting-toggle">${renderSwitch({ checked: settings.injection.includeComments, action: 'toggle-include-comments', label: '连同评论一起注入' })}</div>
                <div class="tf-setting-toggle">${renderSwitch({ checked: settings.injection.npcEnabled, action: 'toggle-npc-master-injection', label: '允许已勾选的 NPC 人设注入' })}</div>
            </div>
        </section>
        <section class="tf-card tf-settings-section">
            <header><div><span class="tf-section-icon tf-purple">存</span><div><h3>帖子保留与自动清理</h3><p>达到数量上限时先删除最旧的普通帖子，收藏帖永远跳过。</p></div></div></header>
            <div class="tf-settings-grid">
                <div class="tf-setting-toggle">${renderSwitch({ checked: settings.retention.autoCleanup, action: 'toggle-auto-cleanup', label: '启用自动清理' })}</div>
                ${renderField('普通帖子数量上限', `<input type="number" data-setting="retention.maxPosts" value="${Number(settings.retention.maxPosts)}" min="1" max="5000">`, '若收藏帖本身超过上限，收藏帖仍会全部保留。')}
                <div class="tf-setting-toggle"><button class="tf-ghost-button" data-action="cleanup-now">立即按当前上限清理</button></div>
            </div>
        </section>
        <section class="tf-card tf-settings-section tf-privacy-section">
            <header><div><span class="tf-section-icon tf-gray">锁</span><div><h3>隐私与数据</h3><p>API Key 默认只保留到本次页面关闭，不写入 SillyTavern 设置。</p></div></div></header>
            <div class="tf-setting-toggle">${renderSwitch({ checked: settings.privacy.rememberApiKeys, action: 'toggle-remember-keys', label: '记住 API Key（会保存到 SillyTavern 用户设置）' })}</div>
            <div class="tf-data-actions"><button class="tf-ghost-button" data-action="export-forum">导出当前论坛</button><button class="tf-ghost-button" data-action="import-forum">导入论坛</button><button class="tf-danger-button" data-action="clear-data">清空微坛数据</button></div>
            <p class="tf-security-note">API Key 只会发送到你填写的接口。若浏览器提示 CORS，请为接口开启跨域，或填写同源反向代理地址。</p>
        </section>
    </div>`;
}

function renderMainPage(data) {
    switch (getActiveTab()) {
        case 'hot': return renderHot(data);
        case 'favorites': return renderFavorites(data);
        case 'npcs': return renderNpcs(data);
        case 'prompts': return renderPrompts();
        case 'settings': return renderSettings();
        default: return renderFeed(data);
    }
}

function renderShell() {
    const data = getForumData();
    const injectionEnabled = getSettings().injection.enabled;
    return `<div class="tf-backdrop" data-action="close"></div>
        <section class="tf-app" role="dialog" aria-modal="true" aria-label="微坛故事论坛">
            <header class="tf-topbar">
                <button class="tf-brand" data-action="switch-tab" data-tab="feed" aria-label="微坛首页"><span class="tf-brand-mark">微</span><b>微坛</b><small>故事正在热议</small></button>
                <div class="tf-search"><span>⌕</span><input placeholder="搜索当前论坛（即将支持）" disabled></div>
                <div class="tf-top-actions"><span class="tf-injection-pill ${injectionEnabled ? 'is-on' : ''}">${injectionEnabled ? '● 注入已开启' : '○ 注入未开启'}</span><button class="tf-close" data-action="close" aria-label="关闭">×</button></div>
            </header>
            <div class="tf-layout ${getActiveTab() === 'feed' ? '' : 'tf-layout-wide'}">${renderSidebar()}<main class="tf-main">${renderMainPage(data)}</main>${getActiveTab() === 'feed' ? renderRightRail(data) : ''}</div>
            <nav class="tf-mobile-nav">
                <button class="${getActiveTab() === 'feed' ? 'is-active' : ''}" data-action="switch-tab" data-tab="feed">⌂<span>首页</span></button>
                <button class="${getActiveTab() === 'hot' ? 'is-active' : ''}" data-action="switch-tab" data-tab="hot">⌁<span>热议</span></button>
                <button class="${getActiveTab() === 'favorites' ? 'is-active' : ''}" data-action="switch-tab" data-tab="favorites">☆<span>收藏</span></button>
                <button class="${getActiveTab() === 'npcs' ? 'is-active' : ''}" data-action="switch-tab" data-tab="npcs">♙<span>NPC</span></button>
                <button class="${getActiveTab() === 'prompts' ? 'is-active' : ''}" data-action="switch-tab" data-tab="prompts">◇<span>设定集</span></button>
                <button class="${getActiveTab() === 'settings' ? 'is-active' : ''}" data-action="switch-tab" data-tab="settings">⚙<span>设置</span></button>
            </nav>
            <input id="tf-import-prompts-file" type="file" accept="application/json,.json" hidden>
            <input id="tf-import-forum-file" type="file" accept="application/json,.json" hidden>
        </section>`;
}

async function hydrateImages() {
    const root = getRoot();
    if (!root || !globalThis.SillyTavern?.libs?.localforage) return;
    const images = [...root.querySelectorAll('img[data-image-key]')];
    await Promise.all(images.map(async image => {
        const key = image.dataset.imageKey;
        try {
            const value = imageMemory.get(key) || await globalThis.SillyTavern.libs.localforage.getItem(key);
            if (!value || !image.isConnected) return;
            imageMemory.set(key, value);
            image.src = value;
            image.className = 'tf-post-image';
            image.closest('.tf-image-loading')?.classList.add('is-loaded');
        } catch (error) {
            console.warn('[微坛] 图片读取失败', error);
        }
    }));
}

function render() {
    const root = getRoot();
    if (!root) return;
    root.innerHTML = renderShell();
    root.toggleAttribute('hidden', !viewState.open);
    document.body.classList.toggle('tf-modal-open', viewState.open);
    updateLaunchers();
    void hydrateImages();
}

function updateLaunchers() {
    const settings = getSettings();
    const fab = document.getElementById(FAB_ID);
    if (fab) fab.toggleAttribute('hidden', !settings.ui.floatingButton);
    const badge = document.querySelector(`#${MENU_ID} .tf-menu-badge`);
    if (badge) {
        badge.textContent = settings.injection.enabled ? '注入开' : '注入关';
        badge.classList.toggle('is-on', settings.injection.enabled);
    }
}

function openForum(tab) {
    if (tab) getSettings().ui.activeTab = tab;
    viewState.open = true;
    render();
    getRoot()?.querySelector('.tf-close')?.focus();
    if (tab === 'settings' && !viewState.worldCatalog.length) void refreshWorldCatalog();
}

function closeForum() {
    viewState.open = false;
    render();
}

function findPost(postId) {
    return getForumData().posts.find(post => post.id === postId);
}

async function removePostImages(posts) {
    for (const post of posts || []) {
        if (!post.imageKey) continue;
        await globalThis.SillyTavern?.libs?.localforage?.removeItem(post.imageKey);
        imageMemory.delete(post.imageKey);
    }
}

async function enforcePostRetention(data, force = false) {
    const settings = getSettings();
    if (!force && !settings.retention.autoCleanup) return 0;
    const result = prunePosts(data.posts, settings.retention.maxPosts);
    data.posts = result.posts;
    await removePostImages(result.removed);
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

async function runGeneration() {
    if (viewState.busy) return;
    if (!hasActiveChat()) {
        notify('warning', '请先打开一个角色聊天');
        return;
    }
    setBusy(true);
    try {
        const settings = getSettings();
        const data = getForumData();
        const snapshot = getChatSnapshot();
        const sourceContext = await getGenerationSourceContext();
        const request = buildForumGenerationRequest({ ...snapshot, settings, existingPosts: data.posts, sourceContext });
        const raw = await generateForumText(getApiConfig('text'), request);
        const generated = normalizeGeneratedForum(raw);
        data.topic = generated.topic;
        data.posts.push(...generated.posts);
        linkNpcAuthors(data, generated.posts);
        const removedCount = await enforcePostRetention(data);
        await saveForumData(data, true);
        syncInjection();
        notify('success', `已生成 ${generated.posts.length} 篇新帖子${removedCount ? `，并清理 ${removedCount} 篇旧帖` : ''}`);

        if (getApiConfig('image').autoGenerate) {
            const target = generated.posts.find(post => post.imagePrompt);
            if (target) await runImageGeneration(target.id, false);
        }
    } catch (error) {
        console.error('[微坛] 生成失败', error);
        notify('error', error.message || '论坛生成失败');
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
        const sourceContext = await getGenerationSourceContext();
        const request = buildThreadReplyRequest({ post, userComment, npcs: data.npcs, sourceContext, settings: getSettings() });
        const raw = await generateForumText(getApiConfig('text'), request);
        const replies = normalizeThreadReplies(raw);
        post.comments.push(...replies);
        linkNpcAuthors(data, [{ ...post, comments: replies }]);
        await saveForumData(data, true);
        syncInjection();
        notify('success', `NPC 继续回复了 ${replies.length} 条`);
    } catch (error) {
        console.error('[微坛] 续回复失败', error);
        notify('error', `你的回帖已保存，但 NPC 续回复失败：${error.message}`);
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
        const sourceContext = await getGenerationSourceContext();
        const request = buildNpcProfileRequest({ npc, evidence: collectNpcEvidence(data, npcId), sourceContext });
        const raw = await generateForumText(getApiConfig('text'), request);
        applyNpcProfile(npc, normalizeNpcProfile(raw));
        await saveForumData(data, true);
        syncInjection();
        notify('success', `${npc.name} 的主页与人设已生成`);
    } catch (error) {
        console.error('[微坛] NPC 主页生成失败', error);
        notify('error', `NPC 主页生成失败：${error.message}`);
    } finally {
        viewState.npcBusy.delete(npcId);
        render();
    }
}

async function runImageGeneration(postId, rerender = true) {
    const post = findPost(postId);
    if (!post || viewState.imageBusy.has(postId)) return;
    let promptText = String(post.imagePrompt || '').trim();
    if (!promptText) {
        promptText = window.prompt('请输入这篇帖子配图的画面描述：', post.content.slice(0, 200))?.trim() || '';
        if (!promptText) return;
        post.imagePrompt = promptText;
    }
    const imageConfig = getApiConfig('image');
    if (!hasUsableImageApi(imageConfig)) {
        await saveForumData(getForumData(), true);
        if (imageConfig.textFallback) notify('success', '未启用或未完整配置生图 API，已改用文字配图');
        else notify('warning', '图片功能未启用；请在“设置 → 帖子图片”中开启生图 API 或文字配图');
        if (rerender) render();
        return;
    }
    viewState.imageBusy.add(postId);
    if (rerender) render();
    try {
        const image = await generateForumImage(imageConfig, promptText);
        if (post.imageKey) {
            await globalThis.SillyTavern?.libs?.localforage?.removeItem(post.imageKey);
            imageMemory.delete(post.imageKey);
        }
        if (image.type === 'base64') {
            const key = `tavern-forum:image:${post.id}`;
            if (!globalThis.SillyTavern?.libs?.localforage) throw new Error('当前 SillyTavern 不支持本地图片存储');
            await globalThis.SillyTavern.libs.localforage.setItem(key, image.value);
            imageMemory.set(key, image.value);
            post.imageKey = key;
            post.imageUrl = '';
        } else {
            post.imageUrl = image.value;
            post.imageKey = '';
        }
        await saveForumData(getForumData(), true);
        notify('success', '帖子配图已生成');
    } catch (error) {
        console.error('[微坛] 生图失败', error);
        notify('error', error.message || '生图失败');
    } finally {
        viewState.imageBusy.delete(postId);
        if (rerender) render();
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

function readJsonFile(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return Promise.resolve(null);
    return file.text().then(text => JSON.parse(text));
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
        'toggle-master-injection': 'injection.enabled',
        'toggle-include-comments': 'injection.includeComments',
        'toggle-npc-master-injection': 'injection.npcEnabled',
        'toggle-source-chat': 'sources.chat',
        'toggle-source-user': 'sources.userPersona',
        'toggle-source-character': 'sources.characterPersona',
        'toggle-source-world': 'sources.worldInfo',
        'toggle-auto-cleanup': 'retention.autoCleanup',
    };
    if (paths[action]) setSettingByPath(paths[action], checked);
    else if (action === 'toggle-image-api') updateApiConfig('image', 'enabled', checked);
    else if (action === 'toggle-text-image-fallback') updateApiConfig('image', 'textFallback', checked);
    else if (action === 'toggle-auto-image') updateApiConfig('image', 'autoGenerate', checked);
    else if (action === 'toggle-remember-keys') setRememberApiKeys(checked);
    if (action === 'toggle-source-world' && checked && !viewState.worldCatalog.length) void refreshWorldCatalog();
    render();
}

async function handleRootClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'noop' || action === 'topic-search') return;
    if (action === 'close') return closeForum();
    if (action === 'switch-tab') return setActiveTab(target.dataset.tab);
    if (action === 'open-npc') {
        const npcId = target.dataset.npcId;
        const npc = getForumData().npcs.find(item => item.id === npcId);
        if (!npc) return;
        viewState.selectedNpcId = npcId;
        getSettings().ui.activeTab = 'npcs';
        saveSettings();
        render();
        if (!npc.profileGenerated && !npc.persona) void runNpcProfileGeneration(npcId);
        return;
    }
    if (action === 'back-npcs') {
        viewState.selectedNpcId = '';
        return render();
    }
    if (action === 'add-npc') {
        const name = window.prompt('NPC 显示名称：', '新 NPC')?.trim();
        if (!name) return;
        const handle = window.prompt('NPC 论坛账号：', `npc${Math.floor(Math.random() * 9000 + 1000)}`)?.trim();
        if (!handle) return;
        const data = getForumData();
        const npc = createNpc({ name, handle });
        data.npcs.push(npc);
        await saveForumData(data, true);
        viewState.selectedNpcId = npc.id;
        return render();
    }
    if (action === 'generate-npc-profile') return void runNpcProfileGeneration(target.dataset.npcId);
    if (action === 'delete-npc') {
        const npcId = target.dataset.npcId;
        if (!window.confirm('确定删除这个 NPC 配置吗？已有帖子不会删除，但将不再把这些作者自动识别为该 NPC。')) return;
        const data = getForumData();
        data.npcs = data.npcs.filter(npc => npc.id !== npcId);
        for (const post of data.posts) {
            if (post.npcId === npcId) { post.npcId = ''; post.isAi = false; }
            for (const comment of post.comments || []) {
                if (comment.npcId === npcId) { comment.npcId = ''; comment.isAi = false; }
            }
        }
        await saveForumData(data, true);
        syncInjection();
        viewState.selectedNpcId = '';
        return render();
    }
    if (action === 'toggle-composer') {
        viewState.composerOpen = !viewState.composerOpen;
        return render();
    }
    if (action === 'generate-posts') return void runGeneration();
    if (action === 'publish-manual') {
        try {
            const data = getForumData();
            data.posts.push(createManualPost({
                author: getRoot().querySelector('#tf-compose-author')?.value,
                handle: getRoot().querySelector('#tf-compose-handle')?.value,
                content: getRoot().querySelector('#tf-compose-content')?.value,
            }));
            const removedCount = await enforcePostRetention(data);
            await saveForumData(data, true);
            syncInjection();
            viewState.composerOpen = false;
            if (removedCount) notify('info', `已按上限清理 ${removedCount} 篇旧帖`);
            render();
        } catch (error) {
            notify('warning', error.message);
        }
        return;
    }

    const postId = target.dataset.postId;
    const post = postId ? findPost(postId) : null;
    if (action === 'like-post' && post) {
        post.likedByUser = !post.likedByUser;
        post.likes = Math.max(0, Number(post.likes || 0) + (post.likedByUser ? 1 : -1));
        await saveForumData(getForumData());
        return render();
    }
    if (action === 'favorite-post' && post) {
        post.favorite = !post.favorite;
        await saveForumData(getForumData(), true);
        notify('success', post.favorite ? '已收藏，这篇帖子不会被自动清理' : '已取消收藏');
        return render();
    }
    if (action === 'toggle-comments' && post) {
        if (viewState.expandedComments.has(postId)) viewState.expandedComments.delete(postId);
        else viewState.expandedComments.add(postId);
        return render();
    }
    if (action === 'start-reply' && post) {
        viewState.expandedComments.add(postId);
        viewState.replyTarget = { postId, commentId: target.dataset.commentId || '', handle: target.dataset.replyHandle || post.handle };
        render();
        getRoot().querySelector(`[data-post-id="${CSS.escape(postId)}"] .tf-reply-content`)?.focus();
        return;
    }
    if (action === 'cancel-reply' && post) {
        viewState.replyTarget = null;
        return render();
    }
    if (action === 'submit-reply' && post) {
        try {
            const card = target.closest('[data-post-id]');
            const reply = createManualComment({
                author: card.querySelector('.tf-reply-author')?.value,
                handle: card.querySelector('.tf-reply-handle')?.value,
                content: card.querySelector('.tf-reply-content')?.value,
                replyTo: viewState.replyTarget?.postId === postId ? viewState.replyTarget.handle : post.handle,
            });
            post.comments.push(reply);
            viewState.replyTarget = null;
            await saveForumData(getForumData(), true);
            syncInjection();
            return void runThreadContinuation(postId, reply);
        } catch (error) {
            notify('warning', error.message);
            return;
        }
    }
    if (action === 'toggle-post-injection' && post) {
        post.selectedForInjection = !post.selectedForInjection;
        await saveForumData(getForumData());
        syncInjection();
        return render();
    }
    if (action === 'generate-image' && post) return void runImageGeneration(postId);
    if (action === 'delete-post' && post) {
        if (!window.confirm(post.favorite ? '这是一篇收藏帖。确定仍要永久删除吗？' : '确定删除这篇帖子吗？')) return;
        const data = getForumData();
        data.posts = data.posts.filter(item => item.id !== postId);
        if (post.imageKey) {
            await globalThis.SillyTavern?.libs?.localforage?.removeItem(post.imageKey);
            imageMemory.delete(post.imageKey);
        }
        await saveForumData(data, true);
        syncInjection();
        return render();
    }

    if (action === 'new-api-profile') {
        const name = window.prompt('新 API 配置名称：', `${getActiveApiProfile().name} 副本`)?.trim();
        if (!name) return;
        createApiProfile(name, true);
        notify('success', `已保存并切换到“${name}”`);
        return render();
    }
    if (action === 'rename-api-profile') {
        const profile = getActiveApiProfile();
        const name = window.prompt('重命名 API 配置：', profile.name)?.trim();
        if (!name) return;
        renameApiProfile(profile.id, name);
        return render();
    }
    if (action === 'delete-api-profile') {
        const profile = getActiveApiProfile();
        if (!window.confirm(`确定删除 API 配置“${profile.name}”吗？`)) return;
        try {
            deleteApiProfile(profile.id);
            return render();
        } catch (error) {
            notify('warning', error.message);
            return;
        }
    }
    if (action === 'refresh-world-info') return void refreshWorldCatalog(true);
    if (action === 'select-world-book' || action === 'clear-world-book') {
        const book = viewState.worldCatalog.find(item => item.name === target.dataset.book);
        if (!book) return;
        const selection = getSettings().sources.worldInfoEntries;
        for (const entry of book.entries) selection[entry.key] = action === 'select-world-book' ? !entry.disabledInSillyTavern : false;
        saveSettings();
        return render();
    }
    if (action === 'cleanup-now') {
        const data = getForumData();
        const removedCount = await enforcePostRetention(data, true);
        await saveForumData(data, true);
        syncInjection();
        notify('success', removedCount ? `已清理 ${removedCount} 篇旧帖子，收藏帖全部保留` : '当前不需要清理');
        return render();
    }

    if (action === 'add-prompt-entry') {
        getSettings().promptEntries.unshift({ id: createId('prompt'), title: '新设定', enabled: true, constant: false, keywords: [], order: 0, content: '' });
        saveSettings();
        return render();
    }
    if (action === 'delete-prompt-entry') {
        if (!window.confirm('确定删除这条论坛设定吗？')) return;
        const id = target.dataset.entryId;
        getSettings().promptEntries = getSettings().promptEntries.filter(entry => entry.id !== id);
        saveSettings();
        return render();
    }
    if (action === 'export-prompts') {
        return downloadJson('tavern-forum-prompts.json', { version: 1, promptEntries: getSettings().promptEntries });
    }
    if (action === 'import-prompts') return getRoot().querySelector('#tf-import-prompts-file')?.click();
    if (action === 'export-forum') {
        return downloadJson(`tavern-forum-${Date.now()}.json`, getForumData());
    }
    if (action === 'import-forum') return getRoot().querySelector('#tf-import-forum-file')?.click();
    if (action === 'clear-data') {
        if (!window.confirm('这会清空微坛的全局设置和当前聊天论坛，且无法撤销。确定继续吗？')) return;
        await clearAllData();
        notify('success', '微坛数据已清空');
        return render();
    }
}

function handleRootInput(event) {
    const target = event.target;
    if (target.matches('[data-secret]')) {
        setSessionApiKey(target.dataset.secret, target.value);
        return;
    }
    if (target.dataset.npcField) {
        const container = target.closest('[data-npc-id]');
        const npc = getForumData().npcs.find(item => item.id === container?.dataset.npcId);
        if (!npc) return;
        npc[target.dataset.npcField] = target.value;
        npc.updatedAt = Date.now();
        void saveForumData(getForumData());
        if (target.dataset.npcField === 'persona') syncInjection();
        return;
    }
    const entryElement = target.closest('[data-entry-id]');
    if (entryElement && target.dataset.entryField) {
        const entry = getSettings().promptEntries.find(item => item.id === entryElement.dataset.entryId);
        if (!entry) return;
        const field = target.dataset.entryField;
        if (field === 'keywords') entry.keywords = target.value.split(/[,，\n]/).map(value => value.trim()).filter(Boolean);
        else if (field === 'order') entry.order = Number(target.value || 0);
        else if (field === 'constant' || field === 'enabled') entry[field] = target.checked;
        else entry[field] = target.value;
        saveSettings();
    }
}

function handleRootChange(event) {
    const target = event.target;
    if (target.dataset.action?.startsWith('toggle-') && target.type === 'checkbox') {
        if (target.dataset.action === 'toggle-prompt-entry') {
            const entryElement = target.closest('[data-entry-id]');
            const entry = getSettings().promptEntries.find(item => item.id === entryElement?.dataset.entryId);
            if (entry) {
                entry.enabled = target.checked;
                saveSettings();
            }
            return render();
        }
        if (target.dataset.action === 'toggle-npc-injection') {
            const npcId = target.closest('[data-npc-id]')?.dataset.npcId;
            const npc = getForumData().npcs.find(item => item.id === npcId);
            if (npc) {
                npc.inject = target.checked;
                void saveForumData(getForumData());
                syncInjection();
            }
            return render();
        }
        return handleSwitchAction(target.dataset.action, target.checked);
    }
    if (target.dataset.action === 'select-api-profile') {
        setActiveApiProfile(target.value);
        return render();
    }
    if (target.dataset.apiSetting) {
        const [kind, field] = target.dataset.apiSetting.split('.');
        const current = getApiConfig(kind)[field];
        updateApiConfig(kind, field, typeof current === 'number' ? Number(target.value) : target.value);
        return;
    }
    if (target.dataset.worldEntry) {
        getSettings().sources.worldInfoEntries[target.dataset.worldEntry] = target.checked;
        saveSettings();
        return render();
    }
    if (target.dataset.setting) {
        const current = getSettingByPath(target.dataset.setting);
        const value = typeof current === 'number' ? Number(target.value) : target.value;
        setSettingByPath(target.dataset.setting, value);
        return;
    }
    if (target.dataset.entryField === 'constant') {
        handleRootInput(event);
        return render();
    }
    if (target.id === 'tf-import-prompts-file') {
        void readJsonFile(target).then(payload => {
            const entries = Array.isArray(payload) ? payload : payload?.promptEntries;
            if (!Array.isArray(entries)) throw new Error('文件中没有 promptEntries 数组');
            const normalized = entries.filter(entry => entry && typeof entry.content === 'string').map(entry => ({
                id: createId('prompt'),
                title: String(entry.title || '导入设定'),
                enabled: entry.enabled !== false,
                constant: Boolean(entry.constant),
                keywords: Array.isArray(entry.keywords) ? entry.keywords.map(String) : [],
                order: Number(entry.order || 0),
                content: entry.content,
            }));
            getSettings().promptEntries.push(...normalized);
            saveSettings();
            notify('success', `已导入 ${normalized.length} 条论坛设定`);
            render();
        }).catch(error => notify('error', `导入失败：${error.message}`));
    }
    if (target.id === 'tf-import-forum-file') {
        void readJsonFile(target).then(async payload => {
            if (!payload || !Array.isArray(payload.posts)) throw new Error('文件中没有 posts 数组');
            const data = { ...payload, version: 2, updatedAt: Date.now() };
            linkNpcAuthors(data);
            const removedCount = await enforcePostRetention(data);
            await saveForumData(data, true);
            syncInjection();
            notify('success', `已导入 ${payload.posts.length} 篇帖子${removedCount ? `，按上限清理 ${removedCount} 篇` : ''}`);
            render();
        }).catch(error => notify('error', `导入失败：${error.message}`));
    }
}

function installLaunchers() {
    if (!document.getElementById(MENU_ID)) {
        const menu = document.getElementById('extensionsMenu');
        if (menu) {
            const item = document.createElement('div');
            item.id = MENU_ID;
            item.className = 'list-group-item flex-container flexGap5 interactable tavern-forum-launcher';
            item.tabIndex = 0;
            item.innerHTML = '<span class="fa-solid fa-comments"></span><span>打开微坛</span><small class="tf-menu-badge">注入关</small>';
            item.addEventListener('click', () => openForum('feed'));
            item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') openForum('feed'); });
            menu.append(item);
        }
    }
    if (!document.getElementById(FAB_ID)) {
        const fab = document.createElement('button');
        fab.id = FAB_ID;
        fab.type = 'button';
        fab.title = '打开微坛';
        fab.setAttribute('aria-label', '打开微坛');
        fab.innerHTML = '<span>微</span><i></i>';
        fab.addEventListener('click', () => openForum('feed'));
        document.body.append(fab);
    }
    if (!document.getElementById(SETTINGS_BLOCK_ID)) {
        const settingsPanel = document.getElementById('extensions_settings2');
        if (settingsPanel) {
            const block = document.createElement('div');
            block.id = SETTINGS_BLOCK_ID;
            block.className = 'extension_container';
            block.innerHTML = '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>微坛 · 故事论坛</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><p>微博风格的故事内论坛，可独立配置文本与生图 API。</p><button type="button" class="menu_button">打开微坛设置</button></div></div>';
            block.querySelector('button').addEventListener('click', () => openForum('settings'));
            settingsPanel.append(block);
        }
    }
    updateLaunchers();
}

function bindSillyTavernEvents() {
    const context = globalThis.SillyTavern.getContext();
    const refresh = () => {
        syncInjection();
        if (viewState.open) render();
    };
    if (context.eventTypes?.CHAT_CHANGED) context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
        viewState.selectedNpcId = '';
        viewState.replyTarget = null;
        viewState.expandedComments.clear();
        refresh();
    });
    if (context.eventTypes?.MESSAGE_EDITED) context.eventSource.on(context.eventTypes.MESSAGE_EDITED, refresh);
    if (context.eventTypes?.MESSAGE_DELETED) context.eventSource.on(context.eventTypes.MESSAGE_DELETED, refresh);
    if (context.eventTypes?.WORLDINFO_UPDATED) context.eventSource.on(context.eventTypes.WORLDINFO_UPDATED, () => {
        viewState.worldCatalog = [];
        if (viewState.open && getActiveTab() === 'settings') void refreshWorldCatalog();
    });
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
        document.body.append(root);
    }
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && viewState.open) closeForum();
    });
    installLaunchers();
    bindSillyTavernEvents();
    viewState.initialized = true;
    render();
}

export function refreshForumUi() {
    if (viewState.initialized) render();
}
