import { DEFAULT_BUILTIN_PROMPTS, WORLD_MODULE_DEFINITIONS } from './constants.js';
import { createId, parseJsonResponse } from './prompt.js';

function text(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function integer(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

function list(value) {
    return Array.isArray(value) ? value : [];
}

function hasOwn(target, key) {
    return Object.prototype.hasOwnProperty.call(target || {}, key);
}

function now(value) {
    return Math.max(0, Number(value || Date.now()));
}

function builtinPrompt(settings, id) {
    return text(settings?.builtinPrompts?.[id], DEFAULT_BUILTIN_PROMPTS[id] || '');
}

export function getModuleDefinition(moduleId) {
    return WORLD_MODULE_DEFINITIONS.find(module => module.id === moduleId) || null;
}

export function getEnabledLinkedModuleIds(settings, onlyModuleId = '') {
    if (onlyModuleId) return settings?.modules?.[onlyModuleId]?.enabled ? [onlyModuleId] : [];
    return WORLD_MODULE_DEFINITIONS
        .map(module => module.id)
        .filter(id => id !== 'forum' && settings?.modules?.[id]?.enabled
            && (settings.modules[id].generationMode === 'linked' || (!settings.modules[id].generationMode && settings.modules[id].joinGeneration)));
}

export function normalizeWorldState(value) {
    const world = value && typeof value === 'object' ? value : {};
    world.tasks = list(world.tasks).map(item => ({
        id: text(item?.id) || createId('task'),
        title: text(item?.title, '未命名任务'),
        description: text(item?.description),
        issuer: text(item?.issuer, '匿名委托人'),
        issuerNpcId: text(item?.issuerNpcId),
        issuerHandle: text(item?.issuerHandle).replace(/^@/, ''),
        status: ['offered', 'accepted', 'completed', 'failed', 'abandoned'].includes(item?.status) ? item.status : 'offered',
        risk: ['low', 'medium', 'high', 'unknown'].includes(item?.risk) ? item.risk : 'unknown',
        reward: text(item?.reward),
        failure: text(item?.failure),
        scam: Boolean(item?.scam),
        secret: text(item?.secret),
        createdAt: now(item?.createdAt),
        updatedAt: now(item?.updatedAt || item?.createdAt),
    })).slice(-200);
    world.fortune = world.fortune && typeof world.fortune === 'object' ? {
        id: text(world.fortune.id) || createId('fortune'),
        date: text(world.fortune.date, new Date().toLocaleDateString('zh-CN')),
        label: text(world.fortune.label, '平稳'),
        score: integer(world.fortune.score, 0, -100, 100),
        summary: text(world.fortune.summary),
        effects: list(world.fortune.effects).map(String).filter(Boolean).slice(0, 12),
        theme: text(world.fortune.theme, '日常'),
        sigil: text(world.fortune.sigil, '◇'),
        choiceId: text(world.fortune.choiceId),
        aspects: Object.fromEntries(Object.entries(world.fortune.aspects && typeof world.fortune.aspects === 'object' ? world.fortune.aspects : {}).map(([key, value]) => [key, integer(value, 50, 0, 100)])),
        modifiers: Object.fromEntries(Object.entries(world.fortune.modifiers && typeof world.fortune.modifiers === 'object' ? world.fortune.modifiers : {}).map(([key, value]) => [key, key === 'luckyDirection' ? text(value) : integer(value, 0, -50, 50)])),
        local: Boolean(world.fortune.local),
        updatedAt: now(world.fortune.updatedAt),
    } : null;
    world.fortuneHistory = list(world.fortuneHistory).map(item => normalizeWorldState({ fortune: item }).fortune).filter(Boolean).slice(-30);
    const companion = world.companion && typeof world.companion === 'object' ? world.companion : {};
    world.companion = {
        name: text(companion.name, '团子'),
        species: text(companion.species, '青蛙'),
        avatarUrl: text(companion.avatarUrl),
        status: ['home', 'away', 'resting'].includes(companion.status) ? companion.status : 'home',
        mood: text(companion.mood, '好奇'),
        destination: text(companion.destination),
        carrying: text(companion.carrying),
        lastFood: text(companion.lastFood),
        message: text(companion.message, '正在家里安静地准备下一次出门。'),
        bond: integer(companion.bond, 0, 0, 100),
        energy: integer(companion.energy, 80, 0, 100),
        satiety: integer(companion.satiety, 75, 0, 100),
        happiness: integer(companion.happiness, 70, 0, 100),
        luckyDirection: text(companion.luckyDirection),
        lastAction: ['feed', 'pet', 'play', 'rest', 'depart', 'signal', 'weather'].includes(companion.lastAction) ? companion.lastAction : '',
        deviceSkin: ['classic', 'pocket', 'crystal', 'arcane', 'terminal'].includes(companion.deviceSkin) ? companion.deviceSkin : 'classic',
        weather: ['auto', 'sunny', 'cloudy', 'rain', 'wind', 'snow'].includes(companion.weather) ? companion.weather : 'auto',
        timeOfDay: ['auto', 'dawn', 'day', 'dusk', 'night'].includes(companion.timeOfDay) ? companion.timeOfDay : 'auto',
        lastInteractionAt: Math.max(0, Number(companion.lastInteractionAt || 0)),
        departedAt: Math.max(0, Number(companion.departedAt || 0)),
        departedCarrying: text(companion.departedCarrying),
        expectedReturnAt: Math.max(0, Number(companion.expectedReturnAt || 0)),
        lastCarryingClaimKey: text(companion.lastCarryingClaimKey),
        updatedAt: now(companion.updatedAt),
    };
    world.trips = list(world.trips).map(item => ({
        id: text(item?.id) || createId('trip'),
        traveler: text(item?.traveler, '未知旅人'),
        travelerNpcId: text(item?.travelerNpcId),
        destination: text(item?.destination, '未知地点'),
        status: ['planned', 'away', 'returned', 'cancelled'].includes(item?.status) ? item.status : 'planned',
        notes: text(item?.notes),
        souvenir: text(item?.souvenir),
        souvenirClaimedAt: Math.max(0, Number(item?.souvenirClaimedAt || 0)),
        createdAt: now(item?.createdAt),
        updatedAt: now(item?.updatedAt || item?.createdAt),
    })).slice(-120);
    world.inventory = list(world.inventory).map(item => ({
        id: text(item?.id) || createId('item'),
        name: text(item?.name, '未命名物品'),
        description: text(item?.description),
        quantity: integer(item?.quantity, 1, 0, 9999),
        effect: text(item?.effect),
        source: text(item?.source),
        usable: item?.usable !== false,
        consumed: Boolean(item?.consumed),
        createdAt: now(item?.createdAt),
        updatedAt: now(item?.updatedAt || item?.createdAt),
    })).slice(-300);
    world.health = list(world.health).map(item => ({
        id: text(item?.id) || createId('health'),
        subject: text(item?.subject, '当前角色'),
        subjectNpcId: text(item?.subjectNpcId),
        name: text(item?.name, '身体状态'),
        severity: ['minor', 'moderate', 'serious'].includes(item?.severity) ? item.severity : 'minor',
        status: ['active', 'recovering', 'resolved'].includes(item?.status) ? item.status : 'active',
        stage: ['onset', 'noticed', 'seeking', 'consulting', 'treating', 'recovering', 'resolved'].includes(item?.stage)
            ? item.stage
            : item?.status === 'resolved' ? 'resolved' : item?.status === 'recovering' ? 'recovering' : 'noticed',
        symptoms: text(item?.symptoms),
        storyEffect: text(item?.storyEffect),
        provider: text(item?.provider),
        providerNpcId: text(item?.providerNpcId),
        careNote: text(item?.careNote),
        specialty: text(item?.specialty),
        progress: integer(item?.progress, item?.status === 'resolved' ? 100 : item?.status === 'recovering' ? 65 : 15, 0, 100),
        local: Boolean(item?.local),
        createdAt: now(item?.createdAt),
        updatedAt: now(item?.updatedAt || item?.createdAt),
    })).slice(-160);
    world.reports = list(world.reports).map(item => ({
        id: text(item?.id) || createId('report'),
        postId: text(item?.postId),
        reason: text(item?.reason, '未填写原因'),
        reporter: text(item?.reporter, '我'),
        reporterNpcId: text(item?.reporterNpcId),
        reporterHandle: text(item?.reporterHandle).replace(/^@/, ''),
        source: item?.source === 'npc' ? 'npc' : 'user',
        status: ['pending', 'reviewing', 'dismissed', 'actioned'].includes(item?.status) ? item.status : 'pending',
        decision: text(item?.decision),
        action: ['none', 'hide', 'delete', 'warn'].includes(item?.action) ? item.action : 'none',
        reviewerNpcId: text(item?.reviewerNpcId),
        createdAt: now(item?.createdAt),
        updatedAt: now(item?.updatedAt || item?.createdAt),
    })).filter(item => item.postId).slice(-300);
    world.proposals = list(world.proposals).map(item => ({
        id: text(item?.id) || createId('proposal'),
        moduleId: text(item?.moduleId),
        title: text(item?.title, '待确认操作'),
        description: text(item?.description),
        payload: item?.payload && typeof item.payload === 'object' ? item.payload : {},
        status: ['pending', 'accepted', 'rejected'].includes(item?.status) ? item.status : 'pending',
        createdAt: now(item?.createdAt),
        updatedAt: now(item?.updatedAt || item?.createdAt),
    })).slice(-200);
    world.auditLog = list(world.auditLog).map(item => ({
        id: text(item?.id) || createId('audit'),
        moduleId: text(item?.moduleId, 'system'),
        summary: text(item?.summary),
        createdAt: now(item?.createdAt),
    })).filter(item => item.summary).slice(-200);
    const runtime = world.moduleRuntime && typeof world.moduleRuntime === 'object' ? world.moduleRuntime : {};
    world.moduleRuntime = Object.fromEntries(Object.entries(runtime).map(([moduleId, item]) => [moduleId, {
        lastDecision: text(item?.lastDecision),
        lastDecisionCode: text(item?.lastDecisionCode),
        lastCheckedAt: Math.max(0, Number(item?.lastCheckedAt || 0)),
        lastGeneratedAt: Math.max(0, Number(item?.lastGeneratedAt || 0)),
        blockedCount: integer(item?.blockedCount, 0, 0, 999999),
    }]));
    return world;
}

function minutesOfDay(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return 0;
    return Math.min(1439, Math.max(0, Number(match[1]) * 60 + Number(match[2])));
}

export function isQuietHours(settings, date = new Date()) {
    const quiet = settings?.automation?.quietHours;
    if (!quiet?.enabled) return false;
    const current = date.getHours() * 60 + date.getMinutes();
    const start = minutesOfDay(quiet.start);
    const end = minutesOfDay(quiet.end);
    if (start === end) return true;
    return start < end ? current >= start && current < end : current >= start || current < end;
}

export function setModuleDecision(data, moduleId, code, message, { generated = false } = {}) {
    data.world = normalizeWorldState(data.world);
    const previous = data.world.moduleRuntime[moduleId] || {};
    data.world.moduleRuntime[moduleId] = {
        ...previous,
        lastDecision: text(message),
        lastDecisionCode: text(code),
        lastCheckedAt: Date.now(),
        lastGeneratedAt: generated ? Date.now() : Number(previous.lastGeneratedAt || 0),
        blockedCount: generated ? Number(previous.blockedCount || 0) : Number(previous.blockedCount || 0) + 1,
    };
    return data.world.moduleRuntime[moduleId];
}

export function evaluateModuleGeneration(settings, data, moduleId, { automatic = false, random = Math.random, date = new Date() } = {}) {
    const module = settings?.modules?.[moduleId];
    if (!module?.enabled) return { allowed: false, code: 'disabled', message: '模块已关闭' };
    if (automatic && settings?.automation?.quietHours?.behavior === 'postpone' && isQuietHours(settings, date)) {
        return { allowed: false, code: 'quiet-hours', message: '当前处于安静时段，主动生成已顺延' };
    }
    const runtime = normalizeWorldState(data?.world).moduleRuntime?.[moduleId] || {};
    const cooldownMs = Math.max(0, Number(module.cooldownMinutes || 0)) * 60000;
    if (automatic && cooldownMs && runtime.lastGeneratedAt && Date.now() - runtime.lastGeneratedAt < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - (Date.now() - runtime.lastGeneratedAt)) / 60000);
        return { allowed: false, code: 'cooldown', message: `冷却中，还需约 ${remaining} 分钟` };
    }
    const probability = Math.min(100, Math.max(0, Number(module.probability ?? 100)));
    const roll = Math.floor(random() * 100) + 1;
    if (automatic && roll > probability) return { allowed: false, code: 'probability', message: `本轮概率未触发（${roll} > ${probability}）`, roll, probability };
    return { allowed: true, code: 'ready', message: module.generationMode === 'local' ? '使用本地随机，不调用 API' : module.generationMode === 'linked' ? '参与本轮持续联动' : '允许独立生成', roll, probability };
}

export function createLocalFortune(date = new Date(), seed = '', choiceId = '') {
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const source = `${dateKey}|${seed || 'fortune'}|${choiceId || 'middle'}`;
    let number = 2166136261;
    for (const char of source) number = ((number ^ char.codePointAt(0)) * 16777619) >>> 0;
    const score = (number % 161) - 80;
    const label = score >= 55 ? '很幸运' : score >= 20 ? '小吉' : score > -20 ? '平稳' : score > -55 ? '小心' : '多留意';
    const good = ['容易遇见恰到好处的帮助', '适合整理长期搁置的小事', '一次普通交谈可能带来线索', '外出时更容易发现有趣的小物件'];
    const bad = ['临时变化会比平时多一点', '容易忘带无关紧要的小东西', '沟通时需要多确认一句', '计划可能出现轻微延迟'];
    const neutral = ['今天不会强迫发生大事', '选择仍由当前剧情与角色决定'];
    const first = score >= 0 ? good[number % good.length] : bad[number % bad.length];
    const themes = ['风与路标', '微光来信', '潮汐回声', '林间岔路', '口袋星尘', '午后铃声'];
    const sigils = ['✦', '☾', '⌁', '◇', '✿', '△'];
    const directions = ['东', '南', '西', '北'];
    const travelBase = Math.round(score / 8);
    return {
        id: `fortune-local-${dateKey}`,
        date: dateKey,
        label,
        score,
        summary: `${label}的一天。${first}。`,
        effects: [first, neutral[(number >>> 6) % neutral.length]],
        theme: themes[(number >>> 3) % themes.length],
        sigil: sigils[(number >>> 9) % sigils.length],
        choiceId: choiceId || 'middle',
        aspects: {
            encounter: Math.min(100, Math.max(0, 50 + Math.round(score * 0.35) + ((number >>> 4) % 17) - 8)),
            travel: Math.min(100, Math.max(0, 50 + Math.round(score * 0.4) + ((number >>> 8) % 15) - 7)),
            discovery: Math.min(100, Math.max(0, 50 + Math.round(score * 0.3) + ((number >>> 12) % 19) - 9)),
        },
        modifiers: {
            travelDeparture: Math.max(-10, Math.min(15, travelBase)),
            travelMessage: Math.max(-8, Math.min(12, travelBase + 2)),
            souvenir: Math.max(-6, Math.min(10, Math.round(score / 10))),
            detour: score < 0 ? Math.min(15, Math.abs(Math.round(score / 7))) : -Math.min(8, Math.round(score / 12)),
            luckyDirection: directions[(number >>> 15) % directions.length],
        },
        updatedAt: Date.now(),
        local: true,
    };
}

const LOCAL_HEALTH_EVENTS = Object.freeze([
    { name: '智齿闹脾气', severity: 'minor', symptoms: '后槽牙附近隐隐胀痛，吃东西时格外明显。', storyEffect: '可以观察、向熟人询问，或找牙医处理。', careNote: '医生建议先避开太硬的食物，并安排检查。', specialty: '牙医' },
    { name: '轻微感冒', severity: 'minor', symptoms: '嗓子发干，偶尔打喷嚏，精神比平时差一点。', storyEffect: '休息与照顾可能带来新的日常互动。', careNote: '补充水分并好好休息，留意症状变化。', specialty: '全科医生' },
    { name: '季节性过敏', severity: 'minor', symptoms: '眼睛发痒，鼻子也有些不舒服。', storyEffect: '需要找出环境里的诱因。', careNote: '暂时远离可能的过敏原并进行基础处理。', specialty: '医师' },
    { name: '连续失眠', severity: 'moderate', symptoms: '连续几晚睡不踏实，白天很难集中精神。', storyEffect: '行程节奏与对话状态会受到一点影响。', careNote: '先调整作息并减少夜间刺激，必要时复诊。', specialty: '睡眠门诊' },
    { name: '肠胃不适', severity: 'minor', symptoms: '胃里不太舒服，暂时没有什么食欲。', storyEffect: '适合安排清淡饮食和一段安静的休息。', careNote: '清淡饮食、补充水分并观察变化。', specialty: '医师' },
    { name: '肌肉酸痛', severity: 'minor', symptoms: '活动后肩背酸痛，动作比平时慢一些。', storyEffect: '可能需要同伴帮忙或临时改变计划。', careNote: '适度休息和舒缓活动，避免继续勉强。', specialty: '理疗师' },
    { name: '轻微扭伤', severity: 'moderate', symptoms: '脚踝有些肿痛，走快时会不舒服。', storyEffect: '外出路线需要调整，也给照料留下空间。', careNote: '先休息并减少负重，按恢复情况逐步活动。', specialty: '诊所医生' },
    { name: '疲劳累积', severity: 'minor', symptoms: '最近消耗太多，身体发沉，反应也慢半拍。', storyEffect: '暂停一件事也可能让另一段关系向前。', careNote: '把休息放进今天的正式安排里。', specialty: '医师' },
]);

export function createLocalHealthEvent({ subject = '我', subjectNpcId = '', provider = '', providerNpcId = '', seed = '' } = {}) {
    const source = `${new Date().toLocaleDateString('zh-CN')}|${subject}|${seed}|${Date.now()}`;
    let number = 2166136261;
    for (const char of source) number = ((number ^ char.codePointAt(0)) * 16777619) >>> 0;
    const event = LOCAL_HEALTH_EVENTS[number % LOCAL_HEALTH_EVENTS.length];
    return {
        id: createId('health'), subject: text(subject, '我'), subjectNpcId: text(subjectNpcId),
        name: event.name, severity: event.severity, status: 'active', stage: 'noticed',
        symptoms: event.symptoms, storyEffect: event.storyEffect, provider: text(provider), providerNpcId: text(providerNpcId),
        careNote: event.careNote, specialty: event.specialty, progress: 15, local: true,
        createdAt: Date.now(), updatedAt: Date.now(),
    };
}

export function testModuleProbability(settings, data, moduleId, runs = 100, random = Math.random) {
    const total = Math.min(10000, Math.max(1, Number(runs || 100)));
    const reasons = {};
    let generated = 0;
    for (let index = 0; index < total; index += 1) {
        const result = evaluateModuleGeneration(settings, data, moduleId, { automatic: true, random });
        if (result.allowed) generated += 1;
        else reasons[result.code] = (reasons[result.code] || 0) + 1;
    }
    return { runs: total, generated, blocked: total - generated, reasons };
}

function normalizeTask(item) {
    if (!item || typeof item !== 'object') return null;
    return normalizeWorldState({ tasks: [item] }).tasks[0];
}

function normalizeTrip(item) {
    if (!item || typeof item !== 'object') return null;
    return normalizeWorldState({ trips: [item] }).trips[0];
}

function normalizeCompanionPatch(value) {
    if (!value || typeof value !== 'object') return null;
    const patch = {};
    for (const field of ['name', 'species', 'avatarUrl', 'mood', 'destination', 'carrying', 'message']) {
        if (hasOwn(value, field)) patch[field] = text(value[field]);
    }
    if (hasOwn(value, 'status')) patch.status = ['home', 'away', 'resting'].includes(value.status) ? value.status : 'home';
    if (hasOwn(value, 'bond')) patch.bond = integer(value.bond, 0, 0, 100);
    if (hasOwn(value, 'departedAt')) patch.departedAt = Math.max(0, Number(value.departedAt || 0));
    if (hasOwn(value, 'expectedReturnAt')) patch.expectedReturnAt = Math.max(0, Number(value.expectedReturnAt || 0));
    patch.updatedAt = Date.now();
    return patch;
}

function normalizeInventoryItem(item) {
    if (!item || typeof item !== 'object') return null;
    return normalizeWorldState({ inventory: [item] }).inventory[0];
}

function normalizeHealthItem(item) {
    if (!item || typeof item !== 'object') return null;
    return normalizeWorldState({ health: [item] }).health[0];
}

function containsAny(value, patterns) {
    const source = JSON.stringify(value || {}).toLocaleLowerCase();
    return patterns.some(pattern => source.includes(pattern));
}

export function filterWorldUpdatesBySafety(updates, settings, data = null) {
    const forbidden = settings?.automation?.forbiddenEvents || {};
    const result = { ...(updates || {}) };
    const blocked = [];
    let acceptedSevere = 0;
    const audit = list(data?.world?.auditLog);
    const recentSevere = audit.filter(item => item.moduleId === 'severity').slice(-10);
    const severeLimit = Math.min(10, Math.max(0, Number(settings?.automation?.maxSevereEventsPerTenRuns ?? 2)));
    const cooldownMs = Math.max(0, Number(settings?.automation?.severeCooldownHours || 0)) * 3600000;
    const lastSevereAt = Number(recentSevere.at(-1)?.createdAt || 0);
    const severeAllowed = () => {
        if (settings?.automation?.narrativeIntensity === 'gentle') return false;
        if (recentSevere.length + acceptedSevere >= severeLimit) return false;
        if (cooldownMs && lastSevereAt && Date.now() - lastSevereAt < cooldownMs) return false;
        acceptedSevere += 1;
        return true;
    };
    const rejects = (item, category) => {
        blocked.push(category);
        return false;
    };
    if (Array.isArray(result.tasks)) {
        result.tasks = result.tasks.filter(item => {
            if (forbidden.scam && item.scam) return rejects(item, '骗局');
            if (forbidden.permanentTaskFailure && containsAny(item.failure, ['永久', '永远无法', '不可挽回', '彻底失败', 'permanent'])) return rejects(item, '永久任务失败');
            if (forbidden.permanentDeath && containsAny(item, ['永久死亡', '死亡', '丧命', '身亡', 'die', 'death'])) return rejects(item, '永久死亡');
            if (forbidden.bankruptcy && containsAny(item, ['破产', '无家可归', '倾家荡产', 'bankrupt', 'homeless'])) return rejects(item, '破产或无家可归');
            if (item.risk === 'high' && !severeAllowed()) return rejects(item, '剧情强度限制');
            return true;
        });
    }
    if (Array.isArray(result.health)) {
        result.health = result.health.filter(item => {
            if (forbidden.severeIllness && item.severity === 'serious') return rejects(item, '重病');
            if (forbidden.irreversibleInjury && containsAny(item, ['不可逆', '永久残疾', '永久伤残', '截肢', 'irreversible'])) return rejects(item, '不可逆伤残');
            if (forbidden.permanentDeath && containsAny(item, ['死亡', '丧命', '身亡', 'death'])) return rejects(item, '永久死亡');
            if (item.severity === 'serious' && list(data?.world?.health).some(existing => existing.status !== 'resolved' && existing.subject === item.subject && existing.severity === 'serious')) return rejects(item, '同一角色重大事件叠加');
            if (item.severity === 'serious' && !severeAllowed()) return rejects(item, '剧情强度限制');
            return true;
        });
    }
    return { updates: result, blocked: [...new Set(blocked)], acceptedSevere };
}

export function normalizeWorldUpdates(raw) {
    let root = raw;
    if (typeof raw === 'string') root = parseJsonResponse(raw);
    if (!root || typeof root !== 'object') return {};
    const updates = root.worldUpdates && typeof root.worldUpdates === 'object'
        ? root.worldUpdates
        : root.modules && typeof root.modules === 'object'
            ? root.modules
            : root;
    const result = {};
    if (Array.isArray(updates.tasks)) result.tasks = updates.tasks.map(normalizeTask).filter(Boolean);
    if (updates.fortune && typeof updates.fortune === 'object') result.fortune = normalizeWorldState({ fortune: updates.fortune }).fortune;
    const travel = updates.travel;
    if (Array.isArray(travel || updates.trips)) result.travel = (travel || updates.trips).map(normalizeTrip).filter(Boolean);
    else if (travel && typeof travel === 'object') {
        const companion = travel.companion && typeof travel.companion === 'object' ? travel.companion : travel;
        result.companion = normalizeCompanionPatch(companion);
        const journeys = travel.journeys || travel.logs || travel.trips;
        if (Array.isArray(journeys)) result.travel = journeys.map(normalizeTrip).filter(Boolean);
    }
    if (updates.companion && typeof updates.companion === 'object') result.companion = normalizeCompanionPatch(updates.companion);
    if (Array.isArray(updates.inventory || updates.items)) result.inventory = (updates.inventory || updates.items).map(normalizeInventoryItem).filter(Boolean);
    if (Array.isArray(updates.health)) result.health = updates.health.map(normalizeHealthItem).filter(Boolean);
    if (Array.isArray(updates.reports)) result.reports = updates.reports.filter(item => item && typeof item === 'object').map(item => ({
        reporterHandle: text(item.reporterHandle).replace(/^@/, ''),
        postId: text(item.postId),
        reason: text(item.reason, '该角色认为内容需要管理员查看'),
    })).filter(item => item.reporterHandle && item.postId).slice(0, 12);
    if (Array.isArray(updates.socialActions)) result.socialActions = updates.socialActions.filter(item => item && typeof item === 'object').map(item => ({
        actorHandle: text(item.actorHandle).replace(/^@/, ''),
        targetHandle: text(item.targetHandle).replace(/^@/, ''),
        action: ['follow', 'unfollow', 'mute', 'block'].includes(item.action) ? item.action : 'follow',
    }));
    if (Array.isArray(updates.moderationActions)) result.moderationActions = updates.moderationActions.filter(item => item && typeof item === 'object').map(item => ({
        actorHandle: text(item.actorHandle).replace(/^@/, ''),
        postId: text(item.postId),
        action: ['hide', 'delete', 'warn', 'dismiss'].includes(item.action) ? item.action : 'dismiss',
        reason: text(item.reason),
    })).filter(item => item.postId);
    return result;
}

export function normalizeProactiveDirectMessages(raw) {
    let root = raw;
    if (typeof raw === 'string') root = parseJsonResponse(raw);
    const items = Array.isArray(root?.dmEvents) ? root.dmEvents : Array.isArray(root?.worldUpdates?.dmEvents) ? root.worldUpdates.dmEvents : [];
    return items.map(item => ({
        targetHandle: text(item?.targetHandle).replace(/^@/, ''),
        content: text(item?.content),
        reason: text(item?.reason),
    })).filter(item => item.targetHandle && item.content).slice(0, 8);
}

function appendUnique(target, incoming, signature) {
    for (const item of incoming) {
        const key = signature(item);
        if (!target.some(existing => signature(existing) === key)) target.push(item);
    }
}

export function getPermissionLevel(settings, roleId) {
    const levels = list(settings?.moderation?.permissionLevels);
    return levels.find(item => item.id === roleId) || levels.find(item => item.id === 'member') || { id: 'member', level: 0 };
}

export function roleCan(settings, npc, capability) {
    return Boolean(getPermissionLevel(settings, npc?.permissionRole || 'member')?.[capability]);
}

function findNpcByHandle(data, handle) {
    const key = text(handle).replace(/^@/, '').toLocaleLowerCase();
    return list(data?.npcs).find(npc => text(npc.handle).replace(/^@/, '').toLocaleLowerCase() === key);
}

function executeModerationAction(data, settings, action) {
    const actor = findNpcByHandle(data, action.actorHandle);
    const post = list(data.posts).find(item => item.id === action.postId);
    const systemAdmin = Boolean(action.systemAdmin && settings?.moderation?.systemAdminEnabled);
    if (!post || (!systemAdmin && (!actor || !roleCan(settings, actor, 'adjudicateReport')))) return false;
    if (['delete', 'hide'].includes(action.action) && !systemAdmin && !roleCan(settings, actor, 'deletePost')) return false;
    post.moderation ||= {};
    if (action.action === 'delete' || action.action === 'hide') {
        post.moderation.hidden = true;
        post.moderation.action = action.action;
        post.moderation.reason = action.reason;
        post.moderation.actorNpcId = systemAdmin ? 'system-ai-admin' : actor.id;
        post.moderation.updatedAt = Date.now();
    } else if (action.action === 'warn') {
        post.moderation.warning = action.reason || '该内容已被社区管理提醒。';
    }
    return true;
}

function addTravelSouvenirToInventory(data, trip, companionName) {
    if (!trip || trip.status !== 'returned' || !trip.souvenir || trip.souvenirClaimedAt) return '';
    const source = `${companionName}返程 · ${trip.id}`;
    if (!data.world.inventory.some(item => item.name === trip.souvenir && item.source === source)) {
        data.world.inventory.push({
            id: createId('item'), name: trip.souvenir,
            description: `${companionName}从${trip.destination || '旅途'}带回的小物件。`,
            quantity: 1, effect: '可收藏，也可在合适的情境中使用。', source,
            usable: true, consumed: false, createdAt: Date.now(), updatedAt: Date.now(),
        });
    }
    trip.souvenirClaimedAt = Date.now();
    trip.updatedAt = Date.now();
    return trip.souvenir;
}

function addCompanionCarryingToInventory(data, companion, previousCompanion, alreadyClaimed = new Set()) {
    if (companion.status !== 'home' || previousCompanion.status === 'home' || !companion.carrying) return '';
    const itemName = companion.carrying;
    if (itemName === previousCompanion.departedCarrying) return '';
    const claimKey = `${previousCompanion.departedAt || companion.updatedAt}|${itemName}`;
    if (companion.lastCarryingClaimKey === claimKey) return '';
    if (!alreadyClaimed.has(itemName)) {
        const source = `${companion.name}返程 · ${claimKey}`;
        if (!data.world.inventory.some(item => item.name === itemName && item.source === source)) {
            data.world.inventory.push({
                id: createId('item'), name: itemName,
                description: `${companion.name}回家时从旅途中带回的东西。`,
                quantity: 1, effect: '可收藏，也可在合适的情境中使用。', source,
                usable: true, consumed: false, createdAt: Date.now(), updatedAt: Date.now(),
            });
        }
    }
    companion.lastCarryingClaimKey = claimKey;
    companion.carrying = '';
    return itemName;
}

export function applyWorldUpdates(data, updates, settings) {
    data.world = normalizeWorldState(data.world);
    const applied = [];
    const previousCompanion = { ...data.world.companion };
    const claimedSouvenirs = new Set();
    if (settings.modules?.tasks?.enabled && updates.tasks?.length) {
        appendUnique(data.world.tasks, updates.tasks, item => `${item.title}|${item.issuer}|${item.description}`);
        applied.push(`任务 ${updates.tasks.length}`);
    }
    if (settings.modules?.fortune?.enabled && updates.fortune) {
        data.world.fortune = updates.fortune;
        applied.push('运势');
    }
    if (settings.modules?.travel?.enabled && updates.travel?.length) {
        const companionName = data.world.companion?.name || '旅伴';
        const journeys = updates.travel.map(item => ({ ...item, traveler: item.traveler === '未知旅人' ? companionName : item.traveler }));
        appendUnique(data.world.trips, journeys, item => `${item.traveler}|${item.destination}|${item.notes}`);
        applied.push(`外出 ${updates.travel.length}`);
        for (const incoming of journeys) {
            const stored = data.world.trips.find(item => `${item.traveler}|${item.destination}|${item.notes}` === `${incoming.traveler}|${incoming.destination}|${incoming.notes}`);
            const souvenir = addTravelSouvenirToInventory(data, stored, companionName);
            if (souvenir) claimedSouvenirs.add(souvenir);
        }
    }
    if (settings.modules?.travel?.enabled && updates.companion) {
        data.world.companion = normalizeWorldState({ companion: { ...data.world.companion, ...updates.companion } }).companion;
        applied.push('旅伴状态');
        const carried = addCompanionCarryingToInventory(data, data.world.companion, previousCompanion, claimedSouvenirs);
        if (carried) {
            applied.push(`旅伴带回 ${carried}`);
            data.world.companion.message = `${data.world.companion.name}把“${carried}”放进了背包。${data.world.companion.message ? ` ${data.world.companion.message}` : ''}`;
        }
    }
    if (settings.modules?.inventory?.enabled && updates.inventory?.length) {
        appendUnique(data.world.inventory, updates.inventory, item => `${item.name}|${item.source}|${item.description}`);
        applied.push(`物品 ${updates.inventory.length}`);
    }
    if (settings.modules?.health?.enabled && updates.health?.length) {
        appendUnique(data.world.health, updates.health, item => `${item.subject}|${item.name}|${item.symptoms}`);
        applied.push(`健康事件 ${updates.health.length}`);
    }
    if (updates.socialActions?.length) {
        for (const action of updates.socialActions) {
            const actor = findNpcByHandle(data, action.actorHandle);
            const target = findNpcByHandle(data, action.targetHandle);
            if (!actor) continue;
            if (action.action === 'follow') {
                if (target) {
                    actor.followingHandles ||= [];
                    if (!actor.followingHandles.includes(target.handle)) actor.followingHandles.push(target.handle);
                } else if (['me', 'user'].includes(action.targetHandle.toLocaleLowerCase())) {
                    const wasFollowing = actor.followsUser;
                    actor.followsUser = true;
                    if (!wasFollowing && settings?.notifications?.follow) {
                        data.notifications ||= [];
                        data.notifications.unshift({ id: createId('notification'), type: actor.followedByUser ? 'mutual' : 'follow', actorNpcId: actor.id, actorName: actor.name, postId: '', content: actor.followedByUser ? `${actor.name} 与你互相关注了` : `${actor.name} 关注了你`, read: false, createdAt: Date.now() });
                    }
                }
            } else if (action.action === 'unfollow') {
                if (target) actor.followingHandles = list(actor.followingHandles).filter(handle => handle !== target.handle);
                else if (['me', 'user'].includes(action.targetHandle.toLocaleLowerCase())) actor.followsUser = false;
            }
        }
    }
    if (settings.modules?.moderation?.enabled && settings.moderation?.npcReportsEnabled && updates.reports?.length) {
        let added = 0;
        for (const incoming of updates.reports) {
            const reporterNpc = findNpcByHandle(data, incoming.reporterHandle);
            const post = list(data.posts).find(item => item.id === incoming.postId);
            if (!reporterNpc || reporterNpc.blocked || !post || post.npcId === reporterNpc.id) continue;
            if (data.world.reports.some(report => report.postId === post.id && report.reporterNpcId === reporterNpc.id && ['pending', 'reviewing'].includes(report.status))) continue;
            data.world.reports.push(createPostReport({
                postId: post.id, reason: `${reporterNpc.name}（@${reporterNpc.handle}）举报：${incoming.reason}`, reporter: reporterNpc.name,
                reporterNpcId: reporterNpc.id, reporterHandle: reporterNpc.handle, source: 'npc',
            }));
            added += 1;
        }
        if (added) applied.push(`NPC 举报 ${added}`);
    }
    if (settings.modules?.moderation?.enabled && updates.moderationActions?.length) {
        const mode = settings.modules.moderation.automation || 'confirm';
        for (const action of updates.moderationActions) {
            if (mode === 'auto' && executeModerationAction(data, settings, action)) {
                applied.push('管理操作');
                continue;
            }
            data.world.proposals.push({
                id: createId('proposal'), moduleId: 'moderation', title: `建议${action.action === 'dismiss' ? '驳回举报' : '处理帖子'}`,
                description: action.reason || '等待用户确认', payload: action, status: 'pending', createdAt: Date.now(), updatedAt: Date.now(),
            });
        }
    }
    if (applied.length) data.world.auditLog.push({ id: createId('audit'), moduleId: 'orchestrator', summary: `联动更新：${applied.join('、')}`, createdAt: Date.now() });
    normalizeWorldState(data.world);
    return applied;
}

export function createPostReport({ postId, reason, reporter = '我', reporterNpcId = '', reporterHandle = '', source = 'user' }) {
    return {
        id: createId('report'), postId: text(postId), reason: text(reason, '未填写原因'), reporter: text(reporter, '我'),
        reporterNpcId: text(reporterNpcId), reporterHandle: text(reporterHandle).replace(/^@/, ''), source: source === 'npc' ? 'npc' : 'user',
        status: 'pending', decision: '', action: 'none', reviewerNpcId: '', createdAt: Date.now(), updatedAt: Date.now(),
    };
}

export function buildWorldModuleInjection(data, settings, onlyModuleId = '') {
    const world = normalizeWorldState(data?.world);
    const enabled = id => (!onlyModuleId || onlyModuleId === id) && settings?.modules?.[id]?.enabled && settings.modules[id].injectIntoChat;
    const sections = [];
    if (enabled('tasks')) {
        const items = world.tasks.filter(item => ['offered', 'accepted'].includes(item.status)).slice(-12);
        if (items.length) sections.push(`【任务】\n${items.map(item => `- [${item.status === 'accepted' ? '进行中' : '待接受'}] ${item.title}（${item.issuer}）：${item.description}${item.reward ? `；奖励：${item.reward}` : ''}${item.failure ? `；失败影响：${item.failure}` : ''}`).join('\n')}`);
    }
    if (enabled('fortune') && world.fortune) sections.push(`【今日运势】\n${world.fortune.label}（${world.fortune.score}）：${world.fortune.summary}\n${world.fortune.effects.join('；')}`);
    if (enabled('travel')) {
        const items = world.trips.filter(item => ['planned', 'away', 'returned'].includes(item.status)).slice(-10);
        const companion = world.companion;
        sections.push(`【旅伴】\n${companion.name}（${companion.species}）目前${companion.status === 'away' ? `正在${companion.destination || '外面'}旅行` : companion.status === 'resting' ? '正在休息' : '在家'}；心情：${companion.mood}；亲密度：${companion.bond}${companion.message ? `；留言：${companion.message}` : ''}${items.length ? `\n近期见闻：\n${items.map(item => `- ${item.destination} [${item.status}]：${item.notes}${item.souvenir ? `；带回：${item.souvenir}` : ''}`).join('\n')}` : ''}`);
    }
    if (enabled('inventory')) {
        const items = world.inventory.filter(item => !item.consumed && item.quantity > 0).slice(-30);
        if (items.length) sections.push(`【背包】\n${items.map(item => `- ${item.name} ×${item.quantity}：${item.description}${item.effect ? `；可能作用：${item.effect}` : ''}`).join('\n')}`);
    }
    if (enabled('health')) {
        const items = world.health.filter(item => item.status !== 'resolved').slice(-20);
        if (items.length) sections.push(`【身体状态】\n${items.map(item => `- ${item.subject}：${item.name} [${item.status}]；${item.symptoms}${item.storyEffect ? `；剧情影响：${item.storyEffect}` : ''}`).join('\n')}`);
    }
    if (!sections.length) return '';
    return `<world_modules>\n以下是用户明确允许主聊天读取的世界模块状态。把它们当作当前世界事实，不要逐条复述。\n${sections.join('\n\n')}\n</world_modules>`;
}

function moduleOutputShape(moduleIds) {
    const fields = [];
    if (moduleIds.includes('tasks')) fields.push('"tasks":[{"title":"任务名","description":"内容","issuer":"发布者","issuerHandle":"必须是已有角色账号","risk":"low|medium|high|unknown","reward":"奖励","failure":"失败影响","scam":false,"secret":"幕后真相"}]');
    if (moduleIds.includes('fortune')) fields.push('"fortune":{"date":"世界内日期","label":"运势名","score":0,"summary":"概述","effects":["轻微影响"]}');
    if (moduleIds.includes('travel')) fields.push('"travel":{"companion":{"name":"旅伴名","species":"宠物种类","status":"home|away|resting","mood":"心情","destination":"当前去向","carrying":"随身物","message":"寄回的短讯","bond":0},"journeys":[{"traveler":"旅伴名","destination":"地点","status":"away|returned","notes":"旅途见闻","souvenir":"可能带回的小物件"}]}');
    if (moduleIds.includes('inventory')) fields.push('"inventory":[{"name":"物品","description":"描述","quantity":1,"effect":"剧情作用","source":"来源"}]');
    if (moduleIds.includes('health')) fields.push('"health":[{"subject":"角色","name":"状态","severity":"minor|moderate|serious","status":"active|recovering|resolved","symptoms":"表现","storyEffect":"剧情影响"}]');
    if (moduleIds.includes('moderation')) fields.push('"moderationActions":[{"actorHandle":"有管理权限的角色账号","postId":"准确帖子ID","action":"hide|delete|warn|dismiss","reason":"依据"}]');
    if (moduleIds.includes('__npcReports')) fields.push('"reports":[{"reporterHandle":"已有且未拉黑的NPC账号","postId":"已有帖子的准确ID","reason":"该NPC站内举报的具体理由"}]');
    fields.push('"socialActions":[{"actorHandle":"角色账号","targetHandle":"目标账号或me","action":"follow|unfollow"}]');
    return `{"worldUpdates":{${fields.join(',')}}}`;
}

function narrativeSafetyInstruction(settings) {
    const forbidden = settings?.automation?.forbiddenEvents || {};
    const labels = {
        permanentDeath: '永久死亡', irreversibleInjury: '不可逆伤残', severeIllness: '重病',
        bankruptcy: '破产或无家可归', scam: '骗局', permanentTaskFailure: '永久任务失败',
    };
    const blocked = Object.entries(labels).filter(([id]) => forbidden[id]).map(([, label]) => label);
    return `${builtinPrompt(settings, 'narrativeSafety')}\n剧情强度：${text(settings?.automation?.narrativeIntensity, 'balanced')}。${blocked.length ? `以下事件概率严格为 0：${blocked.join('、')}。` : '用户当前没有禁止上述重大事件。'}不得询问用户是否允许；直接遵守开关。`;
}

export function buildLinkedWorldInstruction({ settings, data, onlyModuleId = '' }) {
    const moduleIds = getEnabledLinkedModuleIds(settings, onlyModuleId);
    const proactive = !onlyModuleId && settings?.social?.proactiveDms?.enabled && settings.social.proactiveDms.withForumRefresh;
    const npcReports = !onlyModuleId && settings?.modules?.moderation?.enabled && settings?.moderation?.npcReportsEnabled;
    if (!moduleIds.length && !proactive && !npcReports) return '';
    const prompts = moduleIds.map(id => `【${getModuleDefinition(id)?.name || id}模块规则】\n${builtinPrompt(settings, id === 'tasks' ? 'task' : id)}`).join('\n\n');
    const current = buildWorldStateSummary(data, settings, npcReports && !moduleIds.includes('moderation') ? [...moduleIds, 'moderation'] : moduleIds);
    const dmInstruction = proactive ? `\n\n【主动私信】\n${builtinPrompt(settings, 'proactiveDirectMessage')}\n只允许以下已有人设且未拉黑的账号主动私信：${list(data?.npcs).filter(npc => (npc.profileGenerated || npc.systemRole) && !npc.blocked && (!settings.social.proactiveDms.requireFollow || npc.followsUser)).map(npc => `@${npc.handle}`).join('、') || '暂无可用账号'}。最多 ${integer(settings.social.proactiveDms.maxPerRun, 2, 0, 8)} 条。在 forum_data 根对象加入 "dmEvents":[{"targetHandle":"账号","content":"私信正文","reason":"主动联系动机"}]；没有自然动机时返回 []。` : '';
    const reportInstruction = npcReports ? '\n\n【NPC 站内举报】\nNPC 可以根据自身立场举报已有帖子，但不得伪造账号或帖子 ID，也不能举报自己的帖子。只有确实有动机时才填写 reports；否则返回空数组。此步骤共用本轮论坛生成，不发起额外请求。' : '';
    const shapeIds = npcReports ? [...moduleIds, '__npcReports'] : moduleIds;
    return `${builtinPrompt(settings, 'orchestrator')}\n\n${narrativeSafetyInstruction(settings)}\n\n本轮联动模块：${moduleIds.length ? moduleIds.map(id => getModuleDefinition(id)?.name || id).join('、') : npcReports ? 'NPC 举报检查' : '仅主动私信'}。\n${prompts}\n\n${current}${shapeIds.length ? `\n\n在 forum_data 根对象内额外加入 worldUpdates。结构示例：${moduleOutputShape(shapeIds)}。只输出本轮真正发生的变化；没有变化的数组使用 []，不要覆盖未选模块。` : ''}${reportInstruction}${dmInstruction}`;
}

export function buildWorldStateSummary(data, settings, moduleIds = []) {
    const world = normalizeWorldState(data?.world);
    const ids = moduleIds.length ? moduleIds : WORLD_MODULE_DEFINITIONS.map(module => module.id);
    const parts = [];
    if (settings?.orchestration?.worldTimeEnabled) parts.push(`世界时间：${text(settings.orchestration.worldTimeLabel, new Date().toLocaleString('zh-CN'))}`);
    if (ids.includes('tasks') && world.tasks.length) parts.push(`已有任务：${world.tasks.slice(-15).map(item => `${item.id}/${item.title}/${item.status}`).join('；')}`);
    if (ids.includes('fortune') && world.fortune) parts.push(`当前运势：${world.fortune.label}/${world.fortune.score}/${world.fortune.summary}`);
    if (ids.includes('travel')) {
        const companion = world.companion;
        parts.push(`当前旅伴：${companion.name}/${companion.species}/${companion.status}/${companion.mood}/${companion.destination || '无去向'}/${companion.carrying || '未带物品'}/亲密度${companion.bond}`);
        if (world.fortune) parts.push(`影响旅伴的今日运势：${world.fortune.label}/${world.fortune.theme || '日常'}/${JSON.stringify(world.fortune.modifiers || {})}`);
        if (world.trips.length) parts.push(`既有旅途：${world.trips.slice(-12).map(item => `${item.id}/${item.destination}/${item.status}/${item.notes}`).join('；')}`);
    }
    if (ids.includes('inventory') && world.inventory.length) parts.push(`已有背包：${world.inventory.filter(item => !item.consumed).slice(-30).map(item => `${item.id}/${item.name}×${item.quantity}`).join('；')}`);
    if (ids.includes('health') && world.health.length) parts.push(`已有健康状态：${world.health.filter(item => item.status !== 'resolved').slice(-20).map(item => `${item.id}/${item.subject}/${item.name}/${item.status}`).join('；')}`);
    if (ids.includes('moderation')) {
        parts.push(`社区规则：\n${text(settings?.moderation?.communityRules, '未填写')}`);
        if (settings?.moderation?.systemAdminEnabled) parts.push(`系统 AI 管理员：${text(settings.moderation.systemAdminName, '巡界者')}（可以审理举报，但仍服从自动化权限）。`);
        const staff = list(data?.npcs).filter(npc => roleCan(settings, npc, 'adjudicateReport'));
        parts.push(staff.length
            ? `可执行裁决的账号：${staff.map(npc => `@${npc.handle}（${npc.name}/${getPermissionLevel(settings, npc.permissionRole).name}）`).join('、')}`
            : '可执行裁决的账号：暂无。没有具备“审理举报”权限的角色时，只能建议驳回，不得伪造管理员。');
        const posts = list(data?.posts).slice(-20).map(post => `[${post.id}] @${post.handle}：${post.content}`).join('\n');
        if (posts) parts.push(`可审查的近期帖子：\n${posts}`);
    }
    return parts.length ? `【当前模块状态】\n${parts.join('\n')}` : '【当前模块状态】暂无记录。';
}

export function buildWorldModuleRequest({ moduleId, settings, data, sourceContext = {} }) {
    const definition = getModuleDefinition(moduleId);
    if (!definition || moduleId === 'forum') throw new Error('请选择可独立刷新的世界模块');
    const context = [sourceContext.chat, sourceContext.userPersona, sourceContext.characterPersona,
        ...list(sourceContext.worldInfo).map(entry => entry.content), ...list(sourceContext.facts).map(entry => entry.content)].filter(Boolean).join('\n\n');
    const instruction = buildLinkedWorldInstruction({ settings: {
        ...settings,
        modules: Object.fromEntries(Object.entries(settings.modules || {}).map(([id, value]) => [id, { ...value, generationMode: id === moduleId ? 'linked' : 'independent', joinGeneration: id === moduleId }])),
    }, data, onlyModuleId: moduleId });
    const system = `${builtinPrompt(settings, 'orchestrator')}\n${builtinPrompt(settings, moduleId === 'tasks' ? 'task' : moduleId)}\n${narrativeSafetyInstruction(settings)}`;
    const user = `${instruction}\n\n【故事资料】\n${context || '用户没有为该模块开启酒馆资料读取。'}\n\n只返回 <module_data> 与 </module_data> 包裹的紧凑 JSON；不要生成论坛帖子。最小结构为 <module_data>${moduleOutputShape([moduleId])}</module_data>。`;
    return { system, user, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
}

export function applyModerationProposal(data, settings, proposal, accepted) {
    if (!proposal || proposal.status !== 'pending') return false;
    proposal.status = accepted ? 'accepted' : 'rejected';
    proposal.updatedAt = Date.now();
    const action = proposal.payload || {};
    const report = action.reportId ? list(data?.world?.reports).find(item => item.id === action.reportId) : null;
    if (!accepted) {
        if (report) {
            report.status = 'dismissed';
            report.decision = '用户拒绝了系统 AI 管理员的建议';
            report.updatedAt = Date.now();
        }
        return true;
    }
    const executed = executeModerationAction(data, settings, action);
    if (report && executed) {
        report.status = action.action === 'dismiss' ? 'dismissed' : 'actioned';
        report.action = action.action === 'dismiss' ? 'none' : action.action;
        report.decision = action.reason || '系统 AI 管理员已完成处理';
        report.reviewerNpcId = action.systemAdmin ? 'system-ai-admin' : text(action.actorHandle);
        report.updatedAt = Date.now();
    }
    return executed;
}
