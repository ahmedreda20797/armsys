"""Screenshot the module relationship map HTML to PNG."""
import asyncio
from playwright.async_api import async_playwright

async def main():
    html_path = "/home/z/my-project/scripts/module-relationship-map.html"
    png_path = "/home/z/my-project/download/arm-erp-module-relationship-map.png"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={"width": 1600, "height": 1000},
            device_scale_factor=2,
        )
        await page.goto(f"file://{html_path}", wait_until="networkidle")
        # Wait for ECharts animation to finish
        await page.wait_for_timeout(2500)

        # Get the actual chart element size
        chart_el = page.locator("#chart")
        box = await chart_el.bounding_box()
        if box:
            # Screenshot just the chart area
            await chart_el.screenshot(path=png_path)
            print(f"Saved: {png_path} ({box['width']:.0f}x{box['height']:.0f})")
        else:
            # Fallback: full page screenshot
            await page.screenshot(path=png_path, full_page=True)
            print(f"Saved (full page): {png_path}")

        await browser.close()

asyncio.run(main())
