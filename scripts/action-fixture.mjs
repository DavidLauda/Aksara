/** Other suites grant activeTab through the real action, then dismiss its menu
 * before exercising image controls. The panel has its own interaction suite. */
export async function dismissActionMenu(page) {
  const menu = page.locator('#aksara-menu-root');
  await menu.waitFor({ state: 'attached' });
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
}
