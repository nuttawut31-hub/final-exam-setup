// เทสต์ตรวจว่าเครื่องมือทั้งหมดทำงานร่วมกันได้ (npm test)
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const { db, jwtSecret } = require("../config");

// รอให้ MySQL พร้อมรับการเชื่อมต่อ (คอนเทนเนอร์เพิ่งเริ่มอาจยังไม่พร้อมไม่กี่วินาที)
async function connectWithRetry(options, attempts = 30) {
  for (let i = 1; ; i++) {
    try {
      return await mysql.createConnection(options);
    } catch (err) {
      if (i === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

describe("ตรวจสภาพแวดล้อม", () => {
  it("เชื่อมต่อฐานข้อมูลได้และมีข้อมูลเมนู", async () => {
    const conn = await connectWithRetry({
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.database,
    });
    const [rows] = await conn.query("SELECT COUNT(*) AS total FROM menu_items");
    await conn.end();
    expect(rows[0].total).toBeGreaterThanOrEqual(20);
  });

  it("Express และ Supertest ทำงานได้", async () => {
    const app = express();
    app.get("/ping", (req, res) => res.status(200).json({ ok: true }));
    const res = await request(app).get("/ping");
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("สร้างและตรวจ JWT ได้", () => {
    const token = jwt.sign({ id: 1, role: "customer" }, jwtSecret);
    const payload = jwt.verify(token, jwtSecret);
    expect(payload.role).toBe("customer");
  });
});
