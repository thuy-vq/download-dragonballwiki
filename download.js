const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- CẤU HÌNH ---
const BASE_URL = 'https://dragonballwiki.net/doctruyen/dragon-ball-goc/chap-';
const START_CHAP = 306;
const END_CHAP = 520;
const OUTPUT_DIR = './DragonBall_Manga';
const CONCURRENT_LIMIT = 14; // Tải cùng lúc 10 ảnh (tăng tốc độ)

// Hàm tải 1 ảnh (trả về Promise)
async function downloadImage(url, folderPath, index) {
    try {
        const ext = path.extname(url) || '.jpg';
        const fileName = `${index.toString().padStart(3, '0')}${ext}`;
        const filePath = path.resolve(folderPath, fileName);

        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            timeout: 10000 // Timeout 10s để tránh treo
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(fileName));
            writer.on('error', reject);
        });
    } catch (e) {
        console.error(`\n❌ Lỗi tải ảnh ${index}: ${e.message}`);
        return null; // Trả về null để không crash luồng
    }
}

// Hàm cuộn trang siêu tốc
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 200; // Tăng khoảng cách cuộn để nhanh hơn
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                // Dừng khi cuộn hết trang
                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 20); // Giảm thời gian chờ giữa các lần cuộn (20ms)
        });
    });
}

(async () => {
    console.log('🚀 Đang khởi động Browser (Chế độ ẩn)...');
    
    // Bật chế độ Headless 'new' để chạy ngầm nhanh hơn
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    // Tối ưu: Chặn request không cần thiết (CSS, Font, Media khác) để load trang nhanh
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['font', 'stylesheet', 'media'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    for (let chap = START_CHAP; chap <= END_CHAP; chap++) {
        const url = `${BASE_URL}${chap}.html`;
        console.log(`\n----------------------------------------`);
        console.log(`📖 Đang xử lý Chap ${chap}: ${url}`);

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); // Đổi sang domcontentloaded cho nhanh
            
            process.stdout.write('⏳ Đang cuộn trang để load ảnh... ');
            await autoScroll(page);
            console.log('Xong.');

            // Lấy link ảnh
            const imgUrls = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('.chapter-content img')).map(img => img.src);
            });

            if (imgUrls.length === 0) {
                console.log(`⚠️  Chap ${chap} không có ảnh hoặc lỗi load.`);
                continue;
            }

            console.log(`📥 Tìm thấy ${imgUrls.length} ảnh. Bắt đầu tải...`);

            // Tạo thư mục
            const chapFolder = path.join(OUTPUT_DIR, `Chap_${chap}`);
            if (!fs.existsSync(chapFolder)) fs.mkdirSync(chapFolder, { recursive: true });

            // --- XỬ LÝ TẢI SONG SONG (Batching) ---
            // Chia nhỏ danh sách ảnh thành các nhóm (chunk) để tải
            for (let i = 0; i < imgUrls.length; i += CONCURRENT_LIMIT) {
                const chunk = imgUrls.slice(i, i + CONCURRENT_LIMIT);
                
                // Tạo mảng các Promise tải ảnh
                const downloadTasks = chunk.map((url, k) => {
                    const realIndex = i + k + 1;
                    return downloadImage(url, chapFolder, realIndex);
                });

                // Chờ cả nhóm tải xong mới sang nhóm tiếp theo (Promise.all)
                await Promise.all(downloadTasks);
                
                const percent = Math.min(100, Math.round(((i + chunk.length) / imgUrls.length) * 100));
                process.stdout.write(`    ↳ Đã tải: ${i + chunk.length}/${imgUrls.length} (${percent}%)\r`);
            }
            
            console.log(`\n✅ Hoàn thành Chap ${chap}`);

        } catch (error) {
            console.error(`\n❌ Lỗi Critical Chap ${chap}:`, error.message);
        }
    }

    console.log('\n🎉 ĐÃ TẢI XONG TOÀN BỘ!');
    await browser.close();
})();