// ตรวจว่าเชื่อมต่อฐานข้อมูลของชุดติดตั้งได้ (npm run check)
const mysql = require("mysql2/promise");
const { db } = require("../config");

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

async function main() {
  const conn = await connectWithRetry({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
  });
  const [rows] = await conn.query("SELECT COUNT(*) AS total FROM menu_items");
  await conn.end();
  console.log(`เชื่อมต่อฐานข้อมูลได้ พบเมนู ${rows[0].total} รายการ`);
}

main().catch((err) => {
  console.error("เชื่อมต่อฐานข้อมูลไม่ได้:", err.message);
  process.exit(1);
});
