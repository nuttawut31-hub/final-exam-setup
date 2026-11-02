const express = require("express");
const { pool } = require("../db");

// แยก Express app ออกจากการเปิดพอร์ต เพื่อให้ Supertest นำ app ไปทดสอบได้
// อ้างอิง: docs/wk09-lab.md หัวข้อ 2.2 (แยก app.js ออกจาก server.js)
const app = express();

// แปลง JSON request body และปฏิเสธ body ที่ใหญ่กว่า 1 KB
// อ้างอิงแนวคิดจำกัด payload: docs/wk12.md หัวข้อ 2.4
// ค่า 1 KB เป็นค่าที่ตั้งสำหรับแบบฝึกนี้
app.use(express.json({ limit: "1kb" }));

// GET /api/menu: คืนเมนูที่พร้อมขายทั้งหมด หรือกรองด้วย query parameter q
app.get("/api/menu", async (req, res) => {
  const q = req.query.q;

  // กฎความยาวและชนิด q เป็น validation ของแบบฝึก; ตรวจซ้ำ q ที่ส่งมาหลายค่า
  if (q !== undefined && (typeof q !== "string" || q.trim().length > 50)) {
    return res
      .status(400)
      .json({ error: "คำค้นต้องมีความยาวไม่เกิน 50 ตัวอักษร" });
  }

  try {
    // ใช้ placeholder และ params แยกค่าค้นหาออกจาก SQL
    // อ้างอิง parameterized query: docs/wk05.md หัวข้อ 3.6
    let sql = "SELECT id, name, price FROM menu_items WHERE available = TRUE";
    const params = [];

    // ถ้ามีคำค้น ให้ค้นหาชื่อที่มีข้อความนั้นอยู่ภายใน
    if (typeof q === "string" && q.trim() !== "") {
      sql += " AND name LIKE ?";
      params.push(`%${q.trim()}%`);
    }

    // เรียงผลลัพธ์ให้ลำดับคงที่ แล้วดึงข้อมูลจาก MySQL ผ่าน connection pool
    sql += " ORDER BY id";
    const [rows] = await pool.query(sql, params);

    // รูปแบบ response สำเร็จของ endpoint รายการเมนู
    return res.status(200).json({ items: rows });
  } catch (error) {
    // เก็บรายละเอียดไว้ที่ server log และส่ง error ทั่วไปให้ client
    console.error(error);
    return res.status(500).json({ error: "ไม่สามารถดึงรายการเมนูได้" });
  }
});

// GET /api/menu/:id: คืนเมนูที่พร้อมขายหนึ่งรายการตาม id
app.get("/api/menu/:id", async (req, res) => {
  const idText = req.params.id;
  const id = Number(idText);

  // รับเฉพาะเลขฐานสิบจำนวนเต็มบวกที่ JavaScript แทนค่าได้อย่างปลอดภัย
  if (!/^[1-9]\d*$/.test(idText) || !Number.isSafeInteger(id)) {
    return res.status(400).json({ error: "id ต้องเป็นเลขจำนวนเต็มบวก" });
  }

  try {
    // ใช้ parameterized query เพื่อส่ง id เป็นค่าแยกจาก SQL
    // อ้างอิง: docs/wk05.md หัวข้อ 3.6
    const [rows] = await pool.query(
      "SELECT id, name, price FROM menu_items WHERE id = ? AND available = TRUE",
      [id],
    );

    // ไม่พบแถวหมายถึงไม่มีเมนูนี้ หรือเมนูไม่ได้เปิดขาย
    if (rows.length === 0) {
      return res.status(404).json({ error: "ไม่พบเมนูที่พร้อมขาย" });
    }

    return res.status(200).json({ item: rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "ไม่สามารถดึงข้อมูลเมนูได้" });
  }
});

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
  // ตรวจ input ด้วยเงื่อนไขพื้นฐาน; ดู schema validation เพิ่มเติมใน docs/wk12.md หัวข้อ 2.1
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

// Export เฉพาะ app; ไฟล์นี้ไม่เรียก listen() เพื่อให้ Supertest ใช้ทดสอบได้
module.exports = app;
