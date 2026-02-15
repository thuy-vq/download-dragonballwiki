const fs = require('fs');
const path = require('path');

// Cấu hình đường dẫn folder chứa ảnh ở đây
const targetDir = './Am duong lo Upscale'; 
const filesPerFolder = 55;

// Các định dạng ảnh muốn quét
const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

async function organizeImages() {
  try {
    // 1. Đọc danh sách tất cả các file trong thư mục
    const files = fs.readdirSync(targetDir);

    // 2. Chỉ lọc ra các file là ảnh
    const images = files.filter(file => {
      return imageExtensions.includes(path.extname(file).toLowerCase());
    });

    console.log(`Tìm thấy tổng cộng: ${images.length} ảnh.`);

    // 3. Lặp và chia nhóm
    for (let i = 0; i < images.length; i++) {
      // Cứ mỗi 55 ảnh (i % 55 === 0), xác định tên folder mới
      const folderIndex = Math.floor(i / filesPerFolder) + 1;
      const newFolderDir = path.join(targetDir, `chap_${folderIndex}`);

      // Tạo folder nếu chưa tồn tại
      if (!fs.existsSync(newFolderDir)) {
        fs.mkdirSync(newFolderDir);
      }

      // Di chuyển file vào folder tương ứng
      const oldPath = path.join(targetDir, images[i]);
      const newPath = path.join(newFolderDir, images[i]);

      fs.renameSync(oldPath, newPath);
    }

    console.log('Hoàn thành! Các ảnh đã được gom vào folder riêng.');
  } catch (error) {
    console.error('Có lỗi xảy ra:', error.message);
  }
}

organizeImages();
