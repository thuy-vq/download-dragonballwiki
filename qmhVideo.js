(() => {
    // 1. Lọc tất cả video (từ thẻ source) và ảnh (từ thẻ img) trước khi trang bị xóa
    const videoSources = document.querySelectorAll('video source[type="video/mp4"]');
    const images = document.querySelectorAll('img');

    const videoUrls = [...new Set(Array.from(videoSources).map(s => s.src))];
    const imageUrls = [...new Set(Array.from(images).map(i => i.src))];

    // --- BƯỚC MỚI: TRIỆT TIÊU POP-UP & AD SCRIPTS ---
    
    // Vô hiệu hóa hàm mở tab của trình duyệt (mã độc quảng cáo rất hay dùng)
    window.open = function() { 
        console.log("🛡️ Đã chặn một popup quảng cáo ẩn!"); 
        return null; 
    };

    // Xóa sạch các thẻ iframe, script cũ còn vương vãi
    document.querySelectorAll('iframe, script').forEach(el => el.remove());

    // Thay máu toàn bộ thẻ <body> để diệt các sự kiện click ngầm (clickjacking)
    const newBody = document.createElement('body');
    document.body.replaceWith(newBody);

    // --- THIẾT LẬP LẠI GIAO DIỆN SẠCH ---
    
    document.body.style.backgroundColor = '#121212';
    document.body.style.color = '#ffffff';
    document.body.style.padding = '20px';
    document.body.style.fontFamily = 'sans-serif';

    const container = document.createElement('div');
    container.style.maxWidth = '640px';
    container.style.margin = '0 auto';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '30px';

    // Khóa mọi sự kiện click lan truyền ra ngoài container này
    container.addEventListener('click', (e) => e.stopPropagation());

    // Hàm tạo khung chứa media và nút Download
    const createMediaBox = (url, type, index) => {
        const box = document.createElement('div');
        box.style.background = '#222';
        box.style.padding = '15px';
        box.style.borderRadius = '8px';
        box.style.textAlign = 'center';

        if (type === 'video') {
            const video = document.createElement('video');
            video.src = url;
            video.controls = true;
            video.style.maxWidth = '100%';
            video.style.borderRadius = '4px';
            box.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = url;
            img.style.maxWidth = '100%';
            img.style.borderRadius = '4px';
            box.appendChild(img);
        }

        const btn = document.createElement('a');
        btn.href = url;
        btn.target = '_blank';
        btn.download = `${type}_${index + 1}`;
        btn.textContent = `⬇️ Tải ${type === 'video' ? 'Video' : 'Ảnh'} ${index + 1}`;
        btn.style.display = 'inline-block';
        btn.style.marginTop = '15px';
        btn.style.padding = '12px 24px';
        btn.style.background = '#e50914';
        btn.style.color = '#fff';
        btn.style.textDecoration = 'none';
        btn.style.borderRadius = '4px';
        btn.style.fontWeight = 'bold';
        
        box.appendChild(btn);
        return box;
    };

    // Render danh sách ra màn hình
    const title = document.createElement('h2');
    title.textContent = `🎯 Đã lọc được ${videoUrls.length} Video và ${imageUrls.length} Ảnh`;
    title.style.textAlign = 'center';
    container.appendChild(title);

    if (videoUrls.length > 0) {
        videoUrls.forEach((url, i) => container.appendChild(createMediaBox(url, 'video', i)));
    }

    if (imageUrls.length > 0) {
        imageUrls.forEach((url, i) => container.appendChild(createMediaBox(url, 'image', i)));
    }

    document.body.appendChild(container);
    console.log(`✅ Hoàn tất! Đã làm sạch trang, lọc được ${videoUrls.length} video và ${imageUrls.length} ảnh.`);
})();