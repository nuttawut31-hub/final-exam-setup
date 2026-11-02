const request = require("supertest");
const app = require("./order-detail-retry");
const { pool } = require("../db");

afterEach(() => {
  jest.restoreAllMocks();
});

test("GET /api/orders/:id returns an order with its items", async () => {
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
  ];

  jest.spyOn(pool, "query").mockResolvedValueOnce([rows, []]);

  const response = await request(app).get("/api/orders/1");

  expect(response.statusCode).toBe(200);
  expect(response.body.order.items).toEqual([
    { menuItemId: 1, name: "ข้าวผัดกุ้ง", price: 60, quantity: 2 },
  ]);
  expect(pool.query).toHaveBeenCalledWith(
    expect.stringContaining("WHERE o.id = ?"),
    [1],
  );
});

test.each(["abc", "0", "-1", "1.5"])(
  "GET /api/orders/%s returns 400 for invalid id",
  async (id) => {
    jest.spyOn(pool, "query").mockResolvedValue([[], []]);

    const response = await request(app).get(`/api/orders/${id}`);

    expect(response.statusCode).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  },
);

test("GET /api/orders/:id returns 404 when order is not found", async () => {
  // จำลอง query ที่สำเร็จแต่ไม่พบแถวข้อมูล
  jest.spyOn(pool, "query").mockResolvedValueOnce([[], []]);

  const response = await request(app).get("/api/orders/9999");

  expect(response.statusCode).toBe(404);
});

test("GET /api/orders/:id returns 500 when database query fails", async () => {
  // จำลองให้ query โยน error เหมือนฐานข้อมูลมีปัญหา
  jest.spyOn(pool, "query").mockRejectedValueOnce(new Error("DB error"));

  // route เรียก console.error ใน catch; ซ่อนไว้ไม่ให้รบกวนผลเทสต์
  jest.spyOn(console, "error").mockImplementation(() => {});

  // id ถูกต้อง จึงผ่าน validation แล้วไปถึง query
  const response = await request(app).get("/api/orders/1");

  // route ต้องจับ error และตอบ 500 พร้อมข้อความตามที่กำหนด
  expect(response.statusCode).toBe(500);
  expect(response.body.error).toBe("ไม่สามารถดึงข้อมูลออเดอร์ได้");
});