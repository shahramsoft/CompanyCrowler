import { existsSync, rmSync } from "fs";
import { MongoClient } from "mongodb";
import { join } from 'path';
import process from "process";
import { Browser, Page } from "puppeteer";
import Puppeteer from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
import { loggedInCheck, goToLogin, loginToTrademap } from "./login";
import { convert_to_json } from "./utils/convert_to_json";
import { getJson } from "./utils/get_json";
require('dotenv').config()

enum Type { export, import }
const default_type = Type.import;
const crawler_type = process.env.CRAWLER_TYPE ? process.env.crawler_type == 'import' ? Type.import : Type.export : default_type;
console.log("Crawler Type:", crawler_type); 0
const url = process.env.MONGODB_URL || "mongodb://localhost:27017";
const mongoClient = new MongoClient(url);
const resultPath = join("C:/Users", process.env.USER || "", 'Downloads', 'results');

const db = mongoClient.db(process.env.DB_COLLECTION || "crawler");
const hscodeColl = db.collection(crawler_type == Type.export ? "hscode" : "hscode_imports");
const companyColl = db.collection(crawler_type == Type.export ? "company" : "company_imports");
const proxyColl = db.collection("proxy");

index();
async function index() {
  Puppeteer.use(Stealth());
  await mongoClient.connect();
  await _launch();
}

async function _launch() {
  let browser: Browser | undefined;

  try {
    const proxyList = await proxyColl.find({ instance: 0 }).sort({ use: 1 }).toArray();
    const proxy = proxyList[0];
    const proxyUri = proxy.address;
    await proxyColl.updateOne({ address: proxyUri }, { $inc: { use: 1 } });
    console.log("> CURRENT PROXY: ", proxyUri, ",At: ", new Date());

    browser = await Puppeteer.launch({
      executablePath:
        `C:/Users/${process.env.USER}/Chromium/chrome.exe`,
      timeout: 120000,
      headless: false,
      userDataDir: join(`C:/Users/${process.env.USER}/`, 'chrome-data'),
      args: [`--proxy-server=${proxyUri}`]
    });

    await run(browser, proxy.email);
  } catch (e) {

    console.error("!! CRASH !!", e);

    if (browser?.isConnected()) {
      await browser.close();
    }

    _launch();
  }
}

async function run(browser: Browser, email: string) {

  // Prepare browser page
  const context = await browser.createIncognitoBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  await page.setViewport({ width: 1080, height: 720 });

  const client = await page.target().createCDPSession();

  await client.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: resultPath,
  });

  const emailParts = email.split('@');
  if (existsSync(`data/cookies_${emailParts[0]}.json`))
    await page.setCookie(...getJson(`data/cookies_${emailParts[0]}.json`));
  await page.goto("https://www.trademap.org", { waitUntil: "networkidle2", timeout: 60000 });

  const popupEl = await page.$('#ctl00_MenuControl_div_Button_ClosePopupNews');
  if (!!popupEl) {
    await page.click('#ctl00_MenuControl_button1');
    await page.waitForSelector("#ctl00_PageContent_Label_Intro");
    console.log("> ====> CLOSE POPUP <====");
  }
  page.on("dialog", async dialog => {
    try {
      await dialog.accept();
    } catch (e) { }
  });
  await new Promise(r => setTimeout(r, 2000))
  // Check user login and relogin if needs
  if (await loggedInCheck(page)) {
    await goToLogin(page);
    await loginToTrademap(page, email);
    console.log("====> LOGGED IN <====");
  }

  console.log("====> PAGE OPENING <====");
  await page.goto(
    `https://www.trademap.org/CorrespondingProductsCompanies.aspx?nvpm=1|||||01|||2|1|1|1|3|1|2|1|1|4`,
    { waitUntil: "networkidle0", timeout: 60000 }
  );
  await new Promise(r => setTimeout(r, 4000))
  console.log("====> PAGE OPENED <====");

  const hscodes: string[] = getJson(`data/hscode_6digits_${process.env.INSTANCE}.json`);
  const _6Digits = hscodes.filter((c) => c.length === 6);

  console.log("====> SELECT TRADE TYPE <====");
  await _selectImportCriteria(page);
  console.log("====> TRADE TYPE SELECTED <====");

  for (let h6 of _6Digits) {
    const hscodeExists = await hscodeColl.find({ hscode: h6 }).toArray();
    if (hscodeExists.length > 0) continue;

    console.log("====> HS_CODE: " + h6);
    await select6CharHSCode(h6, page);

    console.log("====> GETTING LIST OF CATEGORIES <==== ");

    const catSelectors = await page.$$eval(
      "#ctl00_PageContent_MyGridView1 tbody tr td a",
      (t) => t.map((a: any) => [a.id, a.innerText.trim()])
    );
    console.log("====> CATEGORIES WERE LISTED, LENGTH: ", catSelectors.length)

    for (let [cat, cat_name] of catSelectors) {
      const catExists = await companyColl
        .find({ id: `${h6}_${cat_name}` })
        .toArray();
      console.log("====> Check Category: ", cat_name);
      if (catExists.length > 0) continue;

      console.log("====> CATEGORY: " + cat_name)

      await page.click(`#${cat}`);
      await page.waitForSelector("#ctl00_Label_SubTitle");

      await page.waitForSelector("#ctl00_PageContent_Label_Source");

      const sourceText = await page.$eval(
        "#ctl00_PageContent_Label_Source a",
        (e: any) => e.innerText
      );

      await new Promise(r => setTimeout(r, 2000))

      console.log("====> DOWNLOAD FILE: <====")
      await page.click(
        `#ctl00_PageContent_GridViewPanelControl_ImageButton_Text`
      );
      await new Promise(r => setTimeout(r, 10000))
      console.log("====> DOWNLOADED: <====")

      const fileName = join(
        resultPath,
        `Trade_Map_-_List_of_${crawler_type == Type.export ? 'exporting' : 'importing'}_companies_for_the_following_product.txt`
      );

      const jsonData = convert_to_json(fileName).map(data => ({
        id: `${h6}_${cat_name}`,
        hscode: h6,
        category: cat_name,
        source: sourceText,
        ...data,
      }));
      await companyColl.insertMany(jsonData);

      console.log("====> NEW ROWS ADDED - COUNT DOCUMENTS: " + jsonData.length)

      rmSync(fileName);
      console.log("====> TEMP FILE REMOVED <====")

      await new Promise(r => setTimeout(r, 3000))

      await select6CharHSCode(h6, page);
    }
    await hscodeColl.insertOne({ hscode: h6 });
    console.log("====> HS_CODE INSERTED TO CRAWLED HS_CODES <====")
  }

  await page.close();
  await browser.close();

  console.log("====> PAGE CLOSED <====")
}

async function _selectImportCriteria(page: Page) {
  await page.waitForSelector("#ctl00_NavigationControl_DIV_DropDownList_TradeType");
  await page.select("#ctl00_NavigationControl_DropDownList_TradeType", crawler_type == Type.export ? "E" : "I");
  await page.waitForSelector("#ctl00_Label_SubTitle");
}

async function _300PerPageCategory(page: Page) {
  await page.waitForSelector(
    "#ctl00_PageContent_GridViewPanelControl_DropDownList_PageSize"
  );
  await page.select(
    "#ctl00_PageContent_GridViewPanelControl_DropDownList_PageSize",
    "300"
  );
  await page.waitForSelector("#ctl00_Label_SubTitle");
}

async function select6CharHSCode(hscode: string, page: Page) {
  console.log("====> SELECT HS CODE IN PAGE <====")
  const _2Char = hscode.substring(0, 2);
  const _4Char = hscode.substring(0, 4);

  await page.select("#ctl00_NavigationControl_DropDownList_Product", _2Char);
  await page.waitForSelector("#ctl00_Label_SubTitle");
  await new Promise(r => setTimeout(r, 3000))


  await page.select("#ctl00_NavigationControl_DropDownList_Product", _4Char);
  await page.waitForSelector("#ctl00_Label_SubTitle");
  await new Promise(r => setTimeout(r, 3000))


  await page.select("#ctl00_NavigationControl_DropDownList_Product", hscode);
  await page.waitForSelector("#ctl00_Label_SubTitle");
  await new Promise(r => setTimeout(r, 3000))

  await _300PerPageCategory(page);
}
