export const MODULE_ID = 'tavern_forum';
export const CHAT_DATA_KEY = 'tavern_forum_data';
export const INJECTION_ID = 'tavern_forum_selected_posts';
export const NPC_INJECTION_ID = 'tavern_forum_npc_personas';
export const EXTENSION_PROMPT_POSITION_IN_CHAT = 1;
export const EXTENSION_PROMPT_ROLE_SYSTEM = 0;

export const DEFAULT_FORUM_PROMPT = `你是故事世界中的论坛模拟器。请根据已提供的故事上下文，生成像真实中文社交平台一样自然的帖子：
- 论坛的主角是整个世界，而不是 User。User 只是世界中的普通一员；没有直接关联时，不要主动提及、揣测或围绕 User 展开讨论。
- 帖子应覆盖角色各自的生活、社会新闻、兴趣、关系、传闻、公共事件与琐碎日常，让世界看起来在独立运转。
- 不要复述剧情摘要，要写成不同立场的普通网友正在讨论正在发生的事。
- 作者之间要有明显不同的口吻、知识范围、态度和表达习惯。
- 可以有误解、传闻、玩梗和争论，但不得凭空改变已经确定的关键事实。
- 帖子内容应推动沉浸感，避免提到“角色扮演”“模型”“提示词”或“用户”。
- 最终帖子数据放在 <forum_data> 与 </forum_data> 中；标记外可以保留模型自己的分析，标记内不要写注释或说明文字。`;

export const DEFAULT_SETTINGS = Object.freeze({
    activeApiProfileId: 'sillytavern-default',
    apiProfiles: [
        {
            id: 'sillytavern-default',
            name: '酒馆当前连接',
            reserved: true,
            text: {
                provider: 'sillytavern',
                endpoint: '',
                apiKey: '',
                model: '',
                temperature: 0.9,
                maxTokens: 8192,
                extraParameters: [],
            },
            image: {
                enabled: false,
                textFallback: true,
                endpoint: '',
                apiKey: '',
                model: '',
                size: '1024x1024',
                autoGenerate: false,
            },
        },
        {
            id: 'default-api-profile',
            name: '自定义 API',
            text: {
                provider: 'custom',
                endpoint: '',
                apiKey: '',
                model: '',
                temperature: 0.9,
                maxTokens: 8192,
                extraParameters: [],
            },
            image: {
                enabled: false,
                textFallback: true,
                endpoint: '',
                apiKey: '',
                model: '',
                size: '1024x1024',
                autoGenerate: false,
            },
        },
    ],
    textApi: {
        provider: 'custom',
        endpoint: '',
        apiKey: '',
        model: '',
        temperature: 0.9,
        maxTokens: 8192,
        extraParameters: [],
    },
    imageApi: {
        enabled: false,
        textFallback: true,
        endpoint: '',
        apiKey: '',
        model: '',
        size: '1024x1024',
        autoGenerate: false,
    },
    privacy: {
        rememberApiKeys: false,
    },
    generation: {
        readChat: true,
        autoRefreshOnMessage: false,
        contextMessages: 20,
        postsPerRun: 4,
        postsMin: 2,
        postsMax: 5,
        commentsMin: 0,
        commentsMax: 3,
        repliesPerRun: 2,
        repliesMin: 1,
        repliesMax: 3,
    },
    sources: {
        chat: true,
        userPersona: true,
        characterPersona: true,
        worldInfo: false,
        worldInfoBooks: {},
        worldInfoEntries: {},
        sillyTavernPreset: false,
        presetEntries: {},
    },
    injection: {
        enabled: false,
        npcEnabled: true,
        depth: 1,
        maxPosts: 8,
        tokenBudget: 2000,
        includeComments: true,
    },
    retention: {
        autoCleanup: true,
        maxPosts: 100,
    },
    appearance: {
        forumName: '微坛',
        fontFamily: '',
        primaryColor: '#0095f6',
        backgroundColor: '#fafafa',
        cardColor: '#ffffff',
        textColor: '#262626',
        topNavColor: '#ffffff',
        sideNavColor: '#f7f7f7',
        activeNavColor: '#ffffff',
        navDividerColor: '#e5e7eb',
        postColor: '#ffffff',
        commentColor: '#ffffff',
        postOpacity: 0.85,
        commentOpacity: 0.94,
        postBlur: 16,
        cardOpacity: 0.92,
        glassBlur: 16,
        brandIconUrl: '',
        brandIconKey: '',
        wallpaperUrl: '',
        wallpaperKey: '',
        customCss: '',
        customCssCleared: false,
    },
    profile: {
        displayName: '',
        handle: 'me',
        bio: '',
        avatarUrl: '',
        avatarKey: '',
        backgroundUrl: '',
        backgroundKey: '',
    },
    avatars: {
        randomForGeneratedRoles: true,
    },
    notifications: {
        reply: true,
        mention: true,
        like: true,
        follow: true,
        mutual: true,
        system: true,
    },
    social: {
        roleDirectMessages: false,
    },
    informationBoundary: {
        enabled: true,
        worldInfoEntries: {},
    },
    avatarLibrary: [],
    promptEntries: [
        {
            id: 'default-forum-style',
            title: '论坛基础规则',
            enabled: true,
            constant: true,
            keywords: [],
            order: 100,
            role: 'system',
            content: DEFAULT_FORUM_PROMPT,
        },
    ],
    ui: {
        floatingButton: true,
        floatingButtonImageUrl: '',
        floatingButtonImageKey: '',
        floatingButtonPosition: { x: null, y: null },
        activeTab: 'home',
        meSection: 'overview',
    },
});

export const EMPTY_FORUM_DATA = Object.freeze({
    version: 9,
    topic: '故事广场',
    posts: [],
    npcs: [],
    conversations: [],
    notifications: [],
    facts: [],
    createdAt: 0,
    updatedAt: 0,
});
