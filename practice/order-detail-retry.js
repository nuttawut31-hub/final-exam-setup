const express = require("express");
const { pool } = require("../db");

// แยก Express app ออกจากการเปิดพอร์ต เพื่อให้ Supertest นำ app ไปทดสอบได้
// อ้างอิง: docs/wk09-lab.md หัวข้อ 2.2 (แยก app.js ออกจาก server.js)
const app = express();

// POST /api/orders: สร้าง order และ order_items ให้สำเร็จหรือ rollback พร้อมกัน
// อ้างอิง transaction/rollback: docs/wk05-lab.md ขั้นตอน 3.3–3.4
app.post("/api/orders", async (req, res) => {
  const { customerName, items } = req.body || {};

  // ตรวจชื่อลูกค้าว่าเป็นข้อความและไม่ใช่ค่าว่างหลังตัดช่องว่างหัวท้าย
  const validCustomerName =
    typeof customerName === "string" && customerName.trim().length > 0;

  // ตรวจว่ามีรายการอาหารอย่างน้อยหนึ่งรายการ และทุกค่าที่ต้องใช้เป็นจำนวนเต็มบวก
  const validItems =
    Array.isArray(items) &&
    items.length > 0 &&
    items.every(
      (item) =>
        item &&
        Number.isSafeInteger(item.menuItemId) &&
        item.menuItemId > 0 &&
        Number.isSafeInteger(item.quantity) &&
        item.quantity > 0,
    );

  // ข้อมูลผิดรูปแบบให้ตอบ 400 ก่อนขอ connection จากฐานข้อมูล
  // แนวคิด validation: docs/wk05-lab.md ขั้นตอน 2.5; schema ขั้นสูงอยู่ใน docs/wk12.md
  if (!validCustomerName || !validItems) {
    return res.status(400).json({ error: "ข้อมูลคำสั่งซื้อไม่ถูกต้อง" });
  }

  let connection;
  try {
    // ขอ connection และเริ่ม transaction สำหรับชุดคำสั่งที่ต้อง atomic
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // ตรวจทุกรายการว่า id มีอยู่และเมนูพร้อมขายก่อนสร้าง order
    for (const item of items) {
      const [menuRows] = await connection.query(
        "SELECT id FROM menu_items WHERE id = ? AND available = TRUE",
        [item.menuItemId],
      );

      // ถ้ามีรายการใดใช้ไม่ได้ ให้ยกเลิก transaction ทั้งชุด
      if (menuRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          error: "ไม่พบเมนูหรือเมนูไม่พร้อมขาย",
        });
      }
    }

    // สร้าง order หลัก; status จะใช้ค่า default "pending" จาก schema
    const [orderResult] = await connection.query(
      "INSERT INTO orders (customer_name) VALUES (?)",
      [customerName.trim()],
    );
    const orderId = orderResult.insertId;

    // ผูกแต่ละรายการอาหารเข้ากับ order ที่เพิ่งสร้าง
    for (const item of items) {
      await connection.query(
        "INSERT INTO order_items (order_id, menu_item_id, quantity) VALUES (?, ?, ?)",
        [orderId, item.menuItemId, item.quantity],
      );
    }

    // ยืนยันการบันทึกเมื่อ order และทุกรายการถูกเพิ่มครบแล้ว
    await connection.commit();
    return res.status(201).json({ orderId });
  } catch (error) {
    // หากมี connection ให้ย้อน transaction; กรณีขอ connection ไม่สำเร็จจะข้าม rollback
    if (connection) {
      await connection.rollback();
    }
    console.error(error);
    return res.status(500).json({ error: "ไม่สามารถสร้างคำสั่งซื้อได้" });
  } finally {
    // คืน connection ไม่ว่าจะสำเร็จ, rollback, หรือเกิด error
    if (connection) {
      connection.release();
    }
  }
});

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
