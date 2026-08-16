import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4173/preview.html';
const executablePath = process.env.TAVERN_FORUM_BROWSER_PATH?.trim();
const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
});

try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await desktop.goto(url, { waitUntil: 'networkidle' });
    const visibleTextImages = await desktop.locator('.tf-feed-list .tf-text-image').count();
    if (visibleTextImages !== 1) throw new Error(`expected only intentional post images to display, found ${visibleTextImages}`);
    if (!/[\u3400-\u9fff]/u.test(await desktop.locator('.tf-text-image p').first().innerText())) throw new Error('text image description is not Chinese');
    const postOrder = await desktop.locator('.tf-post').first().evaluate(post => ({ caption: [...post.children].findIndex(node => node.classList.contains('tf-post-caption')), image: [...post.children].findIndex(node => node.classList.contains('tf-text-image') || node.classList.contains('tf-post-image')), actions: [...post.children].findIndex(node => node.classList.contains('tf-post-actions')) }));
    if (!(postOrder.caption < postOrder.image && postOrder.image < postOrder.actions)) throw new Error('post body, image and action order is incorrect');
    if (await desktop.getByText('文字配图', { exact: true }).count()) throw new Error('text image labels should stay hidden');
    if (await desktop.locator('.tf-post-image-editor').count()) throw new Error('post image editor should stay closed until explicitly requested');
    await desktop.screenshot({ path: 'preview.png' });
    await desktop.locator('[data-action="open-post"]').first().click();
    await desktop.screenshot({ path: 'preview-post-detail.png' });
    await desktop.locator('[data-action="back-post"]').click();
    await desktop.locator('.tf-feed-list [data-action="open-npc"]').first().click();
    await desktop.screenshot({ path: 'preview-public-profile.png' });
    await desktop.locator('[data-action="edit-npc"]').first().click();
    if (await desktop.locator('.tf-memory-card').count()) throw new Error('role memory should not stay embedded in the profile editor');
    await desktop.screenshot({ path: 'preview-role-profile.png' });
    await desktop.locator('.tf-topbar [data-tab="me"]').click();
    await desktop.screenshot({ path: 'preview-profile.png' });
    await desktop.locator('[data-action="me-section"][data-section="memory"]').click();
    if (!await desktop.locator('.tf-memory-card').count()) throw new Error('standalone role memory page is missing');
    await desktop.screenshot({ path: 'preview-role-memory.png' });
    await desktop.locator('[data-action="me-section"][data-section="boundaries"]').click();
    await desktop.screenshot({ path: 'preview-boundaries.png' });
    await desktop.locator('[data-action="me-section"][data-section="sources"]').click();
    await desktop.locator('[data-action="toggle-source-preset"]').check({ force: true });
    if (!await desktop.locator('[data-action="toggle-source-preset"]').isChecked()) throw new Error('preset source switch did not persist');
    if (!await desktop.evaluate(() => globalThis.SillyTavern.getContext().extensionSettings.tavern_forum.sources.sillyTavernPreset)) throw new Error('preset source setting did not persist');
    if (!await desktop.locator('[data-action="toggle-world-book"]').count()) throw new Error('world book master switch is missing');
    if (!await desktop.locator('.tf-world-bound-badge').count()) throw new Error('character-bound world book was not recognized');
    await desktop.screenshot({ path: 'preview-sources.png' });

    await desktop.locator('[data-action="me-section"][data-section="appearance"]').click();
    if (!await desktop.locator('[data-appearance-number="postOpacity"]').count()) throw new Error('post opacity control is missing');
    if (!await desktop.locator('[data-appearance-image-url="brandIcon"]').count()) throw new Error('brand icon control is missing');
    await desktop.locator('[data-action="restore-standard-css"]').click();
    if (!await desktop.locator('.tf-custom-css').inputValue().then(value => value.includes('微坛标准 CSS 美化模板'))) throw new Error('built-in CSS template was not loaded');
    await desktop.screenshot({ path: 'preview-appearance.png' });

    await desktop.locator('.tf-topbar [data-tab="messages"]').click();
    await desktop.locator('[data-action="open-conversation"][data-conversation-id="dm-1"]').click();
    if (!await desktop.locator('.tf-dm-profile-link').count()) throw new Error('conversation header profile link is missing');
    const callsBeforeSend = await desktop.evaluate(() => globalThis.SillyTavern.getContext().generateCalls);
    await desktop.locator('#tf-dm-input').fill('我会避开东岸。');
    await desktop.locator('[data-action="send-dm"]').click();
    await desktop.waitForTimeout(30);
    const callsAfterSend = await desktop.evaluate(() => globalThis.SillyTavern.getContext().generateCalls);
    if (callsAfterSend !== callsBeforeSend) throw new Error('plain DM send unexpectedly called the API');
    await desktop.locator('[data-action="generate-dm-reply"]').click();
    await desktop.waitForFunction(before => globalThis.SillyTavern.getContext().generateCalls > before, callsAfterSend);
    await desktop.screenshot({ path: 'preview-messages.png' });
    await desktop.locator('.tf-dm-profile-link').click();
    if (!await desktop.locator('.tf-public-profile').count()) throw new Error('conversation profile link did not open the role home page');
    await desktop.screenshot({ path: 'preview-dm-profile.png' });
    await desktop.locator('[data-action="close"]').last().click();
    const fab = desktop.locator('#tavern-forum-fab');
    const fabBox = await fab.boundingBox();
    if (!fabBox) throw new Error('floating launcher is missing');
    await desktop.mouse.move(fabBox.x + fabBox.width / 2, fabBox.y + fabBox.height / 2);
    await desktop.mouse.down();
    await desktop.mouse.move(fabBox.x - 70, fabBox.y - 55, { steps: 4 });
    await desktop.mouse.up();
    const savedFabPosition = await desktop.evaluate(() => globalThis.SillyTavern.getContext().extensionSettings.tavern_forum.ui.floatingButtonPosition);
    if (!Number.isFinite(savedFabPosition?.x) || !Number.isFinite(savedFabPosition?.y)) throw new Error('floating launcher position was not saved');

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await mobile.goto(url, { waitUntil: 'networkidle' });
    await mobile.addStyleTag({ content: 'html { height: 0 !important; transform: translateZ(0); } body { position: fixed; inset: 0; height: 100dvh; }' });
    if (!await mobile.locator('#tavern-forum-root').isVisible()) throw new Error('mobile forum did not open from the floating launcher');
    const mobileRootBox = await mobile.locator('#tavern-forum-root').boundingBox();
    if (!mobileRootBox || mobileRootBox.height < 800) throw new Error(`mobile forum collapsed to ${mobileRootBox?.height || 0}px under a transformed zero-height root`);
    await mobile.locator('[data-action="close"]').last().click();
    await mobile.locator('#tavern-forum-menu-item').dispatchEvent('touchend');
    if (!await mobile.locator('#tavern-forum-root').isVisible()) throw new Error('mobile extension menu touch did not open the forum');
    await mobile.screenshot({ path: 'preview-mobile.png' });
    await mobile.locator('[data-action="open-post"]').first().click();
    await mobile.screenshot({ path: 'preview-post-detail-mobile.png' });
    await mobile.locator('[data-action="back-post"]').click();
    await mobile.locator('.tf-mobile-main-nav [data-tab="messages"]').click();
    if (!await mobile.locator('.tf-dm-list').isVisible()) throw new Error('mobile conversation list is not visible');
    await mobile.screenshot({ path: 'preview-messages-list-mobile.png' });
    await mobile.locator('[data-action="open-conversation"]').first().click();
    if (!await mobile.locator('.tf-dm-chat').isVisible() || await mobile.locator('.tf-dm-list').isVisible()) throw new Error('mobile chat did not replace the conversation list');
    await mobile.screenshot({ path: 'preview-messages-chat-mobile.png' });
    await mobile.locator('[data-action="back-dm-list"]').click();
    await mobile.locator('[data-action="message-mode"][data-mode="notifications"]').click();
    await mobile.screenshot({ path: 'preview-notifications-mobile.png' });
} finally {
    await browser.close();
}
