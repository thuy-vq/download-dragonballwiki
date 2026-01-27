const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- CẤU HÌNH ---
// Link gốc: https://www.acezvn.com/truyen-tranh/co-be-ba-mat-3x3-eyes-15453_chap_1
const BASE_URL = 'https://www.acezvn.com/truyen-tranh/co-be-ba-mat-3x3-eyes-15453'; 
const HOME_PAGE = 'https://www.acezvn.com/';

const START_CHAP = 2;           // Chap bắt đầu
const END_CHAP = 468;           // Chap kết thúc
const OUTPUT_DIR = './3x3Eyes_Manga';

// Các đuôi mở rộng cần thử
const TRY_SUFFIXES = ['']; 

const CONCURRENT_LIMIT = 10;    
const IMG_RETRY_LIMIT = 3;      
const CHAP_TIMEOUT_MS = 60000;  
const MAX_CHAP_RETRIES = 3;     

// --- CÁC SELECTOR (Cập nhật mới nhất - Đầy đủ hơn) ---
const CONTENT_WRAPPER = '.viewer-container, #chapter_content, .reading-detail, .box_doc, .page-chapter';
// Bao gồm cả selector cũ và mới để dự phòng
const IMG_SELECTOR = '.chapter-img, .page-chapter img, #chapter_content img, .reading-detail img, .box_doc img';  

// --- UTILS ---
function log(msg) {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    console.log(`[${time}] ${msg}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- LOGIC TẢI ẢNH (Có thêm Cookies) ---
async function downloadImage(url, folderPath, index, refererUrl, cookieString) {
    if (!url || url.includes('transparent') || url.startsWith('data:')) return true;

    const cleanUrl = url.trim();
    const ext = path.extname(cleanUrl.split('?')[0]) || '.jpg';
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
                    'Referer': refererUrl,
                    'Cookie': cookieString // <--- QUAN TRỌNG: Truyền Cookie để qua mặt bảo mật ảnh
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

// --- AUTO SCROLL & MOUSE MOVE (Giả lập hành vi người dùng) ---
async function simulateHuman(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 200; 
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                
                // Thỉnh thoảng di chuột ngẫu nhiên
                if (Math.random() > 0.7) {
                    const x = Math.floor(Math.random() * window.innerWidth);
                    const y = Math.floor(Math.random() * window.innerHeight);
                    // Tạo event giả (nếu cần) hoặc chỉ cần scroll là đủ với hầu hết site truyện
                }

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100); 
        });
    });
}

// --- XỬ LÝ 1 CHAPTER ---
async function processOneChapter(page, currentUrl, folderName) {
    log(`📖 Đang truy cập: ${currentUrl}`);
    
    await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const finalUrl = page.url();
    if (finalUrl === BASE_URL || finalUrl === HOME_PAGE || finalUrl === 'https://www.acezvn.com/') {
        throw new Error('REDIRECT_HOME'); 
    }

    try {
        await page.waitForSelector(CONTENT_WRAPPER, { timeout: 20000 });
    } catch (e) {
        if (page.url() !== currentUrl && !page.url().includes('chap')) throw new Error('REDIRECT_HOME');
        throw new Error('NO_CONTENT_TIMEOUT');
    }

    // Cuộn trang để kích hoạt Lazyload
    await simulateHuman(page);
    
    // Lấy Cookies hiện tại của Page để dùng cho việc tải ảnh
    const cookies = await page.cookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Quét link ảnh
    const imgUrls = await page.evaluate((selector) => {
        const images = document.querySelectorAll(selector);
        return Array.from(images).map(img => {
            return img.getAttribute('data-src') || img.getAttribute('src');
        }).filter(src => src && !src.startsWith('data:')); 
    }, IMG_SELECTOR);

    if (imgUrls.length === 0) throw new Error("Không tìm thấy ảnh nào!");

    log(`   📥 Tìm thấy ${imgUrls.length} ảnh. Lưu vào "${folderName}"...`);

    const fullFolderPath = path.join(OUTPUT_DIR, folderName);
    if (!fs.existsSync(fullFolderPath)) fs.mkdirSync(fullFolderPath, { recursive: true });

    for (let i = 0; i < imgUrls.length; i += CONCURRENT_LIMIT) {
        const chunk = imgUrls.slice(i, i + CONCURRENT_LIMIT);
        const tasks = chunk.map((url, k) => downloadImage(url, fullFolderPath, i + k + 1, currentUrl, cookieString));
        await Promise.all(tasks);
    }

    log(`✅ Xong chap: ${folderName}`);
    return true;
}

// --- MAIN LOOP ---
(async () => {
    log('🚀 Khởi động Acezvn Downloader (v3 - Anti-Bot Mode)...');
    
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Ẩn thông tin Bot
            '--window-size=1920,1080',
            '--disable-infobars'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Chặn request rác sau khi đã load xong trang chủ
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        const url = req.url();
        if (['font', 'media'].includes(type) || url.includes('google') || url.includes('facebook') || url.includes('ads')) {
            req.abort();
        } else {
            req.continue();
        }
    });

    for (let i = START_CHAP; i <= END_CHAP; i++) {
        for (const suffix of TRY_SUFFIXES) {
            const chapNum = i.toString();
            const slug = `_chap_${chapNum}${suffix}`; 
            
            let folderName = `Chap_${chapNum.padStart(3, '0')}`;
            if (suffix) folderName += suffix.replace('.', '_');

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
                        log(`   🔄 Đợi 5s...`); 
                        await sleep(5000); 
                        try { await page.reload({ waitUntil: 'networkidle2' }); } catch(e){}
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