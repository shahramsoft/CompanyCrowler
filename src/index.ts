import { copyFileSync, existsSync, renameSync, rmSync } from "fs";
import { Browser, launch, Page } from "puppeteer-core";
import { loggedInCheck, loginToTrademap } from "./login";
import { getJson } from "./utils/get_json";
import { join } from 'path';

const resultPath = join("C:/", 'results');

_launch();

async function _launch() {
  const browser: Browser = await launch({
    executablePath:
      `C:/Program Files/Google/Chrome/Application/chrome.exe`,
    headless: false,
  });
  try {
    await run(browser);
  } catch {
    if (browser.isConnected()) {
      await browser.close();
    }
    
    if (existsSync('data/cookies.json')) {
      rmSync('data/cookies.json');
    }

    _launch();
  }
}

async function run(browser: Browser) {
  // Prepare browser page
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 720 });

  const client = await page.target().createCDPSession();

  await client.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: resultPath,
  });

  if (existsSync("data/cookies.json"))
    await page.setCookie(...getJson("data/cookies.json"));
  await page.goto("https://www.trademap.org", { waitUntil: "networkidle2" });

  // Check user login and relogin if needs
  if (await loggedInCheck(page)) {
    await loginToTrademap(page);
  }

  await page.goto(
    `https://www.trademap.org/CorrespondingProductsCompanies.aspx?nvpm=1|||||01|||2|1|1|1|3|1|2|1|1|4`,
    { waitUntil: "networkidle2" }
  );

  const hscodes: string[] = getJson("data/hscode.json");
  const _2Digits = hscodes.filter((c) => c.length === 2);
  // const _4Digits = (_: string) =>
  //   hscodes.filter((c) => c.length === 4 && c.startsWith(_));
  // const _6Digits = (_: string) =>
  //   hscodes.filter((c) => c.length === 6 && c.startsWith(_));

  await _selectImportCriteria(page);
  await _300PerPageCategory(page);
  for (let h2 of _2Digits) {
    await page.select("#ctl00_NavigationControl_DropDownList_Product", h2);
    await page.waitForSelector("#ctl00_Label_SubTitle");
    await page.waitForTimeout(3000);

    const catSelectors = await page.$$eval(
      "#ctl00_PageContent_MyGridView1 tbody tr td a",
      (t) => t.map((a: any) => [a.id, a.innerText.trim()])
    );

    for (let [cat, cat_name] of catSelectors) {
      const filename = cat_name.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 235);
      if (existsSync(join(resultPath, `${h2}_${filename}.txt`))) continue;

      await page.click(`#${cat}`);
      await page.waitForSelector("#ctl00_Label_SubTitle");
      await page.click(
        `#ctl00_PageContent_GridViewPanelControl_ImageButton_Text`
      );

      await page.select(
        "#ctl00_NavigationControl_DropDownList_Product",
        "TOTAL"
      );
      await page.waitForSelector("#ctl00_Label_SubTitle");
      await page.waitForTimeout(3000);

      await page.select("#ctl00_NavigationControl_DropDownList_Product", h2);
      await page.waitForSelector("#ctl00_Label_SubTitle");
      await page.waitForTimeout(3000);

      await _300PerPageCategory(page);
      renameSync(
        join(resultPath, `Trade_Map_-_List_of_importing_companies_for_the_following_product.txt`),
        join(resultPath, `${h2}_${filename}.txt`)
      );
      await page.waitForTimeout(3000);
    }
  }
}

async function _selectImportCriteria(page: Page) {
  await page.select("#ctl00_NavigationControl_DropDownList_TradeType", "I");
  await page.waitForSelector("#ctl00_Label_SubTitle");
}

async function _300PerPageCategory(page: Page) {
  await page.select(
    "#ctl00_PageContent_GridViewPanelControl_DropDownList_PageSize",
    "300"
  );
  await page.waitForSelector("#ctl00_Label_SubTitle");
}
