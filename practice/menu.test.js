// ชุดทดสอบ API ด้วย Jest และ Supertest
// แนวคิดหลัก: docs/wk09.md และ docs/wk09-lab.md (Jest, Supertest, mock และการทดสอบ route)
// การตรวจ input และขนาด payload เชื่อมกับ docs/wk12.md
// การจำลอง transaction ของออเดอร์เชื่อมกับ docs/wk05-lab.md

// Supertest ใช้ส่ง HTTP request เข้า app โดยไม่ต้องเปิดพอร์ตด้วย app.listen()
const request = require("supertest");
// โหลด Express app ที่ export ไว้สำหรับการทดสอบ
const app = require("./menu-app");
// pool ใช้จำลอง query และปิดการเชื่อมต่อฐานข้อมูลหลังชุดทดสอบ
const { pool } = require("../db");

// ปิด connection pool เมื่อ Jest ทำงานเสร็จ เพื่อไม่ให้มี handle ค้างอยู่
afterAll(async () => {
  await pool.end();
});

// ตรวจเส้นทางสำเร็จของรายการเมนู: status, รูปแบบข้อมูล, จำนวนรายการ,
// การกรองเมนูที่ไม่พร้อมขาย และ fields ที่ API ต้องส่งกลับ
test("GET /api/menu returns available menu items", async () => {
  const response = await request(app).get("/api/menu");

  expect(response.statusCode).toBe(200);
  expect(Array.isArray(response.body.items)).toBe(true);
  expect(response.body.items.length).toBeGreaterThan(0);
  expect(response.body.items.some((item) => item.name === "ข้าวขาหมู")).toBe(
    false,
  );
  expect(response.body.items.some((item) => item.name === "น้ำแตงโม")).toBe(
    false,
  );
  expect(
    response.body.items.every(
      (item) =>
        item.id !== undefined &&
        typeof item.name === "string" &&
        item.price !== undefined,
    ),
  ).toBe(true);
});

// คืน mock ทั้งหมดหลังแต่ละ test เพื่อไม่ให้ mock ของ test หนึ่ง
// ส่งผลต่อ test ถัดไป (Jest: restore mocks / test isolation)
afterEach(() => {
  jest.restoreAllMocks();
});

// จำลองกรณีฐานข้อมูล query ล้มเหลว แล้วตรวจว่า route ตอบ 500 พร้อมข้อความ error
test("GET /api/menu returns 500 when database query fails", async () => {
  jest.spyOn(pool, "query").mockRejectedValueOnce(new Error("DB error"));

  const response = await request(app).get("/api/menu");

  expect(response.statusCode).toBe(500);
  expect(response.body.error).toBe("ไม่สามารถดึงรายการเมนูได้");
});

// ตรวจ validation ของ path parameter: id ที่ไม่ใช่จำนวนเต็มต้องได้ 400
test("GET /api/menu/:id returns 400 for invalid id", async () => {
  const response = await request(app).get("/api/menu/abc");

  expect(response.statusCode).toBe(400);
});

// จำลอง query ที่ไม่พบแถวข้อมูล แล้วตรวจว่า route ตอบ 404
test("GET /api/menu/:id returns 404 when menu is not found", async () => {
  jest.spyOn(pool, "query").mockResolvedValueOnce([[], []]);

  const response = await request(app).get("/api/menu/999");

  expect(response.statusCode).toBe(404);
});

// จำลองผล query ที่พบเมนู แล้วตรวจ status 200 และ response body
test("GET /api/menu/:id returns a menu item when found", async () => {
  const item = { id: 5, name: "ผัดไทย", price: 80 };
  jest.spyOn(pool, "query").mockResolvedValueOnce([[item], []]);

  const response = await request(app).get("/api/menu/5");

  expect(response.statusCode).toBe(200);
  expect(response.body.item).toEqual(item);
});

// test.each รัน test เดิมซ้ำกับ id หลายรูปแบบ เพื่อครอบคลุม input ผิดหลายกรณี
test.each(["abc", "0", "-1", "1.5", "1e2"])(
  "GET /api/menu/%s returns 400 for invalid id",
  async (id) => {
    const response = await request(app).get(`/api/menu/${id}`);

    expect(response.statusCode).toBe(400);
  },
);

// จำลอง database error ของ route รายละเอียดเมนู และซ่อน console.error
// เพื่อให้ output ของ Jest แสดงเฉพาะผล test
test("GET /api/menu/:id returns 500 when database query fails", async () => {
  jest.spyOn(pool, "query").mockRejectedValueOnce(new Error("DB error"));
  jest.spyOn(console, "error").mockImplementation(() => {});

  const response = await request(app).get("/api/menu/5");

  expect(response.statusCode).toBe(500);
  expect(response.body.error).toBe("ไม่สามารถดึงข้อมูลเมนูได้");
});

// ตรวจการค้นหาด้วย q และตรวจด้วยว่า SQL ใช้ placeholder (?) พร้อม parameters
// แทนการนำข้อความค้นหาไปต่อเป็น SQL โดยตรง
test("GET /api/menu?q=ผัดไทย filters menu by name", async () => {
  const item = { id: 5, name: "ผัดไทย", price: 80 };

  jest.spyOn(pool, "query").mockResolvedValueOnce([[item], []]);

  const response = await request(app).get("/api/menu").query({ q: "ผัดไทย" });

  expect(response.statusCode).toBe(200);
  expect(response.body.items).toEqual([item]);
  expect(pool.query).toHaveBeenCalledWith(
    "SELECT id, name, price FROM menu_items WHERE available = TRUE AND name LIKE ? ORDER BY id",
    ["%ผัดไทย%"],
  );
});

// ตรวจขอบเขต validation: คำค้นยาวเกิน 50 ตัวอักษรต้องได้ 400
test("GET /api/menu rejects a search query longer than 50 characters", async () => {
  const response = await request(app)
    .get("/api/menu")
    .query({ q: "a".repeat(51) });

  expect(response.statusCode).toBe(400);
});

// ปฏิเสธ query parameter ชื่อ q ที่ส่งมาซ้ำและถูกแปลงเป็น array
test("GET /api/menu rejects repeated q parameters", async () => {
  const response = await request(app)
    .get("/api/menu")
    .query({ q: ["ผัดไทย", "ข้าวผัด"] });

  expect(response.statusCode).toBe(400);
});

// ตรวจ body ที่ใหญ่กว่าขีดจำกัด express.json ว่าถูกปฏิเสธด้วย 413
test("rejects a JSON body larger than the configured limit", async () => {
  const response = await request(app)
    .post("/api/menu")
    .send({ data: "a".repeat(2048) });

  expect(response.statusCode).toBe(413);
});

// ตรวจว่า input ออเดอร์ที่ไม่ผ่าน validation ถูกปฏิเสธด้วย 400
// ก่อนเริ่ม transaction หรือเขียนข้อมูล
test("POST /api/orders returns 400 for invalid input", async () => {
  const response = await request(app)
    .post("/api/orders")
    .send({ customerName: "", items: [] });

  expect(response.statusCode).toBe(400);
});

// จำลอง connection และผล query ตามลำดับ:
// 1) ตรวจเมนู 2) สร้าง order 3) สร้าง order_items
// จากนั้นตรวจว่า transaction commit และคืน connection เมื่อสำเร็จ
test("POST /api/orders creates an order successfully", async () => {
  const connection = {
    beginTransaction: jest.fn(),
    query: jest
      .fn()
      .mockResolvedValueOnce([[{ id: 5 }]]) // SELECT เมนูที่พร้อมขาย
      .mockResolvedValueOnce([{ insertId: 123 }]) // INSERT orders
      .mockResolvedValueOnce([{}]), // INSERT order_items
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };

  jest.spyOn(pool, "getConnection").mockResolvedValue(connection);

  const response = await request(app)
    .post("/api/orders")
    .send({
      customerName: "สมชาย",
      items: [{ menuItemId: 5, quantity: 2 }],
    });

  expect(response.statusCode).toBe(201);
  expect(response.body.orderId).toBe(123);
  expect(connection.beginTransaction).toHaveBeenCalled();
  expect(connection.commit).toHaveBeenCalled();
  expect(connection.rollback).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalled();
});

// จำลองให้การเพิ่ม order_items ล้มเหลวหลังสร้าง order แล้ว
// ตรวจว่า route rollback, ไม่ commit, ตอบ 500 และคืน connection
test("POST /api/orders rolls back when inserting an order item fails", async () => {
  const connection = {
    beginTransaction: jest.fn(),
    query: jest
      .fn()
      .mockResolvedValueOnce([[{ id: 5 }]]) // ตรวจเมนูผ่าน
      .mockResolvedValueOnce([{ insertId: 123 }]) // เพิ่มออเดอร์ผ่าน
      .mockRejectedValueOnce(new Error("Insert item failed")), // เพิ่มรายการอาหารล้มเหลว
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };

  jest.spyOn(pool, "getConnection").mockResolvedValue(connection);
  jest.spyOn(console, "error").mockImplementation(() => {});

  const response = await request(app)
    .post("/api/orders")
    .send({
      customerName: "สมชาย",
      items: [{ menuItemId: 5, quantity: 2 }],
    });

  expect(response.statusCode).toBe(500);
  expect(connection.rollback).toHaveBeenCalled();
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalled();
});

// จำลองว่า query ตรวจเมนูไม่พบเมนูที่พร้อมขาย
// ตรวจว่า route ตอบ 404 และ rollback transaction
test("POST /api/orders returns 404 when a menu item is unavailable", async () => {
  // สร้าง connection ปลอม เพื่อทดสอบ transaction โดยไม่เขียนข้อมูลลงฐานข้อมูลจริง
  const connection = {
    // จำลองว่าเริ่ม transaction สำเร็จ
    beginTransaction: jest.fn(),
    // query ตรวจเมนูแล้วคืนผลว่าง แปลว่าไม่พบเมนูที่พร้อมขาย
    query: jest.fn().mockResolvedValueOnce([[]]), // ไม่พบเมนูที่พร้อมขาย
    // เตรียมฟังก์ชัน commit ไว้ตรวจว่าไม่ควรถูกเรียกในกรณีนี้
    commit: jest.fn(),
    // route ควร rollback เมื่อไม่พบเมนู
    rollback: jest.fn(),
    // route ต้องคืน connection หลังจบการทำงาน
    release: jest.fn(),
  };

  // ทำให้ route ได้ connection ปลอมนี้แทนการขอ connection จริงจาก pool
  jest.spyOn(pool, "getConnection").mockResolvedValue(connection);

  // ส่งออเดอร์ที่อ้างถึงเมนู id 999 ซึ่ง mock ด้านบนจำลองว่าไม่มี
  const response = await request(app)
    .post("/api/orders")
    .send({
      customerName: "สมชาย",
      items: [{ menuItemId: 999, quantity: 1 }],
    });

  // เมนูไม่พบ จึงคาดหวัง 404 Not Found
  expect(response.statusCode).toBe(404);
  // ยืนยันว่า transaction ถูกยกเลิก
  expect(connection.rollback).toHaveBeenCalled();
  // ยืนยันว่าไม่มีการยืนยันบันทึกออเดอร์
  expect(connection.commit).not.toHaveBeenCalled();
  // ยืนยันว่าคืน connection แล้ว
  expect(connection.release).toHaveBeenCalled();
});

// Arrange–Act–Assert: ส่ง id ผิดรูปแบบ แล้วตรวจว่า validation ตอบ 400 ก่อน query ฐานข้อมูล
test("GET /api/orders/:id returns 400 for invalid id", async () => {
  // Act: ส่งข้อความแทน id ที่เป็นจำนวนเต็มบวก
  const response = await request(app).get("/api/orders/abc");

  // Assert: ค่าจาก path ไม่ถูกต้อง จึงตอบ Bad Request
  expect(response.statusCode).toBe(400);
});

// จำลอง query ที่ไม่พบแถว แล้วตรวจ response กรณีไม่มีออเดอร์
test("GET /api/orders/:id returns 404 when order is not found", async () => {
  // Arrange: mysql2 คืน [rows, fields]; rows ว่างหมายถึงไม่พบออเดอร์
  jest.spyOn(pool, "query").mockResolvedValueOnce([[], []]);

  // Act: ขอออเดอร์ที่ไม่มีอยู่
  const response = await request(app).get("/api/orders/9999");

  // Assert: API ต้องตอบ Not Found
  expect(response.statusCode).toBe(404);
});

// ทดสอบกรณีสำเร็จ โดย mock ผล JOIN ที่มีสองแถวสำหรับอาหารสองรายการ
test("GET /api/orders/:id returns an order with its items", async () => {
  // JOIN คืนหนึ่งแถวต่อรายการอาหาร โดยข้อมูลออเดอร์จะซ้ำกัน
  const rows = [
    {
      orderId: 1,
      customerName: "สมชาย",
      status: "delivered",
      createdAt: "2026-01-10 12:00:00",
      menuItemId: 1,
      itemName: "ข้าวผัดกุ้ง",
      price: 60,
      quantity: 2,
    },
    {
      orderId: 1,
      customerName: "สมชาย",
      status: "delivered",
      createdAt: "2026-01-10 12:00:00",
      menuItemId: 15,
      itemName: "ชาเย็น",
      price: 25,
      quantity: 2,
    },
  ];

  // จำลองผลจาก pool.query โดยไม่เรียกฐานข้อมูลจริง
  jest.spyOn(pool, "query").mockResolvedValueOnce([rows, []]);

  const response = await request(app).get("/api/orders/1");

  // ตรวจว่า request สำเร็จ
  expect(response.statusCode).toBe(200);
  // ยืนยันว่า id ถูกส่งแยกเป็น parameter ไม่ได้ต่อเข้า SQL โดยตรง
  expect(pool.query).toHaveBeenCalledWith(
    expect.stringContaining("WHERE o.id = ?"),
    [1],
  );
  // ตรวจว่า route แยกข้อมูลออเดอร์จากข้อมูลรายการอาหารได้ถูกต้อง
  expect(response.body.order.id).toBe(1);
  expect(response.body.order.customerName).toBe("สมชาย");
  expect(response.body.order.items).toEqual([
    { menuItemId: 1, name: "ข้าวผัดกุ้ง", price: 60, quantity: 2 },
    { menuItemId: 15, name: "ชาเย็น", price: 25, quantity: 2 },
  ]);
});

// จำลอง pool.query โยน error แล้วตรวจการจัดการ database failure ของ route
test("GET /api/orders/:id returns 500 when database query fails", async () => {
  // Arrange: ให้ query ปฏิเสธ Promise เหมือนเกิดข้อผิดพลาดจากฐานข้อมูล
  jest.spyOn(pool, "query").mockRejectedValueOnce(new Error("DB error"));
  // ซ่อน log ของ error ใน output ของ Jest
  jest.spyOn(console, "error").mockImplementation(() => {});

  // Act: เรียก route ที่จะทำ query
  const response = await request(app).get("/api/orders/1");

  // Assert: API ต้องตอบ 500 พร้อมข้อความ error ที่กำหนด
  expect(response.statusCode).toBe(500);
  expect(response.body.error).toBe("ไม่สามารถดึงข้อมูลออเดอร์ได้");
});

// ตรวจกรณี LEFT JOIN พบออเดอร์ แต่ไม่มีรายการอาหาร
test("GET /api/orders/:id returns an empty items array when order has no items", async () => {
  // LEFT JOIN ทำให้ยังมีแถวของออเดอร์ แต่คอลัมน์ฝั่งรายการอาหารเป็น null
  const rows = [
    {
      orderId: 2,
      customerName: "สมหญิง",
      status: "pending",
      createdAt: "2026-01-10 12:30:00",
      menuItemId: null,
      itemName: null,
      price: null,
      quantity: null,
    },
  ];

  // จำลองผล query โดยไม่เชื่อมต่อฐานข้อมูลจริง
  jest.spyOn(pool, "query").mockResolvedValueOnce([rows, []]);

  // ขอรายละเอียดออเดอร์ที่ยังไม่มีรายการอาหาร
  const response = await request(app).get("/api/orders/2");

  // ออเดอร์ยังพบและตอบ 200 ส่วนรายการอาหารต้องเป็น array ว่าง
  expect(response.statusCode).toBe(200);
  expect(response.body.order.id).toBe(2);
  expect(response.body.order.items).toEqual([]);
});

