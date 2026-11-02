// Integration-style API tests: ส่ง HTTP request เข้า Express app ด้วย Supertest
// โดย mock ชั้นฐานข้อมูล เพื่อควบคุมผลลัพธ์และไม่บันทึกข้อมูลจริง
// อ้างอิง Jest/Supertest/Mock: docs/wk09.md หัวข้อ 2.5, 3.3, 4.2–4.3
// อ้างอิงแนวคิด transaction ที่กำลังทดสอบ: docs/wk05.md หัวข้อ 4

// Supertest เรียก app ได้โดยไม่ต้องเปิดพอร์ตด้วย app.listen()
const request = require("supertest");
// ใช้ app ที่มี POST /api/orders สำหรับโจทย์จำลองข้อ 3
const app = require("./menu-app");
// pool เป็น dependency ที่เราจะ spy/mock แทนการเชื่อมต่อฐานข้อมูลจริง
const { pool } = require("../db");

// คืน spy/mock หลังแต่ละ test เพื่อไม่ให้ผลจาก test หนึ่งไปรบกวน test ถัดไป
// Jest hooks: docs/wk09.md หัวข้อ 2.5
afterEach(() => {
  jest.restoreAllMocks();
});

// ปิด connection pool เมื่อไฟล์ทดสอบทำงานจบ
afterAll(async () => {
  await pool.end();
});

// กรณีสำเร็จ: ตรวจเมนู สร้าง order เพิ่ม order_items แล้ว commit transaction
test("POST /api/orders creates an order successfully", async () => {
  // จำลอง connection ที่ได้จาก pool.getConnection()
  const connection = {
    // จำลองการเริ่ม transaction
    beginTransaction: jest.fn(),
    // กำหนดผล query ตามลำดับที่ route เรียก:
    // 1) พบเมนู 2) INSERT orders ได้ insertId 123 3) INSERT order_items สำเร็จ
    query: jest
      .fn()
      .mockResolvedValueOnce([[{ id: 1 }], []]) // ตรวจเมนูพร้อมขาย
      .mockResolvedValueOnce([{ insertId: 123 }, []]) // INSERT orders
      .mockResolvedValueOnce([{}, []]), // INSERT order_items
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };

  // ให้ route ใช้ connection ปลอม แทนการขอ connection จาก MySQL จริง
  jest.spyOn(pool, "getConnection").mockResolvedValue(connection);

  // ส่ง request body ตามรูปแบบที่ POST /api/orders ต้องการ
  const response = await request(app)
    .post("/api/orders")
    .send({
      customerName: "สมชาย",
      items: [{ menuItemId: 1, quantity: 2 }],
    });

  // ตรวจ HTTP response และ orderId ที่ได้จาก insertId
  expect(response.statusCode).toBe(201);
  expect(response.body.orderId).toBe(123);
  // ตรวจวงจร transaction: เริ่มและ commit; ไม่ rollback เมื่อสำเร็จ
  expect(connection.beginTransaction).toHaveBeenCalled();
  expect(connection.commit).toHaveBeenCalled();
  expect(connection.rollback).not.toHaveBeenCalled();
  // ต้องคืน connection ไม่ว่าผลลัพธ์จะเป็นอย่างไร
  expect(connection.release).toHaveBeenCalled();
});

// กรณี validation ไม่ผ่าน: ตอบ 400 และหยุดก่อนติดต่อฐานข้อมูล
test("POST /api/orders returns 400 for invalid input", async () => {
  // spy นี้ทำให้ตรวจได้ว่า getConnection ไม่ถูกเรียก;
  // ถ้าถูกเรียกโดยไม่ตั้งใจ mock จะ reject โดยไม่แตะ MySQL จริง
  const getConnectionSpy = jest
    .spyOn(pool, "getConnection")
    .mockRejectedValue(new Error("Should not be called"));

  const response = await request(app)
    .post("/api/orders")
    .send({ customerName: "", items: [] });

  // ตรวจ status และยืนยันว่า validation เกิดก่อนเริ่ม transaction
  expect(response.statusCode).toBe(400);
  expect(getConnectionSpy).not.toHaveBeenCalled();
});

// กรณีเมนูไม่มีหรือไม่พร้อมขาย: ตอบ 404 และ rollback transaction
test("POST /api/orders returns 404 when a menu item is unavailable", async () => {
  const connection = {
    beginTransaction: jest.fn(),
    // mysql2 SELECT คืน [rows, fields]; rows ว่างแปลว่าไม่พบเมนูที่ใช้ได้
    query: jest.fn().mockResolvedValueOnce([[], []]),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };

  // ฉีด connection ปลอมเข้า route
  jest.spyOn(pool, "getConnection").mockResolvedValue(connection);

  // ส่ง id เมนูที่ mock ไว้ว่าไม่พบ
  const response = await request(app)
    .post("/api/orders")
    .send({
      customerName: "สมชาย",
      items: [{ menuItemId: 999, quantity: 1 }],
    });

  // ยืนยันว่าไม่มีการ commit; transaction ต้อง rollback และคืน connection
  expect(response.statusCode).toBe(404);
  expect(connection.rollback).toHaveBeenCalled();
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalled();
});

// กรณี query เพิ่ม order_items ล้มเหลวหลัง INSERT orders แล้ว:
// route ต้อง rollback เพื่อไม่ให้เหลือออเดอร์ที่บันทึกไม่ครบ
test("POST /api/orders rolls back when inserting an order item fails", async () => {
  const connection = {
    beginTransaction: jest.fn(),
    // จำลอง: ตรวจเมนูผ่าน, สร้าง order ผ่าน, แล้ว INSERT order_items โยน error
    query: jest
      .fn()
      .mockResolvedValueOnce([[{ id: 1 }], []]) // ตรวจเมนูผ่าน
      .mockResolvedValueOnce([{ insertId: 123 }, []]) // สร้าง order ผ่าน
      .mockRejectedValueOnce(new Error("Insert item failed")), // เพิ่มรายการอาหารพลาด
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };

  // route ใช้ connection ปลอม; mock console.error เพื่อล้าง output ของ Jest
  jest.spyOn(pool, "getConnection").mockResolvedValue(connection);
  jest.spyOn(console, "error").mockImplementation(() => {});

  const response = await request(app)
    .post("/api/orders")
    .send({
      customerName: "สมชาย",
      items: [{ menuItemId: 1, quantity: 2 }],
    });

  // ตรวจ error response และยืนยัน rollback, ไม่ commit, และ release connection
  expect(response.statusCode).toBe(500);
  expect(response.body.error).toBe("ไม่สามารถสร้างคำสั่งซื้อได้");
  expect(connection.rollback).toHaveBeenCalled();
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalled();
});
