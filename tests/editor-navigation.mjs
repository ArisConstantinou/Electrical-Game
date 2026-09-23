/** Exercise the visible Dock Nest controls instead of reaching through hidden sheets. */
export async function openEditorTab(page, tab) {
  const editor = page.locator('#level-editor');
  const alreadyOpen = await editor.evaluate((element, wanted) =>
    element.dataset.tab === wanted && element.classList.contains('sheet-open') &&
    !element.classList.contains('dock-collapsed'), tab);
  if (alreadyOpen) return;
  if (await editor.evaluate(element => element.classList.contains('dock-collapsed')))
    await page.locator('#level-dock-toggle').click();
  await page.locator(`.level-editor__bottom-nav [data-editor-tab="${tab}"]`).click();
}

export async function openEditorBrowser(page) {
  if (await page.locator('#level-search').isVisible()) return;
  await openEditorTab(page, 'select');
  if (!(await page.locator('#level-search').isVisible()))
    await page.locator('#level-browser-toggle').click();
}

export async function openEditorDetails(page) {
  if (await page.locator('.level-editor__inspector').isVisible()) return;
  await openEditorTab(page, 'transform');
  await page.locator('#level-details-toggle').click();
}

export async function openEditorBuild(page) { await openEditorTab(page, 'build'); }
export async function openEditorScene(page) { await openEditorTab(page, 'starts'); }

export async function saveEditorLevel(page) {
  await openEditorTab(page, 'save');
  await page.locator('#level-save-mobile').click();
}
