const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- CẤU HÌNH ---
// URL gốc của truyện (không bao gồm phần chap)
// Ví dụ Oneshot: https://gantzvn.com/truyen/ten-truyen-oneshot/
const BASE_URL = 'https://gantzvn.com/truyen/gantz-full-color/'; 

// --- CHẾ ĐỘ 1: TẢI THEO DANH SÁCH TÊN CỤ THỂ (Dùng cho Oneshot, Chap đặc biệt) ---
// Điền các đuôi URL vào đây. Nếu mảng này CÓ dữ liệu, tool sẽ chạy theo list này và BỎ QUA chế độ lặp số.
// Ví dụ: ['oneshot', 'chap-0', 'chap-dac-biet'] -> Tải .../oneshot/, .../chap-0/
const CUSTOM_SLUGS = []; 

// --- CHẾ ĐỘ 2: TẢI THEO SỐ THỨ TỰ (Chạy khi CUSTOM_SLUGS rỗng) ---
const START_CHAP = 1;         
const END_CHAP = 1;           

// Các đuôi mở rộng cần thử cho chap lẻ (Chỉ dùng cho Chế độ 2)
const TRY_SUFFIXES = ['']; 

// --- CẤU HÌNH CHUNG ---
const OUTPUT_DIR = './gantzvn_Manga';
const CONCURRENT_LIMIT = 10;    
const IMG_RETRY_LIMIT = 3;      
const CHAP_TIMEOUT_MS = 60000;  
const MAX_CHAP_RETRIES = 3;     

// --- CÁC SELECTOR (GantzVN) ---
const IMG_SELECTOR = '.wp-manga-chapter-img'; 

// --- UTILS ---
function log(msg) {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    console.log(`[${time}] ${msg}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- LOGIC TẢI ẢNH ---
async function downloadImage(url, folderPath, index, refererUrl) {
    if (url.includes('transparent') || url.includes('loading') || url.startsWith('data:')) return true;

    const cleanUrl = url.split('?')[0];
    const ext = path.extname(cleanUrl) || '.jpg';
    const fileName = `${index.toString().padStart(3, '0')}${ext}`;
    const filePath = path.resolve(folderPath, fileName);

    for (let attempt = 1; attempt <= IMG_RETRY_LIMIT; attempt++) {
        try {
            const response = await axios({
                url: url, 
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
async function processOneChapter(page, currentUrl, folderName, expectedSlug) {
    log(`📖 Đang thử: ${currentUrl}`);
    
    await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // --- CHECK REDIRECT ---
    // Kiểm tra xem URL hiện tại có chứa slug mong muốn không
    // Ví dụ: Đang tải 'oneshot' mà bị redirect về trang chủ -> Lỗi
    const finalUrl = page.url();
    // Logic check lỏng hơn: Chỉ cần URL không phải trang chủ và chứa 1 phần của slug
    if (finalUrl === BASE_URL || (!finalUrl.includes(expectedSlug) && !finalUrl.includes('chap-'))) {
        throw new Error('REDIRECT_HOME'); 
    }

    await autoScroll(page);
    
    const imgUrls = await page.evaluate((selector) => {
        const images = document.querySelectorAll(selector);
        return Array.from(images).map(img => {
            return img.getAttribute('data-src') || img.getAttribute('data-original') || img.src;
        }).filter(src => src && !src.startsWith('data:')); 
    }, IMG_SELECTOR);

    if (imgUrls.length === 0) throw new Error("Không tìm thấy ảnh nào! (Selector sai hoặc bị chặn)");

    log(`   📥 Tìm thấy ${imgUrls.length} ảnh. Lưu vào "${folderName}"...`);

    const fullFolderPath = path.join(OUTPUT_DIR, folderName);
    if (!fs.existsSync(fullFolderPath)) fs.mkdirSync(fullFolderPath, { recursive: true });

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
    log('🚀 Khởi động Downloader...');
    
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

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

    // --- XÁC ĐỊNH DANH SÁCH CẦN TẢI ---
    let downloadQueue = [];

    if (CUSTOM_SLUGS.length > 0) {
        log(`ℹ️  Phát hiện CUSTOM_SLUGS. Chuyển sang chế độ tải Danh Sách (Oneshot/Custom).`);
        // Tạo queue từ danh sách custom
        downloadQueue = CUSTOM_SLUGS.map(slug => ({
            slug: slug,
            url: `${BASE_URL}${slug}/`,
            folderName: `Chapter_${slug}`
        }));
    } else {
        log(`ℹ️  CUSTOM_SLUGS rỗng. Chuyển sang chế độ tải Số Thứ Tự (Chap ${START_CHAP} -> ${END_CHAP}).`);
        // Tạo queue từ vòng lặp số
        for (let i = START_CHAP; i <= END_CHAP; i++) {
            for (const suffix of TRY_SUFFIXES) {
                // UPDATE: Logic cho chap < 10 (1 -> 01, 10 -> 10)
                const chapNumUrl = i.toString().padStart(2, '0');
                const slug = `chap-${chapNumUrl}${suffix}`;
                
                // Folder name vẫn giữ padding 3 số: Chap_001
                let folderName = `Chap_${i.toString().padStart(3, '0')}`;
                if (suffix) folderName += suffix.replace('-', '_');
                
                downloadQueue.push({
                    slug: slug,
                    url: `${BASE_URL}${slug}/`,
                    folderName: folderName
                });
            }
        }
    }

    // --- BẮT ĐẦU TẢI THEO QUEUE ---
    for (const item of downloadQueue) {
        const { slug, url, folderName } = item;
        let success = false;
        let skipRetry = false;

        for (let attempt = 1; attempt <= MAX_CHAP_RETRIES; attempt++) {
            try {
                await Promise.race([
                    processOneChapter(page, url, folderName, slug),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), CHAP_TIMEOUT_MS))
                ]);
                success = true;
                break;
            } catch (error) {
                if (error.message === 'REDIRECT_HOME') {
                    // Nếu là chế độ Custom List mà bị Redirect Home thì vẫn báo lỗi, vì người dùng đã nhập sai tên
                    if (CUSTOM_SLUGS.length > 0) log(`⚠️  Link "${slug}" không tồn tại (Redirect về Home).`);
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
        
        // Logic thông báo khi chap không tồn tại
        if (skipRetry && CUSTOM_SLUGS.length === 0 && !slug.includes('-')) {
            // Chỉ log nếu đang ở chế độ loop số và không phải chap phụ (.5)
             log(`ℹ️  Chap ${slug} không tồn tại.`);
        }
    }

    log('🏁 Đã hoàn thành.');
    await browser.close();
})();