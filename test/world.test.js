import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../src/constants.js';
import { createNpc, normalizeForumDataShape } from '../src/forum.js';
import {
    applyModerationProposal,
    applyWorldUpdates,
    buildLinkedWorldInstruction,
    buildWorldModuleInjection,
    createLocalFortune,
    createLocalHealthEvent,
    createPostReport,
    evaluateModuleGeneration,
    filterWorldUpdatesBySafety,
    normalizeProactiveDirectMessages,
    normalizeWorldUpdates,
    roleCan,
} from '../src/world.js';

function settings() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

test('world state migrates tasks, fortune, inventory and reports', () => {
    const data = normalizeForumDataShape({
        version: 9,
        posts: [{ id: 'p1', author: '甲', handle: 'a', content: '测试', comments: [] }],
        world: {
            tasks: [{ title: '寻找钥匙', description: '去旧屋看看' }],
            fortune: { label: '小吉', score: 12, effects: ['更容易发现线索'] },
            inventory: [{ name: '旧钥匙', quantity: 1 }],
            reports: [{ postId: 'p1', reason: '疑似违规' }],
        },
    });
    assert.equal(data.version, 12);
    assert.equal(data.world.tasks[0].status, 'offered');
    assert.equal(data.world.fortune.label, '小吉');
    assert.equal(data.world.inventory[0].quantity, 1);
    assert.equal(data.world.reports[0].status, 'pending');
    assert.equal(data.world.companion.name, '团子');
});

test('travel module keeps one persistent companion and its journey log', () => {
    const config = settings();
    config.modules.travel.enabled = true;
    config.modules.travel.injectIntoChat = true;
    const data = normalizeForumDataShape({});
    assert.equal(data.world.companion.weather, 'auto');
    assert.equal(data.world.companion.timeOfDay, 'auto');
    const customizedRoom = normalizeForumDataShape({ world: { companion: { weather: 'rain', timeOfDay: 'night', deviceSkin: 'terminal' } } });
    assert.equal(customizedRoom.world.companion.weather, 'rain');
    assert.equal(customizedRoom.world.companion.timeOfDay, 'night');
    assert.equal(customizedRoom.world.companion.deviceSkin, 'terminal');
    const updates = normalizeWorldUpdates('<module_data>{"worldUpdates":{"travel":{"companion":{"name":"豆包","species":"机械鸟","status":"away","mood":"兴奋","destination":"旧钟楼","message":"这里的风很大。","bond":8},"journeys":[{"traveler":"豆包","destination":"旧钟楼","status":"away","notes":"在屋檐下发现一枚齿轮。","souvenir":"旧齿轮"}]}}}</module_data>');
    applyWorldUpdates(data, updates, config);
    assert.equal(data.world.companion.name, '豆包');
    assert.equal(data.world.companion.status, 'away');
    assert.equal(data.world.trips[0].destination, '旧钟楼');
    assert.match(buildWorldModuleInjection(data, config, 'travel'), /机械鸟/);
    assert.match(buildWorldModuleInjection(data, config, 'travel'), /旧钟楼/);
});

test('linked generation prompt includes only enabled selected modules', () => {
    const config = settings();
    config.modules.tasks.enabled = true;
    config.modules.tasks.generationMode = 'linked';
    config.modules.health.enabled = false;
    const prompt = buildLinkedWorldInstruction({ settings: config, data: normalizeForumDataShape({}) });
    assert.match(prompt, /任务模块规则/);
    assert.doesNotMatch(prompt, /健康模块规则/);
    assert.match(prompt, /worldUpdates/);
});

test('local fortune is deterministic per day and does not require an API', () => {
    const first = createLocalFortune(new Date('2026-08-21T08:00:00'), 'chat-a');
    const second = createLocalFortune(new Date('2026-08-21T22:00:00'), 'chat-a');
    assert.equal(first.date, second.date);
    assert.equal(first.score, second.score);
    assert.equal(first.local, true);
    assert.equal(typeof first.modifiers.travelMessage, 'number');
    assert.match(first.modifiers.luckyDirection, /东|南|西|北/);
});

test('local health events create an interactive fictional care record without an API', () => {
    const item = createLocalHealthEvent({ subject: '林舟', seed: 'case-a' });
    assert.equal(item.subject, '林舟');
    assert.equal(item.local, true);
    assert.equal(item.stage, 'noticed');
    assert.ok(item.symptoms);
    assert.ok(item.careNote);
});

test('module probability and quiet hours are evaluated locally', () => {
    const config = settings();
    const data = normalizeForumDataShape({});
    config.modules.tasks.enabled = true;
    config.modules.tasks.probability = 0;
    assert.equal(evaluateModuleGeneration(config, data, 'tasks', { automatic: true, random: () => 0.5 }).code, 'probability');
    config.automation.quietHours.enabled = true;
    config.automation.quietHours.start = '00:00';
    config.automation.quietHours.end = '23:59';
    assert.equal(evaluateModuleGeneration(config, data, 'tasks', { automatic: true, date: new Date('2026-08-21T12:00:00') }).code, 'quiet-hours');
});

test('narrative bans discard forbidden events without a retry', () => {
    const config = settings();
    config.automation.forbiddenEvents.permanentDeath = true;
    config.automation.forbiddenEvents.scam = true;
    const result = filterWorldUpdatesBySafety({
        tasks: [{ title: '骗局', description: '交钱', scam: true }, { title: '普通委托', description: '送信', scam: false }],
        health: [{ subject: '甲', name: '死亡', severity: 'serious', symptoms: '角色死亡' }],
    }, config, normalizeForumDataShape({}));
    assert.equal(result.updates.tasks.length, 1);
    assert.equal(result.updates.health.length, 0);
    assert.deepEqual(result.blocked.sort(), ['永久死亡', '骗局'].sort());
});

test('proactive direct messages are read from the same forum response', () => {
    const messages = normalizeProactiveDirectMessages('<forum_data>{"posts":[],"dmEvents":[{"targetHandle":"@lin","content":"你在吗？","reason":"有事商量"}]}</forum_data>');
    assert.deepEqual(messages, [{ targetHandle: 'lin', content: '你在吗？', reason: '有事商量' }]);
});

test('world updates apply without overwriting disabled modules', () => {
    const config = settings();
    config.modules.tasks.enabled = true;
    config.modules.fortune.enabled = false;
    const data = normalizeForumDataShape({});
    const updates = normalizeWorldUpdates('<module_data>{"worldUpdates":{"tasks":[{"title":"送信","description":"送到城北"}],"fortune":{"label":"大吉","score":88}}}</module_data>');
    applyWorldUpdates(data, updates, config);
    assert.equal(data.world.tasks.length, 1);
    assert.equal(data.world.fortune, null);
});

test('module injection respects each module switch', () => {
    const config = settings();
    config.modules.tasks.enabled = true;
    config.modules.tasks.injectIntoChat = true;
    const data = normalizeForumDataShape({ world: { tasks: [{ title: '调查', description: '查看码头', status: 'accepted' }] } });
    assert.match(buildWorldModuleInjection(data, config), /调查/);
    config.modules.tasks.injectIntoChat = false;
    assert.equal(buildWorldModuleInjection(data, config), '');
});

test('moderation permissions gate destructive AI actions and keep confirmation proposals', () => {
    const config = settings();
    config.modules.moderation.enabled = true;
    config.modules.moderation.automation = 'confirm';
    const moderator = createNpc({ name: '管理员', handle: 'mod', persona: '社区管理员', permissionRole: 'moderator' });
    const data = normalizeForumDataShape({
        posts: [{ id: 'p1', author: '甲', handle: 'a', content: '帖子', comments: [] }],
        npcs: [moderator],
    });
    assert.equal(roleCan(config, moderator, 'deletePost'), true);
    applyWorldUpdates(data, { moderationActions: [{ actorHandle: 'mod', postId: 'p1', action: 'hide', reason: '违反规则' }] }, config);
    assert.equal(data.posts[0].moderation.hidden, false);
    const proposal = data.world.proposals[0];
    assert.ok(proposal);
    assert.equal(applyModerationProposal(data, config, proposal, true), true);
    assert.equal(data.posts[0].moderation.hidden, true);
});

test('reports are local world records and do not enter module injection', () => {
    const config = settings();
    config.modules.moderation.enabled = true;
    config.modules.moderation.injectIntoChat = true;
    const data = normalizeForumDataShape({ posts: [{ id: 'p1', author: '甲', handle: 'a', content: '帖子', comments: [] }] });
    data.world.reports.push(createPostReport({ postId: 'p1', reason: '测试举报' }));
    assert.doesNotMatch(buildWorldModuleInjection(data, config), /测试举报/);
});

test('optional AI fortune and system AI administrator are both off by default', () => {
    const config = settings();
    assert.equal(config.modules.fortune.allowApiDraw, false);
    assert.equal(config.moderation.systemAdminEnabled, false);
    assert.equal(config.moderation.npcReportsEnabled, true);
});

test('returned companion souvenirs settle into inventory exactly once', () => {
    const config = settings();
    config.modules.travel.enabled = true;
    const data = normalizeForumDataShape({ world: { companion: { name: '团子', status: 'away' } } });
    const updates = normalizeWorldUpdates({ worldUpdates: { travel: { companion: { status: 'home', carrying: '蓝色羽毛', message: '我回来了。' }, journeys: [{ id: 'trip-return', traveler: '团子', destination: '湖边', status: 'returned', notes: '看见了水鸟。', souvenir: '蓝色羽毛' }] } } });
    applyWorldUpdates(data, updates, config);
    assert.match(data.world.companion.message, /背包/);
    applyWorldUpdates(data, updates, config);
    assert.equal(data.world.inventory.filter(item => item.name === '蓝色羽毛').length, 1);
    assert.ok(data.world.trips[0].souvenirClaimedAt);
});

test('NPC reports reuse linked forum output and system admin proposals remain user-confirmable', () => {
    const config = settings();
    config.modules.moderation.enabled = true;
    config.moderation.npcReportsEnabled = true;
    const reporter = createNpc({ name: '小林', handle: 'lin', persona: '普通居民' });
    const data = normalizeForumDataShape({
        posts: [{ id: 'p1', npcId: 'author-1', author: '甲', handle: 'a', content: '违反社区规则的帖子', comments: [] }],
        npcs: [reporter],
    });
    const prompt = buildLinkedWorldInstruction({ settings: config, data });
    assert.match(prompt, /NPC 站内举报/);
    assert.match(prompt, /"reports"/);
    const updates = normalizeWorldUpdates({ worldUpdates: { reports: [{ reporterHandle: 'lin', postId: 'p1', reason: '泄露了不该公开的信息' }] } });
    applyWorldUpdates(data, updates, config);
    assert.equal(data.world.reports.length, 1);
    assert.equal(data.world.reports[0].source, 'npc');

    config.moderation.systemAdminEnabled = true;
    config.modules.moderation.automation = 'confirm';
    applyWorldUpdates(data, { moderationActions: [{ actorHandle: '', postId: 'p1', action: 'hide', reason: '符合规则中的隐藏条件', systemAdmin: true, reportId: data.world.reports[0].id }] }, config);
    const proposal = data.world.proposals.at(-1);
    assert.equal(data.posts[0].moderation.hidden, false);
    assert.equal(applyModerationProposal(data, config, proposal, true), true);
    assert.equal(data.posts[0].moderation.hidden, true);
    assert.equal(data.world.reports[0].status, 'actioned');
});
