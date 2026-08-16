import { clearAllData, clearInjection, getSettings, syncInjection } from './src/store.js';
import { initializeForumUi, refreshForumUi } from './src/ui-v3.js';

let initializationPromise = null;

async function initialize() {
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
        getSettings();
        await initializeForumUi();
        syncInjection();
    })().catch(error => {
        initializationPromise = null;
        console.error('[微坛] 初始化失败', error);
        globalThis.toastr?.error?.(`微坛初始化失败：${error.message}`);
    });
    return initializationPromise;
}

export async function onActivate() {
    await initialize();
}

export function onDisable() {
    clearInjection();
    document.getElementById('tavern-forum-root')?.setAttribute('hidden', '');
    document.getElementById('tavern-forum-fab')?.setAttribute('hidden', '');
    document.body.classList.remove('tf-modal-open');
}

export async function onClean() {
    await clearAllData();
    refreshForumUi();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void initialize(), { once: true });
} else {
    queueMicrotask(() => void initialize());
}
