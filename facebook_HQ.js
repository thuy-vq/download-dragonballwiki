(async () => {
    console.log("--- CHẾ ĐỘ TẢI TỰ ĐỘNG (THEATER MODE) ---");
    console.log("⚠️ HƯỚNG DẪN: Hãy mở ảnh đầu tiên trong Album lên (để hiện màn hình đen xem ảnh) trước khi chạy hoặc trong 5 giây tới.");
    
    // --- CẤU HÌNH ---
    const CONFIG = {
        waitLoadTime: 2500,     // Thời gian chờ ảnh load sau khi bấm Next (ms)
        fetchTimeout: 180000,   // Thời gian chờ tải ảnh tối đa (3 phút)
        prefix: 'FB_Album_'     // Tên file
    };

    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    // Đếm ngược 5 giây để người dùng kịp mở ảnh nếu chưa mở
    for (let i = 5; i > 0; i--) {
        console.log(`Bắt đầu sau ${i}s... (Hãy đảm bảo bạn đang mở ảnh ở chế độ xem lớn)`);
        await wait(1000);
    }

    let downloadedUrls = new Set(); // Lưu các link đã tải để check trùng
    let count = 0;

    // Hàm tìm ảnh chính đang hiển thị (Logic: Ảnh to nhất trên màn hình là ảnh chính)
    const findMainImage = () => {
        const images = Array.from(document.querySelectorAll('img'));
        if (images.length === 0) return null;

        // Sắp xếp các ảnh theo diện tích (Rộng x Cao) giảm dần
        const sortedByArea = images.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            return (rectB.width * rectB.height) - (rectA.width * rectA.height);
        });

        // Trả về ảnh lớn nhất (chính là ảnh đang xem)
        return sortedByArea[0];
    };

    // Hàm tải ảnh với Timeout 3 phút
    const downloadImage = async (url, filename) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.fetchTimeout);

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId); // Xóa timeout nếu tải xong trước hạn

            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);
            return true;
        } catch (e) {
            if (e.name === 'AbortError') {
                console.error(`Lỗi tải ${filename}: Quá thời gian chờ (Timeout 3 phút)`);
            } else {
                console.error(`Lỗi tải ${filename}:`, e);
            }
            return false;
        } finally {
            clearTimeout(timeoutId);
        }
    };

    // VÒNG LẶP CHÍNH
    while (true) {
        // 1. Tìm ảnh hiện tại
        const imgNode = findMainImage();

        if (!imgNode) {
            console.error("Không tìm thấy ảnh! Có thể bạn chưa mở ảnh lên hoặc đã tắt chế độ xem.");
            break;
        }

        const src = imgNode.src;

        // 2. Kiểm tra điều kiện dừng
        // Nếu link này đã có trong danh sách đã tải -> Nghĩa là đã quay vòng lại ảnh đầu hoặc Next không hoạt động
        if (downloadedUrls.has(src)) {
            console.log("Phát hiện ảnh trùng lặp (đã tải). Có vẻ đã hết album.");
            break;
        }

        // 3. Tải ảnh
        count++;
        const fileName = `${CONFIG.prefix}${(count).toString().padStart(3, '0')}.jpg`;
        console.log(`[${count}] Đang tải: ...${src.slice(-20)}`);
        
        await downloadImage(src, fileName);
        downloadedUrls.add(src); // Đánh dấu đã tải

        // 4. Bấm Next (Mô phỏng phím Mũi tên phải)
        // Cách này ổn định hơn tìm nút bấm vì Facebook hay đổi class nút
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            code: 'ArrowRight',
            keyCode: 39,
            which: 39,
            bubbles: true
        }));

        // 5. Chờ ảnh mới load
        await wait(CONFIG.waitLoadTime);

        // Kiểm tra kỹ: Nếu sau khi chờ mà src vẫn y hệt ảnh cũ -> Thử chờ thêm chút nữa
        const nextImgNode = findMainImage();
        if (nextImgNode && nextImgNode.src === src) {
            console.log("Ảnh chưa chuyển, chờ thêm 2 giây...");
            await wait(2000);
            
            // Check lại lần cuối, nếu vẫn không đổi thì dừng
            const retryImgNode = findMainImage();
            if (retryImgNode && retryImgNode.src === src) {
                console.log("Đã hết ảnh (không thể Next được nữa). Kết thúc.");
                break;
            }
        }
    }

    console.log("--- HOÀN TẤT ---");
    alert(`Đã tải xong ${count} ảnh!`);
})();