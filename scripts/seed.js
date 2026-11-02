// รัน seed.sql เข้า exam_db (npm run seed)
const fs = require("fs");
const path = require("path");
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
  const sql = fs.readFileSync(path.join(__dirname, "..", "seed.sql"), "utf8");
  const conn = await connectWithRetry({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
    multipleStatements: true,
  });
  await conn.query(sql);
  await conn.end();
  console.log("seed exam_db สำเร็จ");
}

main().catch((err) => {
  console.error("seed ไม่สำเร็จ:", err.message);
  process.exit(1);
});
