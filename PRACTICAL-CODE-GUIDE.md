# คู่มือโค้ดฝึกข้อสอบปฏิบัติ

> **สำคัญ:** โจทย์ด้านล่างเป็นโจทย์จำลองที่คาดจากแนวข้อสอบ เอกสาร และโครงสร้างโปรเจกต์ ไม่ใช่โจทย์จริงที่อาจารย์ยืนยัน

## ข้อมูลที่ยืนยันได้

- แนวข้อสอบระบุภาคปฏิบัติ 3 งาน รวม 15 คะแนน ใช้ Express, MySQL, Jest และ Supertest
- เปิดเอกสารบรรยายและปฏิบัติการสัปดาห์ 5–12 ได้ เอกสารที่มีไม่มีสัปดาห์ 8
- รายละเอียดโจทย์จริงจะทราบในวันสอบ จึงควรยึดรูปแบบ input, response และ status code จากโจทย์จริง

## เปิดเอกสารตรงไหน

| ต้องการหา                                     | เอกสาร/หัวข้อ                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| SQL `JOIN` และ parameterized query            | `docs/wk05.md` หัวข้อ 3.5–3.6                                                                  |
| Transaction, `commit`, `rollback`             | `docs/wk05.md` หัวข้อ 4.3–4.4 และ `docs/wk05-lab.md` ขั้นตอน 3.3–3.4                          |
| แยก Express app สำหรับ Supertest              | `docs/wk09-lab.md` หัวข้อ 2.2                                                                  |
| Jest, Supertest และ mock                      | `docs/wk09.md` และ `docs/wk09-lab.md`                                                          |
| แนวคิดตรวจ input ด้วย schema และจำกัด payload | `docs/wk12.md` หัวข้อ 2.1 และ 2.4                                                              |

เอกสาร `docs/` เป็นโฟลเดอร์แยกนอก repository `final-exam-setup`; ชื่อด้านบนใช้ค้นใน workspace ส่วนตัวอย่างโค้ดและไฟล์ฝึกใน repository เปิดจาก GitHub ได้

ชื่อ request fields และ status code ในตัวอย่างนี้เป็นส่วนหนึ่งของโจทย์จำลอง ให้เปลี่ยนตามโจทย์จริง

## โจทย์จำลอง 1: สร้างออเดอร์ด้วย transaction

**โจทย์ฝึก:** `POST /api/orders` รับ `customerName` และ `items` แต่ละรายการมี `menuItemId` กับ `quantity`; ตรวจ input และความพร้อมขายของเมนู จากนั้นเพิ่ม order และ order items ให้สำเร็จพร้อมกัน หรือ rollback เมื่อเกิดความผิดพลาด

โค้ดที่รันได้อยู่ใน [`practice/menu-app.js`](practice/menu-app.js) ส่วนสำคัญมีรูปแบบดังนี้:

ก่อน route ต้องมี `app.use(express.json(...))` เพื่อให้ Express แปลง JSON request body เป็น `req.body`; ในไฟล์ฝึกตั้งขนาดไว้ที่ `1kb`

```js
app.post("/api/orders", async (req, res) => {
  const { customerName, items } = req.body || {};

  // ตรวจชนิดและค่าขั้นต่ำตามสัญญา request ของโจทย์
  const validCustomerName =
    typeof customerName === "string" && customerName.trim().length > 0;
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

  // ปฏิเสธข้อมูลผิดก่อนเริ่มติดต่อฐานข้อมูล
  if (!validCustomerName || !validItems) {
    return res.status(400).json({ error: "ข้อมูลคำสั่งซื้อไม่ถูกต้อง" });
  }

  let connection;
  try {
    // ใช้ connection เดียวตลอด transaction
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // ตรวจว่า menuItemId ทุกตัวมีอยู่และยังพร้อมขาย
    for (const item of items) {
      const [menuRows] = await connection.query(
        "SELECT id FROM menu_items WHERE id = ? AND available = TRUE",
        [item.menuItemId],
      );

      if (menuRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          error: "ไม่พบเมนูหรือเมนูไม่พร้อมขาย",
        });
      }
    }

    // เพิ่ม order หลัก แล้วใช้ insertId เชื่อมรายการอาหาร
    const [orderResult] = await connection.query(
      "INSERT INTO orders (customer_name) VALUES (?)",
      [customerName.trim()],
    );
    const orderId = orderResult.insertId;

    // เพิ่ม order_items ทุกแถวภายใน transaction เดียวกัน
    for (const item of items) {
      await connection.query(
        "INSERT INTO order_items (order_id, menu_item_id, quantity) VALUES (?, ?, ?)",
        [orderId, item.menuItemId, item.quantity],
      );
    }

    // ยืนยันเมื่อทุกคำสั่งสำเร็จ
    await connection.commit();
    return res.status(201).json({ orderId });
  } catch (error) {
    // ย้อนการเปลี่ยนแปลงเมื่อ query ใดล้มเหลว
    if (connection) await connection.rollback();
    console.error(error);
    return res.status(500).json({ error: "ไม่สามารถสร้างคำสั่งซื้อได้" });
  } finally {
    // คืน connection ทั้งกรณีสำเร็จและล้มเหลว
    if (connection) connection.release();
  }
});
```

**จำลำดับ:** validate → `getConnection` → `beginTransaction` → ตรวจ/insert → `commit`; ถ้าพลาดให้ `rollback`; จบแล้ว `release`

## โจทย์จำลอง 2: อ่านรายละเอียดออเดอร์ด้วย JOIN

**โจทย์ฝึก:** `GET /api/orders/:id` ตรวจ id, ค้นข้อมูล order พร้อมเมนู, ตอบ `404` เมื่อไม่มี order และตอบ `500` เมื่อ query ล้มเหลว

โค้ดที่รันได้อยู่ใน [`practice/order-detail-retry.js`](practice/order-detail-retry.js):

```js
app.get("/api/orders/:id", async (req, res) => {
  // path parameter เป็น string จึงตรวจรูปแบบและแปลงก่อนใช้
  const idText = req.params.id;
  const id = Number(idText);
  if (!/^[1-9]\d*$/.test(idText) || !Number.isSafeInteger(id)) {
    return res.status(400).json({ error: "id ต้องเป็นเลขจำนวนเต็มบวก" });
  }

  try {
    // JOIN รวมข้อมูลจากสามตาราง; ? รับค่าจาก params แยกจาก SQL
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

    // query ไม่พบแถว หมายถึงไม่มี order นี้
    if (rows.length === 0) {
      return res.status(404).json({ error: "ไม่พบออเดอร์" });
    }

    // ข้อมูล order ซ้ำในแต่ละแถวของ JOIN; ใช้แถวแรกสำหรับข้อมูลหลัก
    const first = rows[0];

    // แต่ละแถวเป็นอาหารหนึ่งรายการ; กรอง null ที่อาจเกิดจาก LEFT JOIN
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
```

**จำลำดับ:** validate id → query ด้วย `[id]` → ตรวจ `rows.length` → ใช้ `rows[0]` กับข้อมูลหลัก → map รายการ → ส่ง response

## โจทย์จำลอง 3: ทดสอบด้วย Jest/Supertest

**โจทย์ฝึก:** ทดสอบกรณีสำเร็จและกรณีผิดพลาด โดย mock ฐานข้อมูลเพื่อไม่เขียนข้อมูลจริง

ตัวอย่างทดสอบ transaction สำเร็จจาก [`practice/order-post-retry.test.js`](practice/order-post-retry.test.js):

```js
const request = require("supertest");
const app = require("./menu-app");
const { pool } = require("../db");

afterEach(() => {
  jest.restoreAllMocks();
});

test("POST /api/orders creates an order successfully", async () => {
  // สร้าง connection ปลอมและกำหนดผล query ตามลำดับที่ route เรียก
  const connection = {
    beginTransaction: jest.fn(),
    query: jest
      .fn()
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([{ insertId: 123 }, []])
      .mockResolvedValueOnce([{}, []]),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  jest.spyOn(pool, "getConnection").mockResolvedValue(connection);

  // Act: ส่ง request body ตามสัญญาของ route
  const response = await request(app)
    .post("/api/orders")
    .send({ customerName: "สมชาย", items: [{ menuItemId: 1, quantity: 2 }] });

  // Assert: ตรวจผลตอบกลับและ transaction lifecycle
  expect(response.statusCode).toBe(201);
  expect(response.body.orderId).toBe(123);
  expect(connection.commit).toHaveBeenCalled();
  expect(connection.rollback).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalled();
});
```

ตัวอย่าง failure path ที่ควรมีในชุดทดสอบ:

```js
// POST: ถ้า insert order_items ล้มเหลว ต้องตอบ 500, rollback และ release
expect(response.statusCode).toBe(500);
expect(connection.rollback).toHaveBeenCalled();
expect(connection.commit).not.toHaveBeenCalled();
expect(connection.release).toHaveBeenCalled();

// GET: ถ้า id ไม่ถูกต้อง ต้องตอบ 400 และไม่ query ฐานข้อมูล
expect(response.statusCode).toBe(400);
expect(pool.query).not.toHaveBeenCalled();
```

ไฟล์ทดสอบฉบับเต็มอยู่ใน [`order-post-retry.test.js`](practice/order-post-retry.test.js) และ [`order-detail-retry.test.js`](practice/order-detail-retry.test.js) โครงสร้าง test ใช้ Arrange–Act–Assert; mock ที่สร้างด้วย `jest.spyOn` คืนค่าด้วย `jest.restoreAllMocks()` ใน hook หลัง test ตามความเหมาะสม

## เปิดเอกสารและค้นอย่างไรตอนฝึก

1. อ่านโจทย์แล้ววง method, path, input, response และ failure cases
2. เปิดหัวข้อในตารางด้านบน หรือกด `Ctrl+F` ค้น `JOIN`, `beginTransaction`, `rollback`, `Supertest`, `mock`
3. เปิดไฟล์ฝึกที่ลิงก์ไว้เพื่อเทียบรูปแบบที่รันได้
4. ยึดรายละเอียดจากโจทย์จริง หากชื่อ field, status code หรือ response ต่างจากตัวอย่าง ให้ทำตามโจทย์

หากจะทดลองตั้งฐานข้อมูลใหม่ ใช้ schema ใน [`seed.sql`](seed.sql); คู่มือนี้ไม่เปิดเผยโจทย์จริง
