"""Optional read-only UI check. Configure PET_FRONTEND_URL for another local port."""
import os
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.goto(os.environ.get('PET_FRONTEND_URL', 'http://localhost:5173'))
    page.get_by_role('button', name='功能', exact=False).first.click()
    page.get_by_text('桌宠', exact=True).first.click()
    page.get_by_role('button', name='启动桌宠', exact=True).or_(
        page.get_by_role('button', name='停止桌宠', exact=True)).wait_for()
    assert page.locator('select option[value="alicia"], select option[value="vrm1"]').count() == 0
    print('PASS: neutral desktop-pet card, no bundled model presets; settings unchanged')
    browser.close()
