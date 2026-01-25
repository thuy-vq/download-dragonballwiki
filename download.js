const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- CẤU HÌNH ---
// URL mẫu: https://truyenqqno.com/truyen-tranh/inu-yashiki-232-chap-1.html
const BASE_URL = 'https://truyenqqno.com/truyen-tranh/inu-yashiki-232-chap-'; 
const START_CHAP = 11;           // Bắt đầu từ chap 1
const END_CHAP = 85.1;            // Kết thúc ở chap 10
const OUTPUT_DIR = './InuYashiki_Manga';

// Các đuôi mở rộng cần thử. Ví dụ: '' (chap-1), '-1' (chap-1-1), '-5' (chap-1-5)
const TRY_SUFFIXES = ['', '-1', '-5']; 

const CONCURRENT_LIMIT = 10;    
const IMG_RETRY_LIMIT = 3;      
const CHAP_TIMEOUT_MS = 60000;  // Tăng lên 60s vì TruyenQQ đôi khi load lâu
const MAX_CHAP_RETRIES = 3;     

// --- CÁC SELECTOR (Cập nhật cho TruyenQQ) ---
// TruyenQQ thường dùng .page-chapter img hoặc .story-see-content img
const IMG_SELECTOR = '.page-chapter img, .story-see-content img'; 

// --- UTILS ---
function log(msg) {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    console.log(`[${time}] ${msg}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const sanitizeName = (name) => name.replace(/[^a-z0-9\s-_]/gi, '').trim();

// --- LOGIC TẢI ẢNH ---
async function downloadImage(url, folderPath, index, refererUrl) {
    if (url.includes('transparent') || url.includes('loading')) return true;

    const ext = path.extname(url).split('?')[0] || '.jpg';
    const fileName = `${index.toString().padStart(3, '0')}${ext}`;
    const filePath = path.resolve(folderPath, fileName);

    for (let attempt = 1; attempt <= IMG_RETRY_LIMIT; attempt++) {
        try {
            const response = await axios({
                url, 
                method: 'GET', 
                responseType: 'stream', 
                timeout: 15000,
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': refererUrl 
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
                log(`❌ Bỏ qua ảnh ${index} (${url}): ${e.message}`);
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
            const distance = 400; 
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
    
    // Tăng timeout load trang
    await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    // --- CHECK REDIRECT (QUAN TRỌNG) ---
    // Nếu URL bị đổi về trang chủ hoặc không chứa 'chap-', tức là chap không tồn tại
    const finalUrl = page.url();
    if (finalUrl === 'https://truyenqqno.com/' || !finalUrl.includes('chap-')) {
        throw new Error('REDIRECT_HOME'); // Ném lỗi đặc biệt để không retry
    }

    // 1. Auto Scroll
    await autoScroll(page);
    
    // 2. Quét link ảnh
    const imgUrls = await page.evaluate((selector) => {
        const images = document.querySelectorAll(selector);
        return Array.from(images).map(img => {
            return img.getAttribute('data-original') || img.getAttribute('data-src') || img.src;
        }).filter(src => src && !src.startsWith('data:')); 
    }, IMG_SELECTOR);

    if (imgUrls.length === 0) throw new Error("Không tìm thấy ảnh nào! (Selector sai hoặc bị chặn)");

    log(`   📥 Tìm thấy ${imgUrls.length} ảnh. Lưu vào "${folderName}"...`);

    // 3. Tạo thư mục
    const fullFolderPath = path.join(OUTPUT_DIR, folderName);
    if (!fs.existsSync(fullFolderPath)) fs.mkdirSync(fullFolderPath, { recursive: true });

    // 4. Tải Batch
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
    log('🚀 Khởi động TruyenQQ Downloader (Hỗ trợ sub-chap)...');
    
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Chặn request rác
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const type = req.resourceType();
        const url = req.url();
        if (['font', 'stylesheet', 'media'].includes(type) || url.includes('google') || url.includes('facebook')) {
            req.abort();
        } else {
            req.continue();
        }
    });

    // Vòng lặp chính qua các số Chap
    for (let i = START_CHAP; i <= END_CHAP; i++) {
        
        // Vòng lặp phụ: Thử các biến thể (chap-1, chap-1-1, chap-1-5)
        for (const suffix of TRY_SUFFIXES) {
            const chapNum = i.toString(); 
            // Tạo slug: ví dụ chap-1, chap-1-5
            const urlSlug = `chap-${chapNum}${suffix}`; 
            
            // Tạo tên folder: Chap_001, Chap_001_5
            let folderName = `Chap_${chapNum.padStart(3, '0')}`;
            if (suffix) folderName += suffix.replace('-', '_'); // Chap_001_5

            const currentUrl = `${BASE_URL.replace('chap-', '')}${urlSlug}.html`;

            let success = false;
            let skipRetry = false; // Cờ để bỏ qua retry nếu chap không tồn tại

            for (let attempt = 1; attempt <= MAX_CHAP_RETRIES; attempt++) {
                try {
                    await Promise.race([
                        processOneChapter(page, currentUrl, folderName),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), CHAP_TIMEOUT_MS))
                    ]);

                    success = true;
                    break; 

                } catch (error) {
                    // Nếu lỗi là do Redirect về Home -> Chap không tồn tại -> Dừng ngay
                    if (error.message === 'REDIRECT_HOME') {
                        // log(`   ⏭️  Bỏ qua "${urlSlug}" (Không tồn tại/Redirect Home).`);
                        skipRetry = true;
                        break; 
                    }

                    log(`⚠️  Lỗi "${folderName}" (Lần ${attempt}): ${error.message}`);
                    
                    if (attempt < MAX_CHAP_RETRIES) {
                        log(`   🔄 Reload...`);
                        try { await page.reload({ waitUntil: 'domcontentloaded' }); } catch(e){}
                    } else {
                        log(`❌ BỎ QUA "${folderName}".`);
                    }
                }
            }
            
            // Nếu chap chính (không có suffix) mà bị skipRetry -> Có thể truyện này không có chap đó
            // Nếu là chap phụ (.5) bị skipRetry -> Chuyện bình thường
            if (skipRetry && suffix === '') {
                log(`ℹ️  Chap ${chapNum} gốc không tồn tại.`);
            }
        }
    }

    log('🏁 Đã hoàn thành.');
    await browser.close();
})();