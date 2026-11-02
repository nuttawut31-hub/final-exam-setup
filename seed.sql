-- โครงสร้างและข้อมูลตัวอย่างของระบบสั่งอาหารออนไลน์
-- รัน: npm run seed
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS menu_items;

CREATE TABLE menu_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  available BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  menu_item_id INT NOT NULL,
  quantity INT NOT NULL,
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_menu FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
);

INSERT INTO menu_items (name, price, available) VALUES
('ข้าวผัดกุ้ง', 60.00, TRUE),
('ผัดกะเพราหมูสับ', 50.00, TRUE),
('ก๋วยเตี๋ยวเรือ', 55.00, TRUE),
('ข้าวมันไก่', 50.00, TRUE),
('ส้มตำไทย', 40.00, TRUE),
('ไก่ทอด 2 ชิ้น', 45.00, TRUE),
('ต้มยำกุ้ง', 90.00, TRUE),
('แกงเขียวหวานไก่', 65.00, TRUE),
('ข้าวขาหมู', 70.00, FALSE),
('ผัดไทยกุ้งสด', 75.00, TRUE),
('สเต็กไก่', 120.00, TRUE),
('ยำวุ้นเส้น', 45.00, TRUE),
('ข้าวราดแกงจืด', 40.00, TRUE),
('ลาบหมู', 55.00, TRUE),
('ชาเย็น', 25.00, TRUE),
('น้ำมะนาว', 20.00, TRUE),
('กาแฟเย็น', 35.00, TRUE),
('น้ำแตงโม', 30.00, FALSE),
('ขนมปังปิ้ง', 25.00, TRUE),
('บิงซู', 85.00, TRUE),
('ข้าวไข่เจียวหมูสับ', 55.00, TRUE),
('สุกี้น้ำ', 110.00, TRUE);

INSERT INTO orders (customer_name, status, created_at) VALUES
('สมชาย', 'delivered', '2026-01-10 12:00:00'),
('สมหญิง', 'preparing', '2026-01-10 12:30:00'),
('วิชัย', 'pending', '2026-01-10 13:00:00');

INSERT INTO order_items (order_id, menu_item_id, quantity) VALUES
(1, 1, 2),
(1, 15, 2),
(2, 6, 1),
(3, 7, 1),
(3, 16, 2);
