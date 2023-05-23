import { existsSync, rmSync } from "fs";
import { MongoClient } from "mongodb";
import { join } from 'path';
import process from "process";
import { Browser, Page } from "puppeteer";
import Puppeteer from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
import { loggedInCheck, loginToTrademap } from "./login";
import { convert_to_json } from "./utils/convert_to_json";
import { getJson } from "./utils/get_json";

enum Type { export, import }
const default_type = Type.import;
const crawler_type = process.env.crawler_type ? process.env.crawler_type == 'import' ? Type.import : Type.export : default_type;
console.log("Crawler Type:", crawler_type);

const url = "mongodb://localhost:27017";
const mongoClient = new MongoClient(url);
const resultPath = join("C:/", 'results');

const db = mongoClient.db("crawler");
const hscodeColl = db.collection(crawler_type == Type.export ? "hscode" : "hscode_imports");
// const hscodeColl = db.collection(crawler_type == Type.export ? "hscode_exports" : "hscode_imports");
const companyColl = db.collection(crawler_type == Type.export ? "company" : "company_imports");
// const companyColl = db.collection(crawler_type == Type.export ? "company_exports" : "company_imports");
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
    const proxyList = await proxyColl.find().sort({ use: 1 }).toArray();
    const proxy = proxyList[0];
    const proxyUri = proxy.address;
    await proxyColl.updateOne({ address: proxyUri }, { $inc: { use: 1 } });
    console.log("> CURRENT PROXY: ", proxyUri, ",At: ", new Date());

    browser = await Puppeteer.launch({
      executablePath:
        `C:/Program Files/Google/Chrome/Application/chrome.exe`,
      timeout: 120000,
      headless: false,
      userDataDir: join('C:/', 'chrome-data'),
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
  }

  // Check user login and relogin if needs
  if (await loggedInCheck(page)) {
    await loginToTrademap(page, email);
  }

  await page.goto(
    `https://www.trademap.org/CorrespondingProductsCompanies.aspx?nvpm=1|||||01|||2|1|1|1|3|1|2|1|1|4`,
    { waitUntil: "networkidle2" }
  );

  const hscodes: string[] = getJson("data/hscode.json");
  const _6Digits = hscodes.filter((c) => c.length === 6);

  await _selectImportCriteria(page);

  for (let h6 of _6Digits) {
    const hscodeExists = await hscodeColl.find({ hscode: h6 }).toArray();
    if (hscodeExists.length > 0) continue;

    await select6CharHSCode(h6, page);

    const catSelectors = await page.$$eval(
      "#ctl00_PageContent_MyGridView1 tbody tr td a",
      (t) => t.map((a: any) => [a.id, a.innerText.trim()])
    );

    for (let [cat, cat_name] of catSelectors) {
      const catExists = await companyColl
        .find({ id: `${h6}_${cat_name}` })
        .toArray();
      if (catExists.length > 0) continue;

      await page.click(`#${cat}`);
      await page.waitForSelector("#ctl00_Label_SubTitle");
      await page.click(
        `#ctl00_PageContent_GridViewPanelControl_ImageButton_Text`
      );

      const sourceText = await page.$eval(
        "#ctl00_PageContent_Label_Source a",
        (e: any) => e.innerText
      );

      await page.waitForTimeout(10000);

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

      rmSync(fileName);
      await page.waitForTimeout(3000);
      await select6CharHSCode(h6, page);
    }
    await hscodeColl.insertOne({ hscode: h6 });
  }

  await page.close();
}

async function _selectImportCriteria(page: Page) {
  await page.select("#ctl00_NavigationControl_DropDownList_TradeType", crawler_type == Type.export ? "E" : "I");
  await page.waitForSelector("#ctl00_Label_SubTitle");
}

async function _300PerPageCategory(page: Page) {
  await page.select(
    "#ctl00_PageContent_GridViewPanelControl_DropDownList_PageSize",
    "300"
  );
  await page.waitForSelector("#ctl00_Label_SubTitle");
}

async function select6CharHSCode(hscode: string, page: Page) {
  const _2Char = hscode.substring(0, 2);
  const _4Char = hscode.substring(0, 4);

  await page.select("#ctl00_NavigationControl_DropDownList_Product", _2Char);
  await page.waitForSelector("#ctl00_Label_SubTitle");
  await page.waitForTimeout(3000);

  await page.select("#ctl00_NavigationControl_DropDownList_Product", _4Char);
  await page.waitForSelector("#ctl00_Label_SubTitle");
  await page.waitForTimeout(3000);

  await page.select("#ctl00_NavigationControl_DropDownList_Product", hscode);
  await page.waitForSelector("#ctl00_Label_SubTitle");
  await page.waitForTimeout(3000);
  await _300PerPageCategory(page);
}
