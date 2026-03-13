import time
import pandas as pd
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

# 1. Setup Chrome Options (Headless = runs in background)
chrome_options = Options()
# chrome_options.add_argument("--headless") # Uncomment to run without seeing the window

# 2. Initialize Driver
driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=chrome_options)

def scrape_sahpra_hcr():
    try:
        url = "https://www.sahpra.org.za/approved-licences/"
        driver.get(url)
        print("Page loaded. Looking for HCR tab...")

        # 3. Wait and click the 'HOLDERS OF CERTIFICATE OF PRODUCT REGISTRATION' tab
        # Using XPATH to find the specific text in the tab
        hcr_tab = WebDriverWait(driver, 20).until(
            EC.element_to_be_clickable((By.XPATH, "//div[contains(text(), 'HOLDERS OF CERTIFICATE')]"))
        )
        hcr_tab.click()
        
        # Critical wait for the database/table to load after clicking the tab
        time.sleep(3) 
        print("HCR Tab clicked. Starting extraction...")

        all_rows = []
        page_num = 1

        while True:
            print(f"Scraping page {page_num}...")
            
            # 4. Find the table and rows
            # We wait for the table body to be present
            WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.TAG_NAME, "table")))
            table = driver.find_element(By.TAG_NAME, "table")
            rows = table.find_elements(By.TAG_NAME, "tr")

            for row in rows[1:]: # Skip header row
                cols = row.find_elements(By.TAG_NAME, "td")
                if len(cols) > 0:
                    data = [col.text.strip() for col in cols]
                    all_rows.append(data)

            # 5. Handle Pagination: Look for a 'Next' button
            try:
                # Common pattern for 'Next' button in these tables
                next_button = driver.find_element(By.LINK_TEXT, "Next") 
                if "disabled" in next_button.get_attribute("class"):
                    break
                
                next_button.click()
                page_num += 1
                time.sleep(2) # Politeness delay to prevent rate limiting
            except:
                print("No more pages found.")
                break

        # 6. Save to CSV for Aletia Index
        df = pd.DataFrame(all_rows)
        # Add headers based on what you see on the site (e.g., Company, Product, Reg No)
        df.to_csv("sahpra_hcr_list.csv", index=False)
        print(f"Success! {len(all_rows)} records saved to sahpra_hcr_list.csv")

    finally:
        driver.quit()

if __name__ == "__main__":
    scrape_sahpra_hcr()