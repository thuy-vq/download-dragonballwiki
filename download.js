const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- CẤU HÌNH ---
const BASE_URL = 'https://dragonballwiki.net/doctruyen/dragon-ball-goc/chap-';
const START_CHAP = 409;
const END_CHAP = 520;
const OUTPUT_DIR = './DragonBall_Manga';

const CONCURRENT_LIMIT = 14;   // Tải 10 ảnh cùng lúc
const MAX_CHAP_RETRIES = 3;    // Số lần thử lại cả Chapter nếu bị treo
const CHAP_TIMEOUT_MS = 60000; // 45 giây. (30s hơi gắt nếu mạng chậm, mình để 45s cho an toàn, bạn có thể sửa thành 30000)

// --- HÀM HELPER ---

// Hàm log có thời gian
function log(message) {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    console.log(`[${time}] ${message}`);
}

// Hàm sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Hàm tải 1 ảnh (giữ nguyên logic cũ nhưng gọn hơn)
async function downloadImage(url, folderPath, index) {
    try {
        const ext = path.extname(url) || '.jpg';
        const fileName = `${index.toString().padStart(3, '0')}${ext}`;
        const filePath = path.resolve(folderPath, fileName);

        const response = await axios({
            url, method: 'GET', responseType: 'stream', timeout: 10000
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(fileName));
            writer.on('error', reject);
        });
    } catch (e) {
        return null; // Lỗi ảnh thì bỏ qua luôn để không ảnh hưởng luồng chính
    }
}

// Hàm cuộn trang
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 300; // Cuộn mạnh hơn
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 50);
        });
    });
}

// --- LOGIC XỬ LÝ 1 CHAPTER ---
async function processChapter(page, chap) {
    const url = `${BASE_URL}${chap}.html`;
    log(`📖 Bắt đầu Chap ${chap}: ${url}`);

    // 1. Vào trang
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    
    // 2. Cuộn
    // log(`⏳ Đang cuộn trang...`);
    await autoScroll(page);

    // 3. Lấy link
    const imgUrls = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.chapter-content img')).map(img => img.src);
    });

    if (imgUrls.length === 0) throw new Error("Không tìm thấy ảnh nào!");

    log(`📥 Tìm thấy ${imgUrls.length} ảnh. Đang tải...`);

    // 4. Tạo folder
    const chapFolder = path.join(OUTPUT_DIR, `Chap_${chap}`);
    if (!fs.existsSync(chapFolder)) fs.mkdirSync(chapFolder, { recursive: true });

    // 5. Tải ảnh (Batching)
    for (let i = 0; i < imgUrls.length; i += CONCURRENT_LIMIT) {
        const chunk = imgUrls.slice(i, i + CONCURRENT_LIMIT);
        const tasks = chunk.map((u, k) => downloadImage(u, chapFolder, i + k + 1));
        await Promise.all(tasks);
    }
    
    return true; // Thành công
}

// --- LOGIC CHÍNH ---
(async () => {
    log('🚀 Khởi động (Auto Timeout Mode)...');
    
    const browser = await puppeteer.launch({ headless: "new" }); // Headless mới
    const page = await browser.newPage();

    // Chặn request rác tối đa
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        if (['font', 'stylesheet', 'media', 'image'].includes(type) && !req.url().includes('imgbox')) {
            // Chặn image rác, chỉ cho phép image từ host truyện (thường mình chặn hết image lúc load trang HTML để nhanh, chỉ tải image lúc axios gọi)
            // Tuy nhiên để an toàn, chỉ chặn font/css
             if (type !== 'image') req.abort();
             else req.continue();
        } else {
            req.continue();
        }
    });

    for (let chap = START_CHAP; chap <= END_CHAP; chap++) {
        let success = false;

        // Vòng lặp Retry cho cả Chapter
        for (let attempt = 1; attempt <= MAX_CHAP_RETRIES; attempt++) {
            try {
                // Đua (Race) giữa logic tải và đồng hồ đếm ngược
                // Nếu processChapter chạy lâu hơn CHAP_TIMEOUT_MS -> văng lỗi Timeout
                await Promise.race([
                    processChapter(page, chap),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), CHAP_TIMEOUT_MS))
                ]);

                success = true;
                log(`✅ Hoàn thành Chap ${chap}`);
                break; // Xong thì thoát vòng lặp retry

            } catch (error) {
                log(`⚠️  Lỗi Chap ${chap} (Lần ${attempt}/${MAX_CHAP_RETRIES}): ${error.message}`);
                
                if (attempt < MAX_CHAP_RETRIES) {
                    log(`🔄 Đang reload và thử lại sau 2s...`);
                    await sleep(2000); // Nghỉ chút rồi thử lại
                    try { await page.reload(); } catch(e){} // Cố gắng reload
                } else {
                    log(`❌ FAILED Chap ${chap}: Bỏ qua sau 3 lần thử.`);
                }
            }
        }
    }

    log('🎉 ĐÃ XONG TOÀN BỘ!');
    await browser.close();
})();