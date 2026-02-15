const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- CẤU HÌNH ---
// Link mẫu: https://dilib.vn/truyen-tranh/doa-nhan-7116-chap-1.html
// BASE_URL là phần trước số chương
const BASE_URL = 'https://dilib.vn/truyen-tranh/hau-7-vien-ngoc-rong-dragon-ball-after-14804-chap-';

const START_CHAP = 1;           // Chap bắt đầu
const END_CHAP = 30;            // Chap kết thúc
const OUTPUT_DIR = './Dragonball_After_Dilib';

// Các đuôi mở rộng cần thử (Dilib thường dùng: chap-1.html, đôi khi có chap-1-5.html)
const TRY_SUFFIXES = ['']; 

const CONCURRENT_LIMIT = 10;    // Số ảnh tải song song
const IMG_RETRY_LIMIT = 3;      // Thử lại ảnh nếu lỗi
const CHAP_TIMEOUT_MS = 60000;  // 60s timeout cho 1 chap
const MAX_CHAP_RETRIES = 3;     // Thử lại chap nếu lỗi

// --- CÁC SELECTOR (Chuẩn Dilib) ---
const CONTENT_WRAPPER = '.container .row #primary';
// Dilib thường để ảnh trong .page-chapter img hoặc trực tiếp trong .reading-detail img
const IMG_SELECTOR = 'img.border[width="100%"]'; 

// --- UTILS ---
function log(msg) {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    console.log(`[${time}] ${msg}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- LOGIC TẢI ẢNH ---
async function downloadImage(url, folderPath, index, refererUrl) {
    // Lọc link rác, icon, loading...
    if (!url || url.includes('loading') || url.startsWith('data:')) return true;
    
    // Xử lý protocol-less URL (//domain.com...)
    if (url.startsWith('//')) url = 'https:' + url;

    const cleanUrl = url.trim();
    // Lấy đuôi file
    let ext = path.extname(cleanUrl.split('?')[0]) || '.jpg';
    if (!['.jpg', '.png', '.jpeg', '.webp'].includes(ext)) ext = '.jpg';
    
    const fileName = `${index.toString().padStart(3, '0')}${ext}`;
    const filePath = path.resolve(folderPath, fileName);

    for (let attempt = 1; attempt <= IMG_RETRY_LIMIT; attempt++) {
        try {
            const response = await axios({
                url: cleanUrl, 
                method: 'GET', 
                responseType: 'stream', 
                timeout: 20000,
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': refererUrl // Quan trọng để tránh lỗi 403
                } 
            });

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return await new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(true));
                writer.on('error', reject);
            });
        } catch (e) {
            if (attempt === IMG_RETRY_LIMIT) {
                log(`❌ Bỏ qua ảnh ${index}: ${e.message}`);
                return false;
            }
            await sleep(1500); 
        }
    }
}

// --- AUTO SCROLL ---
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 300; 
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

// --- XỬ LÝ 1 CHAPTER ---
async function processOneChapter(page, currentUrl, folderName) {
    log(`📖 Đang thử: ${currentUrl}`);
    
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const finalUrl = page.url();
    // Check Redirect: Dilib thường redirect về trang truyện chính nếu chap lỗi
    if (!finalUrl.includes('chap-')) {
        throw new Error('REDIRECT_HOME'); 
    }

    // Đợi khung truyện load
    try {
        await page.waitForSelector(CONTENT_WRAPPER, { timeout: 15000 });
    } catch (e) {
        throw new Error('NO_CONTENT_TIMEOUT (Có thể do mạng hoặc sai Selector)');
    }

    // Cuộn trang
    await autoScroll(page);

    sleep(8000); // Đợi ảnh load thêm
    
    // Quét link ảnh: Ưu tiên data-original/data-src (Lazyload)
    const imgUrls = await page.evaluate((selector) => {
        const images = document.querySelectorAll(selector);
        return Array.from(images).map(img => {
            return img.getAttribute('data-original') || img.getAttribute('data-src') || img.src;
        }).filter(src => src && !src.startsWith('data:')); 
    }, IMG_SELECTOR);

    if (imgUrls.length === 0) throw new Error("Không tìm thấy ảnh nào!");

    log(`   📥 Tìm thấy ${imgUrls.length} ảnh. Lưu vào "${folderName}"...`);

    const fullFolderPath = path.join(OUTPUT_DIR, folderName);
    if (!fs.existsSync(fullFolderPath)) fs.mkdirSync(fullFolderPath, { recursive: true });

    // Tải song song
    for (let i = 0; i < imgUrls.length; i += CONCURRENT_LIMIT) {
        const chunk = imgUrls.slice(i, i + CONCURRENT_LIMIT);
        const tasks = chunk.map((url, k) => downloadImage(url, fullFolderPath, i + k + 1, currentUrl));
        await Promise.all(tasks);
    }

    log(`✅ Xong chap: ${folderName}`);
    return true;
}

// --- MAIN LOOP ---
(async () => {
    log('🚀 Khởi động Dilib Downloader...');
    
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1366,768'
        ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Chặn quảng cáo
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        const url = req.url();
        if (['font', 'media'].includes(type) || url.includes('google') || url.includes('facebook') || url.includes('analytics')) {
            req.abort();
        } else {
            req.continue();
        }
    });

    for (let i = START_CHAP; i <= END_CHAP; i++) {
        for (const suffix of TRY_SUFFIXES) {
            const chapNum = i.toString();
            // Dilib: chap-1.html, chap-1-5.html
            const slug = `${chapNum}${suffix}.html`; 
            
            // Folder name: Chap_001, Chap_001_5
            let folderName = `Chap_${chapNum.padStart(3, '0')}`;
            if (suffix) folderName += suffix.replace('-', '_');

            const currentUrl = `${BASE_URL}${slug}`;
            let success = false;
            let skipRetry = false; 

            for (let attempt = 1; attempt <= MAX_CHAP_RETRIES; attempt++) {
                try {
                    await Promise.race([
                        processOneChapter(page, currentUrl, folderName),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), CHAP_TIMEOUT_MS))
                    ]);

                    success = true;
                    break; 

                } catch (error) {
                    if (error.message === 'REDIRECT_HOME') {
                        skipRetry = true;
                        break; 
                    }
                    
                    log(`⚠️  Lỗi "${folderName}" (Lần ${attempt}): ${error.message}`);
                    
                    if (attempt < MAX_CHAP_RETRIES) {
                        log(`   🔄 Đợi 2s...`); 
                        await sleep(2000); 
                        try { await page.reload({ waitUntil: 'domcontentloaded' }); } catch(e){}
                    } else {
                        log(`❌ BỎ QUA "${folderName}".`);
                    }
                }
            }
            
            if (skipRetry && suffix === '') {
                log(`ℹ️  Chap ${chapNum} gốc không tồn tại.`);
            }
        }
    }

    log('🏁 Đã hoàn thành.');
    await browser.close();
})();