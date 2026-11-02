const express = require("express");
const { pool } = require("../db");

// ตัวอย่าง GET /api/orders/:id สำหรับฝึกอ่านรายละเอียดออเดอร์ด้วย JOIN
// แยก Express app ออกจาก app.listen() เพื่อให้ Supertest เรียก app ไปทดสอบได้
// อ้างอิง: docs/wk05.md หัวข้อ 3.5–3.6 และ docs/wk09-lab.md หัวข้อ 2.2
const app = express();

app.get("/api/orders/:id", async (req, res) => {
  // path parameter เป็น string จึงแปลงเป็น number ก่อน query
  const idText = req.params.id;
  const id = Number(idText);

  // ตรวจรูปแบบและช่วงของ id ก่อนติดต่อฐานข้อมูล
  if (!/^[1-9]\d*$/.test(idText) || !Number.isSafeInteger(id)) {
    return res.status(400).json({ error: "id ต้องเป็นเลขจำนวนเต็มบวก" });
  }

  try {
    // JOIN รวม order, order_items และเมนู; ? รับ id แยกจาก SQL
    // อ้างอิง: docs/wk05.md หัวข้อ 3.5–3.6
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

    // query ไม่พบแถว หมายถึงไม่มีออเดอร์นี้
    if (rows.length === 0) {
      return res.status(404).json({ error: "ไม่พบออเดอร์" });
    }

    // ข้อมูล order ซ้ำในผล JOIN; ใช้แถวแรกแทนข้อมูลส่วนหลัก
    const first = rows[0];

    // แต่ละแถวเป็นรายการอาหาร; กรอง null ที่อาจเกิดจาก LEFT JOIN
    const items = rows
      .filter((row) => row.menuItemId !== null)
      .map((row) => ({
        menuItemId: row.menuItemId,
        name: row.itemName,
        price: row.price,
        quantity: row.quantity,
      }));

    // รวมข้อมูลหลักกับรายการอาหารเป็น response เดียว
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

// Export เฉพาะ app; ไม่เปิดพอร์ตในไฟล์ route เพื่อให้ Supertest ใช้ได้
module.exports = app;
