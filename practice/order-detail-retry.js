const express = require("express");
const { pool } = require("../db");

// แยก Express app ออกจากการเปิดพอร์ต เพื่อให้ Supertest นำ app ไปทดสอบได้
// อ้างอิง: docs/wk09-lab.md หัวข้อ 2.2 (แยก app.js ออกจาก server.js)
const app = express();

app.get("/api/orders/:id", async (req, res, next) => {
  // อ่าน id จาก path; ค่าใน req.params จะเป็น string เสมอ
  const idText = req.params.id;
  // แปลงเป็น number เพื่อใช้ตรวจว่าเป็นจำนวนเต็มที่ปลอดภัย
  const id = Number(idText);

  // ตรวจ input ก่อน query ฐานข้อมูล: ต้องเป็นเลขฐานสิบจำนวนเต็มบวก
  // แนวคิด validation เชื่อมกับ docs/wk12.md
  if (!/^[1-9]\d*$/.test(idText) || !Number.isSafeInteger(id)) {
    return res.status(400).json({ error: "id ต้องเป็นเลขจำนวนเต็มบวก" });
  }

  try {
    const [rows] = await pool.query(
      `SELECT
    o.id AS orderId,
    o.customer_name AS customerName,
    o.status,
    o.created_at AS createdAt,
    oi.menu_item_id AS menuItemId,
    mi.name AS itemName,
    mi.price,
    oi.quantity
  FROM orders AS o
  LEFT JOIN order_items AS oi ON oi.order_id = o.id
  LEFT JOIN menu_items AS mi ON mi.id = oi.menu_item_id
  WHERE o.id = ?`,
      [id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "ไม่พบออเดอร์" });
    }

    const first = rows[0];

    const items = rows
      .filter((row) => row.menuItemId !== null)
      .map((row) => ({
        menuItemId: row.menuItemId,
        name: row.itemName,
        price: row.price,
        quantity: row.quantity,
      }));

    return res.status(200).json({
      order: {
        id: first.orderId,
        customerName: first.customerName,
        status: first.status,
        createdAt: first.createdAt,
        items,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "ไม่สามารถดึงข้อมูลออเดอร์ได้" });
  }
});
module.exports = app;
