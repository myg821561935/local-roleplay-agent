import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('frontend exposes provider presets and import review controls', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="provider-preset"/);
  assert.match(html, /href="\/styles\.css\?v=\d{8}-\d+"/);
  assert.match(html, /src="\/app\.js\?v=\d{8}-\d+"/);
  assert.match(html, /id="provider-kind"/);
  assert.match(html, /<select id="provider-model"/);
  assert.match(html, /id="provider-model-custom"/);
  assert.match(html, /id="test-provider"/);
  assert.match(html, /id="provider-test-result"/);
  assert.match(html, /id="release-data-panel"/);
  assert.match(html, /id="create-backup"/);
  assert.match(html, /id="backup-select"/);
  assert.match(html, /id="restore-backup"/);
  assert.match(html, /id="import-preview"/);
  assert.match(html, /id="confirm-import"/);
  assert.match(html, /id="cancel-import"/);
  assert.match(html, /id="content-pack-select"/);
  assert.match(html, /id="apply-content-pack"/);
  assert.match(html, /题材内容包/);
  assert.match(html, /value="mingmo"/);
  assert.match(html, /明末风云内容包/);
  assert.match(html, /value="xianxia"/);
  assert.match(html, /太虚仙侠内容包/);
  assert.match(html, /破甲预设：明末历史文字/);
  assert.match(html, /破甲预设：太虚仙侠/);
  assert.match(html, /id="session-provider"/);
  assert.match(html, /id="save-session-settings"/);
  assert.match(html, /id="usage-view"/);
  assert.match(html, /用量统计/);
  assert.match(html, /data-tab="status"/);
  assert.match(html, /id="rule-status-view"/);
  assert.match(html, /id="usage-scope"/);
  assert.match(html, /id="refresh-usage"/);
  assert.match(html, /id="rewrite-chat-input"/);
  assert.match(html, /润色/);
  assert.match(html, /id="random-protagonist"/);
  assert.match(html, /id="random-protagonist-genre"/);
  assert.match(html, /明末/);
  assert.match(html, /value="mingmo_chongzhen"/);
  assert.match(html, /崇祯（明末皇帝线）/);
  assert.match(html, /自定义主角模板/);
  assert.match(html, /data-tab="sources"/);
  assert.match(html, /value="xianxia-scroll"/);
  assert.match(html, /id="source-select"/);
  assert.match(html, /id="source-query"/);
  assert.match(html, /id="source-search"/);
  assert.match(html, /id="source-results"/);

  assert.match(app, /PROVIDER_PRESETS/);
  assert.match(app, /models:/);
  assert.match(app, /renderProviderModelOptions/);
  assert.match(app, /resolveSelectedProviderModel/);
  assert.match(app, /testProviderConnectionAction/);
  assert.match(app, /\/api\/providers\/test/);
  assert.match(app, /createBackupAction/);
  assert.match(app, /restoreBackupAction/);
  assert.match(app, /anthropic/);
  assert.match(app, /gemini/);
  assert.match(app, /\/api\/import\/preview/);
  assert.match(app, /\/api\/import\/commit/);
  assert.match(app, /adult-creative-mode/);
  assert.match(app, /成人创作沙盒/);
  assert.match(app, /PROTAGONIST_GENERATOR/);
  assert.match(app, /generateRandomProtagonistCard/);
  assert.match(app, /applyContentPack/);
  assert.match(app, /\/api\/content-packs/);
  assert.match(app, /generateLingyiProtagonistCard/);
  assert.match(app, /MINGMO_PROTAGONIST_GENERATOR/);
  assert.match(app, /generateMingmoProtagonistCard/);
  assert.match(app, /XIANXIA_PROTAGONIST_GENERATOR/);
  assert.match(app, /generateXianxiaProtagonistCard/);
  assert.match(app, /mingmo_chongzhen/);
  assert.match(app, /朱由检/);
  assert.match(app, /renderUsageView/);
  assert.match(app, /renderRuleStatus/);
  assert.match(app, /ruleSystem/);
  assert.match(app, /formatRuleFieldValue/);
  assert.match(app, /loadUsageStats/);
  assert.match(app, /\/api\/usage/);
  assert.match(app, /USAGE_REFRESH_INTERVAL_MS\s*=\s*30000/);
  assert.match(app, /saveSessionSettings/);
  assert.match(app, /\/api\/session\/settings/);
  assert.match(app, /formatTokenCount/);
  assert.match(app, /rewriteChatInput/);
  assert.match(app, /\/api\/rewrite/);
  assert.match(app, /searchImportSources/);
  assert.match(app, /\/api\/import-sources\/search/);
  assert.match(app, /\/api\/import-sources\/download/);
  assert.match(app, /renderSetupPanel/);
  assert.match(app, /function renderSetupPanel/);
  assert.match(app, /resolvePrologueTemplate/);
  assert.match(app, /getCurrentPrologueGenre/);
  assert.match(app, /const candidates = \[selectedPack,\s*visualContentPack,\s*sessionGenre,\s*cardGenre,/);
  assert.match(app, /startJourney/);
  assert.match(app, /\/prologue-template\.json/);
  assert.match(app, /data-destiny-card/);
  assert.match(app, /epic-setup-footer/);
  assert.match(app, /epic-seal-hint/);
  assert.match(app, /返回创作台/);
  assert.match(app, /PROLOGUE_RANDOM_POOLS/);
  assert.match(app, /generateSetupFieldValue/);
  assert.match(app, /getSetupRandomContext/);
  assert.match(app, /buildJourneyPrompt/);
  assert.match(app, /buildJourneyWorldbookSnapshot/);
  assert.match(app, /renderJourneyDraft/);
  assert.match(app, /state\.pendingJourneyDraft/);
  assert.doesNotMatch(app, /els\.chatInput\.value = promptText;\s*await sendMessage\(\);/);
  assert.doesNotMatch(app, /input\.value = randomFrom\(field\.rolls\)/);
  assert.match(html, /value="lingyi_tangyue"/);
  assert.match(html, /唐月（灵异女刑警线）/);
  assert.match(html, /value="mingmo_luyiniang"/);
  assert.match(html, /陆宜娘（明末商帮线）/);
  assert.match(html, /value="xuanhuan_lingshuang"/);
  assert.match(html, /凌霜（听雨楼暗桩线）/);
  assert.match(html, /value="xianxia_wenxuezhao"/);
  assert.match(html, /闻雪照（断魂灯旧案线）/);

  const css = await readFile('public/styles.css', 'utf8');
  assert.match(css, /xianxia-scroll/);
  assert.match(app, /xianxia-stage\.png/);
  assert.match(css, /\.epic-destiny-grid/);
  assert.match(css, /\.epic-journey-row/);
  assert.match(css, /\.epic-journey-draft/);
});

test('prologue templates are genre-aware and include destiny cards', async () => {
  const template = JSON.parse(await readFile('public/prologue-template.json', 'utf8'));
  const app = await readFile('public/app.js', 'utf8');

  assert.deepEqual(Object.keys(template.genres).sort(), ['lingyi', 'mingmo', 'xianxia', 'xuanhuan', 'yingxiongzhi']);
  assert.equal(template.themeGenreMap['wuxia-scroll'], 'xuanhuan');
  assert.equal(template.themeGenreMap['xianxia-scroll'], 'xianxia');
  assert.equal(template.themes['wuxia-scroll'], 'xuanhuan');
  assert.equal(template.themes['xianxia-scroll'], 'xianxia');
  assert.match(app, /typeof themeFallback === 'string'/);

  for (const genre of ['xuanhuan', 'lingyi', 'mingmo', 'xianxia', 'yingxiongzhi']) {
    const tpl = template.genres[genre];
    assert.ok(tpl.title);
    assert.ok(tpl.tabs.worldSetting);
    assert.ok(tpl.tabs.rules);
    assert.ok(tpl.tabs.currentCrisis);
    assert.equal(Object.keys(tpl.fields).length >= 10, true);
    assert.equal(tpl.destinyCards.cards.length >= 8, true);
    assert.match(tpl.tabs.worldSetting.content, /【/);
    assert.match(tpl.tabs.rules.content, /【/);
    assert.match(tpl.tabs.currentCrisis.content, /【/);
  }

  assert.match(JSON.stringify(template.genres.lingyi), /死亡倒计时|禁忌标记|微笑命案/);
  assert.match(JSON.stringify(template.genres.mingmo), /密诏残页|银粮危机|崇祯末年/);
  assert.match(JSON.stringify(template.genres.xuanhuan), /雁回关|天机榜|秘境/);
  assert.match(JSON.stringify(template.genres.xianxia), /天命榜|本命神通|功法品阶/);
  assert.match(JSON.stringify(template.genres.yingxiongzhi), /乱世文章|三重旧账|信息隔离/);
});

test('chat background customization is explicit and not owned by themes', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /id="background-mode"/);
  assert.match(html, /id="background-status"/);
  assert.match(html, /舞台背景：未设置/);
  assert.match(html, /界面皮肤只影响工作台，不覆盖会话内容/);
  assert.match(html, /清除背景/);
  assert.match(app, /url:\s*'\/assets\/xuanhuan-luoyan-stage\.png'/);
  assert.match(app, /url:\s*'\/assets\/lingyi-yongan-stage\.png'/);
  assert.match(app, /url:\s*'\/assets\/mingmo-chongzhen-stage\.png'/);
  assert.match(app, /url:\s*'\/assets\/wuxia-stage\.png'/);
  assert.match(app, /url:\s*'\/assets\/xianxia-stage\.png'/);
  assert.match(app, /CONTENT_PACK_VISUAL_PRESETS/);
  assert.match(app, /xuanhuan:\s*\{[\s\S]*theme:\s*'wuxia-scroll'[\s\S]*backgroundImage:\s*'\/assets\/xuanhuan-luoyan-stage\.png'/);
  assert.match(app, /lingyi:\s*\{[\s\S]*theme:\s*'default-dark'[\s\S]*backgroundImage:\s*'\/assets\/lingyi-yongan-stage\.png'/);
  assert.match(app, /mingmo:\s*\{[\s\S]*theme:\s*'wuxia-scroll'[\s\S]*backgroundImage:\s*'\/assets\/mingmo-chongzhen-stage\.png'/);
  assert.match(app, /xianxia:\s*\{[\s\S]*theme:\s*'xianxia-scroll'[\s\S]*backgroundImage:\s*'\/assets\/xianxia-stage\.png'/);
  assert.match(app, /function linkContentPackVisuals/);
  assert.match(app, /function handleContentPackSelectionChange/);
  assert.match(app, /正在同步规则、世界书、角色卡和视觉/);
  assert.match(app, /const payload = await applyContentPack\(\)/);
  assert.match(app, /setOpeningGenre\(option\.id, \{ linkVisuals: false \}\)/);
  assert.match(app, /visualContentPack/);
  assert.match(app, /function normalizeBackgroundUrlForMatch/);
  assert.match(app, /function backgroundUrlsMatch/);
  assert.match(app, /getBackgroundLabelForUrl/);
  assert.match(app, /els\.contentPackSelect\?\.addEventListener\('change', \(\) => handleContentPackSelectionChange\(\)\)/);
  assert.match(app, /els\.themeSelect\.addEventListener\('change', \(\) => saveSessionTheme\(els\.themeSelect\.value\)\)/);
  assert.match(app, /function syncSessionVisualState/);
  assert.match(app, /const visualContentPack = state\.session\?\.settings\?\.visualContentPack/);
  assert.match(app, /const candidates = \[selectedPack, visualContentPack, sessionGenre/);
  assert.match(app, /const visualPreset = await linkContentPackVisuals\(visualPackId, \{ persist: true \}\)/);
  assert.match(app, /已应用到会话：\$\{payload\.appliedPack\?\.title \|\| packId\} · 视觉：\$\{visualPreset\.label\}/);
  assert.match(app, /preset\.url\s*\|\|/);
  assert.match(app, /updateBackgroundModeUi/);
  assert.match(app, /舞台背景：未设置/);
  assert.match(app, /自定义舞台背景/);
  assert.match(app, /舞台背景：\$\{label \|\| '自定义'\}/);
  assert.match(css, /var\(--chat-bg-image,\s*linear-gradient/);
  assert.doesNotMatch(css, /var\(--chat-bg-image,\s*url\('\/assets\/wuxia-stage\.png'\)\)/);
  assert.doesNotMatch(css, /var\(--chat-bg-image,\s*url\('\/assets\/xianxia-stage\.png'\)\)/);
  assert.doesNotMatch(css, /:root\[data-theme="wuxia-scroll"\]\s+\.chat-panel\s*\{[\s\S]*background:/);
  assert.doesNotMatch(css, /:root\[data-theme="xianxia-scroll"\]\s+\.chat-panel\s*\{[\s\S]*background:/);
  assert.doesNotMatch(css, /\.chat-panel::before\s*\{[\s\S]*background-image:\s*var\(--chat-bg-image,\s*none\);/);
  assert.match(css, /grid-template-rows:\s*minmax\(320px,\s*45vh\)\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.provider-scroll\s*\{[\s\S]*overflow-y:\s*auto;/);
});

test('v0.2 resource workbench keeps community imports, diagnostics and script composition in one adaptive panel', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /data-tab="sources"[^>]*>资源库</);
  assert.match(html, /data-resource-view="library"/);
  assert.match(html, /data-resource-view="online"/);
  assert.match(html, /data-resource-view="composer"/);
  assert.match(html, /id="resource-pack-form"/);
  assert.match(html, /id="resource-pack-worldbooks"/);
  assert.match(html, /id="resource-pack-prompts"/);
  assert.match(html, /class="resource-flow"/);
  assert.match(html, /id="import-review-dialog"/);
  assert.match(html, /id="import-apply-current"/);
  assert.match(html, /只存入素材库，不改变正在写的剧本/);
  assert.match(app, /\/api\/resource-library\/resources/);
  assert.match(app, /\/api\/resource-library\/packs/);
  assert.match(app, /function renderResourceWorkbench/);
  assert.match(app, /function createResourcePack/);
  assert.match(app, /preview\.inspection/);
  assert.match(app, /applyToActiveConfig/);
  assert.match(app, /function createImportResourceReport/);
  assert.match(app, /payload\.appliedPack\?\.visualPackId \|\| packId/);
  assert.match(css, /\.inspector-panel\.resource-workbench-open:not\(\.collapsed\)\s*\{[\s\S]*width:\s*420px/);
  assert.match(css, /\.resource-view\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.resource-library-list[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.import-review-dialog/);
  assert.match(css, /\.import-dimension-list/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.inspector-panel\.resource-workbench-open:not\(\.collapsed\)[\s\S]*width:\s*auto/);
});

test('provider configuration uses an internal scroll body for expandable tools', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /<div class="provider-scroll">[\s\S]*<form id="provider-form" class="form-grid">/);
  assert.match(html, /<aside id="provider-panel" class="panel provider-panel collapsed"/);
  assert.match(html, /id="open-provider-panel"/);
  assert.match(html, /展开接口配置/);
  assert.match(html, /aria-controls="provider-panel" aria-expanded="false"/);
  assert.match(html, /id="inspector-panel" class="panel inspector-panel collapsed"/);
  assert.match(html, /aria-controls="inspector-panel" aria-expanded="false"/);
  assert.match(html, /<details id="mcp-panel" class="worldbook-entries-panel"/);
  assert.match(html, /<\/details>\s*<\/div>\s*<\/aside>\s*<section class="panel chat-panel"/);

  assert.match(app, /function setWorkspacePanelExpanded/);
  assert.match(app, /setWorkspacePanelExpanded\('provider', true\)/);
  assert.match(app, /setWorkspacePanelExpanded\('provider', false\)/);
  assert.match(app, /setWorkspacePanelExpanded\('inspector', true\)/);
  assert.match(app, /setWorkspacePanelExpanded\('inspector', false\)/);
  assert.match(app, /setWorkspaceActiveView\('chat'\)/);
  assert.match(app, /button\.dataset\.mobileView === 'provider'[\s\S]*setWorkspacePanelExpanded\('provider', true\)/);
  assert.match(app, /button\.dataset\.mobileView === 'inspector'[\s\S]*setWorkspacePanelExpanded\('inspector', true\)/);

  assert.match(css, /\.provider-scroll\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /\.provider-scroll\s*>\s*details\[open\]\s*\{[\s\S]*max-height:\s*min\(430px,\s*70vh\);/);
  assert.match(css, /@media \(max-width:\s*1180px\)[\s\S]*\.provider-scroll\s*>\s*details\[open\]\s*\{[\s\S]*max-height:\s*min\(270px,\s*48vh\);/);
  assert.doesNotMatch(css, /\.provider-panel\s*\.form-grid\s*\{[^}]*overflow:\s*visible;/);
  assert.match(css, /\.provider-panel\.collapsed,[\s\S]*\.inspector-panel\.collapsed\s*\{[\s\S]*width:\s*48px;[\s\S]*min-width:\s*48px;/);
  assert.match(css, /\.collapsed-rail-button\s*\{[\s\S]*display:\s*none;/);
  assert.match(css, /\.panel\.collapsed\s*>\s*\*:not\(\.collapsed-rail-button\)\s*\{[\s\S]*visibility:\s*hidden;/);
  assert.match(css, /\.panel\.collapsed\s+\.collapsed-rail-button\s*\{[\s\S]*display:\s*flex;[\s\S]*width:\s*100%;/);
  assert.match(css, /\.panel\.collapsed\s+\.collapsed-rail-button svg\s*\{[\s\S]*width:\s*32px;[\s\S]*height:\s*32px;/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.provider-panel\.collapsed,[\s\S]*\.inspector-panel\.collapsed\s*\{[\s\S]*width:\s*auto;[\s\S]*min-width:\s*0;/);
});

test('world book inspector editor keeps long entry lists scrollable', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(html, /<section class="tab-pane worldbook-pane" data-pane="worldbook"/);
  assert.match(html, /id="worldbook-entries-panel" class="worldbook-entries-panel" open/);
  assert.match(html, /class="advanced-data-panel worldbook-advanced-panel"/);
  assert.match(html, /高级 JSON 与导入导出/);
  assert.match(css, /\.worldbook-pane\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;/);
  assert.match(css, /\.worldbook-entries-list\s*\{[\s\S]*max-height:\s*min\(420px,\s*52vh\);[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /\.wb-editor-dialog\s*\{[\s\S]*display:\s*flex;[\s\S]*overflow:\s*hidden;/);
  assert.match(css, /\.wb-editor-body\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /\.wb-editor-actions\s*\{[\s\S]*position:\s*sticky;/);
  assert.match(app, /body\.className = 'wb-editor-body';/);
  assert.match(app, /btnRow\.className = 'wb-editor-actions';/);
});

test('world book browser groups large lore libraries with search and readable previews', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /id="worldbook-search"/);
  assert.match(html, /id="worldbook-type-filter"/);
  assert.match(html, /id="worldbook-browser-count"/);
  assert.match(html, /世界圣经浏览与编辑/);
  assert.match(app, /const WORLD_BOOK_TYPE_LABELS =/);
  assert.match(app, /function createWorldbookEntryRow/);
  assert.match(app, /function syncWorldbookTypeFilter/);
  assert.match(app, /worldbookSearch\?\.addEventListener\('input', renderWorldbookEntries\)/);
  assert.match(app, /worldbookTypeFilter\?\.addEventListener\('change', renderWorldbookEntries\)/);
  assert.match(css, /\.worldbook-browser-toolbar\s*\{/);
  assert.match(css, /\.worldbook-entry-group-summary\s*\{/);
  assert.match(css, /\.worldbook-entry-preview\s*\{/);
  assert.match(css, /-webkit-line-clamp:\s*3/);
});

test('inspector controls stay usable in narrow drawers', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /<details class="group-section inspector-subsection">/);
  assert.match(html, /id="inspector-tab-select"/);
  assert.doesNotMatch(html, /class="preset-controls" style="[^"]*display:\s*flex/);
  assert.match(css, /\.inspector-panel\s+\.tab-pane\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;/);
  assert.match(css, /\.tabs\s*\{[\s\S]*display:\s*flex;[\s\S]*overflow-x:\s*auto;/);
  assert.match(css, /\.tab-button\s*\{[\s\S]*flex:\s*0\s+0\s+auto;/);
  assert.match(css, /\.preset-controls\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/);
  assert.match(css, /#character-card-editor,\s*#worldbook-editor,\s*#prompt-editor\s*\{[\s\S]*flex:\s*0\s+0\s+clamp\(180px,\s*32vh,\s*340px\);/);
  assert.match(css, /\.editor-actions\s+\.status-text:empty\s*\{[\s\S]*display:\s*none;/);
  assert.match(css, /\.inspector-subsection\s*\{[\s\S]*margin-top:\s*12px;/);
  assert.match(app, /els\.openProviderPanel\?\.addEventListener\('click', \(\) => setWorkspacePanelExpanded\('provider', true\)\)/);
  assert.match(app, /els\.toggleInspectorPanel\?\.addEventListener\('click', \(\) => setWorkspacePanelExpanded\('inspector', false\)\)/);
  assert.match(app, /button\.addEventListener\('click', \(\) => activateTab\(button\.dataset\.tab\)\)/);
  assert.match(app, /function syncInspectorTabSelect/);
  assert.match(app, /inspectorTabSelect\?\.addEventListener\('change'/);
  assert.match(app, /els\.inspectorPanel\?\.querySelectorAll\('\.tab-button\[data-tab\]'\)/);
  assert.match(app, /els\.inspectorPanel\?\.querySelectorAll\('\.tab-pane\[data-pane\]'\)/);
  assert.match(app, /pane\.hidden = !active/);
  assert.match(app, /button\.tabIndex = active \? 0 : -1/);
});

test('modern workbench composer keeps tools in compact editor flow', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /<div class="composer">/);
  assert.match(html, /class="stage-actions"/);
  assert.match(html, /class="send-button"/);
  assert.doesNotMatch(css, /--quick-replies-block:/);
  assert.match(css, /\.composer\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*3;/);
  assert.match(css, /\.stage-actions\s*\{[\s\S]*flex-wrap:\s*nowrap;[\s\S]*overflow-x:\s*auto;/);
  assert.match(css, /\.quick-replies-bar\s*\{[\s\S]*flex-wrap:\s*nowrap;[\s\S]*overflow-x:\s*auto;/);
  assert.match(css, /\.chat-form\s*\{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*flex-end;/);
  assert.match(css, /\.send-button\s*\{[\s\S]*position:\s*absolute;[\s\S]*border-radius:\s*50%;/);
});

test('empty session cover guides opening flow through content packs', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(app, /OPENING_GENRE_OPTIONS/);
  assert.match(app, /function setOpeningGenre/);
  assert.match(app, /function renderOpeningWorkflow/);
  assert.match(app, /function startGuidedJourney/);
  assert.match(app, /className = 'epic-start-flow'/);
  assert.match(app, /classList\.add\('has-cover-page'\)/);
  assert.match(app, /className = 'epic-cover-actions'/);
  assert.match(app, /dataset\.openingGenre/);
  assert.match(app, /await applyContentPack\(\)/);
  assert.match(app, /renderSetupPanel\(resolvePrologueTemplate\(\)\.tpl\)/);
  assert.match(css, /\.messages\.has-cover-page\s*\{[\s\S]*padding-bottom:\s*clamp\(74px,\s*10vh,\s*112px\);/);
  assert.match(css, /\.messages\.has-cover-page\s+\.epic-cover-page\s*\{[^}]*height:\s*auto;/);
  assert.match(css, /\.messages\.has-cover-page\s+\.epic-cover-page\s*\{[^}]*max-height:\s*min\(640px,\s*calc\(100%\s*-\s*8px\)\);/);
  assert.match(css, /\.messages\.has-cover-page\s+\.epic-cover-page\s*\{[^}]*overflow-y:\s*auto;/);
  assert.match(css, /\.epic-start-flow\s*\{[^}]*flex:\s*0 0 auto;[^}]*min-height:\s*0;[^}]*overflow:\s*visible;/);
  assert.doesNotMatch(css, /calc\(100vh\s*-\s*270px\)/);
  assert.match(css, /\.epic-cover-actions\s*\{[^}]*position:\s*relative;/);
  assert.doesNotMatch(css, /\.epic-cover-actions\s*\{[^}]*position:\s*sticky;/);
  assert.match(css, /\.epic-start-flow\s*\{/);
  assert.match(css, /\.epic-flow-steps\s*\{/);
  assert.match(css, /\.epic-flow-status\s*\{[\s\S]*display:\s*none;/);
  assert.match(css, /\.epic-genre-grid\s*\{/);
  assert.match(css, /\.epic-genre-choice\.active\s*\{/);
});

test('guided opening fuses a script dossier with protagonist and destiny creation', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(app, /function appendDossierContent/);
  assert.match(app, /\{ key: 'dossier', label: '开局卷宗', step: '01' \}/);
  assert.match(app, /\{ key: 'protagonist', label: '主角塑成', step: '02' \}/);
  assert.match(app, /\{ key: 'destiny', label: '天命抉择', step: '03' \}/);
  assert.match(app, /buildJourneyWorldbookSnapshot\(6\)/);
  assert.match(app, /epic-dossier-worldbook/);
  assert.match(app, /maxDestinySelections/);
  assert.match(app, /collectSelectedDestinyCards\(\)\.length > maxDestinySelections/);
  assert.match(app, /activatePane\('dossier'\)/);
  assert.match(app, /sealButton\.addEventListener\('click', finishJourney\)/);
  assert.match(app, /人物 \$\{filledCount\}\/\$\{fieldEntries\.length\} · 天命 \$\{selectedDestiny\}\/\$\{maxDestinySelections\}/);

  assert.match(css, /\.epic-dossier-grid\s*\{/);
  assert.match(css, /\.epic-dossier-section\s*\{/);
  assert.match(css, /\.epic-dossier-worldbook\s*\{/);
  assert.match(css, /\.epic-setup-footer\s*\{/);
  assert.match(css, /\.epic-destiny-counter\.is-limit\s*\{/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.epic-dossier-grid,[\s\S]*grid-template-columns:\s*1fr;/);
});

test('desktop launch defaults to an immersive stage instead of a configuration workbench', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /<aside id="provider-panel" class="panel provider-panel collapsed"/);
  assert.match(html, /<aside id="inspector-panel" class="panel inspector-panel collapsed"/);
  assert.match(html, /data-tab="status"[\s\S]*aria-selected="true">状态/);
  assert.match(html, /<section class="tab-pane active" data-pane="status"/);
  assert.match(html, /data-tab="memory"[\s\S]*aria-selected="false">记忆/);
  assert.match(css, /\.immersive-right-sidebar\s*\{[\s\S]*top:\s*108px;[\s\S]*bottom:\s*126px;/);
  assert.match(css, /\.immersive-sidebar-tab\s*\{[\s\S]*min-height:\s*86px;[\s\S]*opacity:\s*0\.74;/);
  assert.match(css, /\.stage-actions\s*\{[\s\S]*width:\s*max-content;[\s\S]*margin:\s*0 auto 5px;[\s\S]*opacity:\s*0\.78;/);
});

test('module help popover is wired for subtle contextual guidance', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(app, /const MODULE_HELP/);
  assert.match(app, /function showModuleHint/);
  assert.match(app, /function resolveModuleHelpKey/);
  assert.match(app, /module-hint-popover/);
  assert.match(app, /data-help-key/);
  assert.match(css, /\.module-hint-popover\s*\{[\s\S]*position:\s*fixed;[\s\S]*backdrop-filter:\s*blur/);
  assert.match(css, /\.module-hint-title\s*\{/);
  assert.match(css, /\.module-hint-close\s*\{/);
});

test('immersive sidebar shell is wired and hidden by default', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /id="immersive-right-sidebar"/);
  assert.match(html, /id="immersive-sidebar-tabs"/);
  assert.match(html, /id="immersive-sidebar-body"/);
  assert.match(app, /immersiveRightSidebar/);
  assert.match(app, /function renderImmersiveSidebar/);
  assert.match(app, /function selectImmersiveSidebarTab/);
  assert.match(app, /sidebar\.tabs/);
  assert.match(css, /\.hidden\s*\{[\s\S]*display:\s*none\s*!important;/);
  assert.match(css, /\.immersive-right-sidebar\s*\{[\s\S]*right:\s*calc\(300px \+ 16px\);/);
  assert.match(css, /\.workspace:has\(\.inspector-panel\.collapsed\) \.immersive-right-sidebar\s*\{/);
  assert.match(css, /\.immersive-sidebar-tabs\s*\{/);
  assert.match(css, /\.immersive-sidebar-tab\s*\{/);
  assert.match(css, /\.immersive-sidebar-tab\.active\s*\{/);
});

test('layout polish keeps the narrative stage dominant and composer compact', async () => {
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(css, /\.workspace\s*\{[\s\S]*gap:\s*12px;/);
  assert.match(css, /\.provider-panel\s*\{[\s\S]*width:\s*232px;/);
  assert.match(css, /\.inspector-panel\s*\{[\s\S]*width:\s*300px;/);
  assert.match(css, /\.chat-panel\s*\{[\s\S]*box-shadow:\s*0 24px 60px rgba\(0,\s*0,\s*0,\s*0\.38\)/);
  assert.match(css, /\.provider-panel,\s*\.inspector-panel\s*\{[\s\S]*background:\s*rgba\(11,\s*15,\s*18,\s*0\.86\);/);
  assert.match(css, /\.composer\s*\{[\s\S]*margin:\s*0 18px 18px;[\s\S]*border-radius:\s*18px;[\s\S]*backdrop-filter:\s*blur\(14px\);/);
  assert.match(css, /:root\[data-theme="wuxia-scroll"\]\s+\.composer,[\s\S]*:root\[data-theme="xianxia-scroll"\]\s+\.composer\s*\{[\s\S]*padding:\s*7px 9px 9px;/);
  assert.match(css, /\.stage-actions\s*\{[\s\S]*padding:\s*4px 5px 5px;[\s\S]*max-height:\s*30px;/);
  assert.match(css, /\.stage-actions \.tool-button\s*\{[\s\S]*height:\s*24px;[\s\S]*font-size:\s*11px;/);
  assert.match(css, /\.chat-form textarea\s*\{[\s\S]*min-height:\s*44px;[\s\S]*max-height:\s*132px;[\s\S]*border-radius:\s*16px;/);
});

test('immersive visual direction makes the stage feel game-like instead of generic chat', async () => {
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(css, /\.chat-panel::before\s*\{[\s\S]*border:\s*1px solid rgba\(129,\s*212,\s*202,\s*0\.22\);/);
  assert.match(css, /\.chat-panel::after\s*\{[\s\S]*linear-gradient\(120deg,\s*transparent 0 38%,\s*rgba\(129,\s*212,\s*202,\s*0\.1\) 38% 39%,/);
  assert.match(css, /\.chat-panel > \*\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*1;/);
  assert.match(css, /\.epic-cover-page\s*\{[\s\S]*radial-gradient\(circle at 50% 0%,\s*rgba\(129,\s*212,\s*202,\s*0\.16\),\s*transparent 44%\);/);
  assert.match(css, /\.epic-cover-page::before,[\s\S]*\.epic-cover-page::after\s*\{[\s\S]*border:\s*1px solid rgba\(214,\s*166,\s*74,\s*0\.4\);/);
  assert.match(css, /\.composer::before\s*\{[\s\S]*background:\s*linear-gradient\(90deg,\s*transparent,\s*rgba\(129,\s*212,\s*202,\s*0\.44\),\s*transparent\);/);
  assert.match(css, /\.stage-actions\s*\{[\s\S]*background:\s*rgba\(2,\s*8,\s*10,\s*0\.34\);/);
  assert.match(css, /\.immersive-sidebar-tab\s*\{[\s\S]*min-width:\s*42px;[\s\S]*border-radius:\s*14px 5px 5px 14px;/);
});

test('narrow workbench switches to single-stage mode before panels crush the chat', async () => {
  const css = await readFile('public/styles.css', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  assert.match(css, /@media \(max-width:\s*900px\)\s*\{[\s\S]*\.workspace\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
  assert.match(css, /@media \(max-width:\s*900px\)\s*\{[\s\S]*\.app-shell\s*\{[\s\S]*height:\s*100dvh;/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.provider-panel,[\s\S]*\.inspector-panel,[\s\S]*width:\s*auto;/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.workspace\s*\{[\s\S]*height:\s*auto;[\s\S]*min-height:\s*0;/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.send-button\s*\{[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/);
  assert.match(css, /@media \(max-width:\s*900px\)\s*\{[\s\S]*\.workspace\[data-active-view="chat"\] \.chat-panel/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.messages\.has-cover-page\s*\{[\s\S]*align-items:\s*stretch;[\s\S]*justify-content:\s*flex-start;/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*\.messages\.has-cover-page\s+\.epic-cover-page\s*\{[\s\S]*height:\s*auto;[\s\S]*max-height:\s*none;[\s\S]*overflow:\s*visible;/);
  assert.match(app, /matchMedia\('\(max-width:\s*900px\)'\)/);
  assert.doesNotMatch(css, /@media \(max-width:\s*760px\)/);
  assert.doesNotMatch(app, /max-width:\s*760px/);
});

test('memory inspector leads with a creator overview and keeps raw data optional', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /id="memory-overview"/);
  assert.match(html, /<details class="advanced-data-panel">[\s\S]*原始记忆数据[\s\S]*id="memory-view"/);
  assert.match(app, /function renderMemoryOverview/);
  assert.match(app, /长期叙事记忆/);
  assert.match(app, /当前叙事坐标/);
  assert.match(css, /\.memory-overview\s*\{/);
  assert.match(css, /\.memory-metrics\s*\{/);
  assert.match(css, /\.memory-context-grid,/);
});

test('immersive option cards from markdown have dedicated styling', async () => {
  const markdown = await readFile('public/markdown.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(markdown, /parseImmersiveOptions/);
  assert.match(markdown, /immersive-options-card/);
  assert.match(css, /\.immersive-options-card\s*\{/);
  assert.match(css, /\.immersive-options-stamp\s*\{/);
  assert.match(css, /\.immersive-options-title\s*\{/);
  assert.match(css, /\.immersive-option-item\s*\{/);
});

test('streaming preview removes both empty state and cover page shells', async () => {
  const app = await readFile('public/app.js', 'utf8');

  assert.match(app, /querySelectorAll\('\.empty-state,\s*\.epic-cover-page'\)/);
  assert.match(app, /classList\.remove\('has-cover-page'\)/);
});

test('character preset library covers more genre-matched roles', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');

  const requiredPresetIds = [
    'xuanhuan_wangshen',
    'xuanhuan_youquan',
    'xianxia_chisong',
    'xianxia_suyue',
    'lingyi_baiqiao',
    'lingyi_xuhe',
    'mingmo_zhaotiejing',
    'mingmo_shenruoxu'
  ];

  requiredPresetIds.forEach((id) => {
    assert.match(html, new RegExp(`value="${id}"`));
    assert.match(app, new RegExp(`${id}: \\{`));
  });

  const supplementalPresetIds = [
    'xuanhuan_jiangwenque',
    'xuanhuan_tieqing',
    'xuanhuan_sumubai',
    'xuanhuan_wubanjin',
    'lingyi_linsu',
    'lingyi_zhaopo',
    'lingyi_qianshouyi',
    'lingyi_shenwanqiu',
    'mingmo_hesanlang',
    'mingmo_cuidangtou',
    'xianxia_yunqianhe',
    'xianxia_fengjiuyi'
  ];

  supplementalPresetIds.forEach((id) => {
    assert.match(html, new RegExp(`value="${id}"`));
    assert.match(app, new RegExp(`${id}: createSupplementalCharacterPreset\\(`));
  });

  assert.match(app, /独立目标、资源、恐惧和底线/);
  assert.match(app, /随身带/);
  assert.match(app, /追踪：/);
});

test('work modes separate creation, immersion, settings and debug while exposing the current content stack', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /id="work-mode-switch"/);
  assert.match(html, /data-work-mode="creative"/);
  assert.match(html, /data-work-mode="immersive"/);
  assert.match(html, /data-work-mode="settings"/);
  assert.match(html, /data-work-mode="debug"/);
  assert.match(html, /id="exit-immersive-mode"/);
  assert.match(html, /界面皮肤/);
  assert.match(html, /舞台背景/);
  assert.match(html, /id="content-stack-status"/);
  assert.match(html, /id="content-stack-items"/);
  assert.match(html, /应用到会话/);
  assert.match(app, /const WORK_MODES =/);
  assert.match(app, /workModeButtons: Array\.from\(document\.querySelectorAll\('#work-mode-switch \.work-mode-button\[data-work-mode\]'\)\)/);
  assert.doesNotMatch(app, /workModeButtons: Array\.from\(document\.querySelectorAll\('\[data-work-mode\]'\)\)/);
  assert.match(app, /function activateWorkMode/);
  assert.match(app, /document\.documentElement\.dataset\.workMode = safeMode/);
  assert.match(app, /safeMode === 'creative' \|\| safeMode === 'immersive'/);
  assert.match(app, /function renderContentStack/);
  assert.match(app, /function setContentPackPreviewStatus/);
  assert.match(app, /仅视觉预览/);
  assert.match(app, /混合创作栈/);
  assert.match(app, /已同步/);
  assert.match(app, /\['主线', activeArc\]/);
  assert.match(app, /\['参考', referenceSummary\]/);
  assert.match(app, /narrativeState\.activeArc/);
  assert.match(app, /extensions\?\.inspirationRefs/);
  assert.match(css, /\.work-mode-switch\s*\{/);
  assert.match(css, /:root\[data-work-mode="immersive"\] \.chat-panel/);
  assert.match(css, /\.tool-button:not\(\[data-immersive-action\]\)/);
  assert.match(css, /\.exit-immersive-button/);
  assert.match(css, /\.content-stack-summary\s*\{/);
  assert.match(css, /\[data-work-mode="creative"\]/);
  assert.match(css, /\[data-mode-groups~="settings"\]/);
  assert.match(css, /\[data-mode-groups~="debug"\]/);
});

test('chat header exposes persistent narrative route controls', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /id="narrative-mode-switch"/);
  assert.match(html, /aria-label="叙事约束"/);
  assert.match(html, /data-narrative-mode="free"/);
  assert.match(html, /data-narrative-mode="stable"/);
  assert.match(html, /data-narrative-mode="strict"/);
  assert.match(app, /async function saveNarrativeMode/);
  assert.match(app, /\['free', 'stable', 'strict'\]\.includes\(mode\) \? mode : 'stable'/);
  assert.match(css, /\.narrative-mode-switch\s*\{/);
  assert.match(css, /\.narrative-mode-button\.active\s*\{/);
});

test('character cards use a readable overview and warn before cross-genre loading', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');

  assert.match(html, /id="character-overview"/);
  assert.match(html, /class="advanced-data-panel character-advanced-panel"/);
  assert.match(html, /高级 JSON 编辑/);
  assert.match(app, /function renderCharacterOverview/);
  assert.match(app, /function inferCharacterContentPackId/);
  assert.match(app, /function confirmCharacterCompatibility/);
  assert.match(app, /题材冲突：当前故事是/);
  assert.match(app, /button\.textContent = '仍然加载'/);
  assert.match(css, /\.character-overview\s*\{/);
  assert.match(css, /\.character-compatibility-warning\s*\{/);
  assert.match(css, /\.character-advanced-panel #character-card-editor/);
});

test('Hero script is wired through selectors, visuals, guided opening and dynamic character presets', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');
  const template = JSON.parse(await readFile('public/prologue-template.json', 'utf8'));

  assert.match(html, /<option value="yingxiongzhi">英雄志群像内容包<\/option>/);
  assert.match(html, /<option value="yingxiongzhi">英雄志<\/option>/);
  assert.match(app, /id: 'yingxiongzhi'/);
  assert.match(app, /CONTENT_PACK_VISUAL_PRESETS[\s\S]*yingxiongzhi:/);
  assert.match(app, /loadContentPackCharacterPresets\('yingxiongzhi'/);
  assert.match(app, /generateYingxiongzhiProtagonistCard/);
  assert.match(app, /extensions\?\.visibility/);
  assert.match(css, /\.epic-genre-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(5,/);
  assert.match(css, /\.messages\.has-cover-page \.epic-cover-page\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.equal(template.genres.yingxiongzhi.title, '英 雄 志');
  assert.equal(template.genres.yingxiongzhi.destinyCards.cards.length, 8);
  assert.ok(template.genres.yingxiongzhi.sidebar.tabs.includes('剧情节点'));
  assert.ok(template.genres.yingxiongzhi.fields.knownInformation);
  assert.ok(template.genres.yingxiongzhi.fields.blindSpot);
});
