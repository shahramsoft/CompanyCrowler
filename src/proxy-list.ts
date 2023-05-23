import { appendFileSync, writeFileSync } from 'fs';
import { launch } from 'puppeteer';
(async () => {
    const browser = await launch({ headless: false, args: ['--proxy-server=socks5://127.0.0.1:9090'] });
    const page = await browser.newPage();
    await page.goto('https://proxyhub.me/en/ir-http-proxy-list.html', { waitUntil: 'networkidle2' });

    while (true) {
        const trList = await page.$$('table tr');
        trList.splice(0, 1);
        const tdList = await Promise.all(trList.map(tr => tr.$$eval('td', (el: any) => el.map((e: any) => e.innerText.trim()))));
        const proxies = tdList.map(item => `${item[0]}:${item[1]}`);
        appendFileSync('data/proxies.txt', proxies.join('\n') + '\n');

        const pageNext = await (await (await page.$('.fa-angle-right'))?.getProperty('parentNode'))?.getProperty('parentNode');
        const pageNextClassesElement = await pageNext?.getProperty('className');
        const pageNextClasses = await pageNextClassesElement?.jsonValue() as string | undefined;

        if (pageNextClasses?.includes('disabled')) break;
        await page.click('.fa-angle-right');
        await page.waitForTimeout(10000)
    }


})()