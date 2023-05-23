import * as Captcha from "2captcha";
import { writeFileSync } from "fs";
import { Page } from "puppeteer";

export async function loggedInCheck(page: Page) {
  const el = await page.$("#ctl00_MenuControl_Img_Login");
  return !!el;
}

export async function loginToTrademap(page: Page, email: string) {

  await page.waitForSelector("#ctl00_MenuControl_li_marmenu_login");
  await new Promise((r) => setTimeout(r, 2000));
  await page.click("#ctl00_MenuControl_li_marmenu_login");
  await page.waitForSelector("#Username");
  await page.type("#Username", email, { delay: 50 });
  await page.type("#Password", "Abc1234@$", { delay: 50 });
  await page.click(".switch-remember");
  await page.click('[value="login"]');
  await page.waitForSelector("#div_logoLeft");

  const captchaImg = await page.$('img[alt="Captcha"]');
  if (!!captchaImg) {
    await new Promise((t) => setTimeout(t, 3000));
    const captchaBase64 = await captchaImg.screenshot({ encoding: "base64" });
    const solver = new Captcha.Solver("e88e3fc13949d9337bcf08daac99111a");
    const result = await solver.imageCaptcha(captchaBase64 as any);
    await page.type("#ctl00_PageContent_CaptchaAnswer", result.data);
    await page.click("#ctl00_PageContent_ButtonvalidateCaptcha");
    await page.waitForSelector("#ctl00_PageContent_Label_Intro");
  }
  const cookies = await page.cookies();
  const emailParts = email.split('@');
  writeFileSync(`data/cookies_${emailParts[0]}.json`, JSON.stringify(cookies), "utf-8");
}
