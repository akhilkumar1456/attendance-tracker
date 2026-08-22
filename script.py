from playwright.sync_api import sync_playwright

# 1. REPLACE WITH YOUR ACTUAL WEBSITE URL
target_url = "https://example.com"  

# 2. YOUR POSTER XPATH
poster_xpath = 'xpath=//*[@id="label_3_2_69"]/img'

def run():
    with sync_playwright() as p:
        # Launch Chrome in Incognito mode
        browser = p.chromium.launch(
            headless=False,
            args=["--incognito"]
        )

        # Create isolated incognito context
        context = browser.new_context()
        page = context.new_page()

        print(f"Opening {target_url} in Incognito mode...")
        page.goto(target_url)

        print("Clicking poster image...")
        page.wait_for_selector(poster_xpath)
        page.click(poster_xpath)

        print("\n=======================================================")
        print("ACTION REQUIRED: Solve the CAPTCHA and submit in Chrome.")
        print("=======================================================\n")

        input("Press ENTER in this console once finished to close...")

        context.close()
        browser.close()

if __name__ == "__main__":
    run()
