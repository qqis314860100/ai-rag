import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { seedDefaultTerminology } from "../terminology";

export function seedData(database: Database.Database): void {
  const now = new Date().toISOString();

  const userCount = database.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count === 0) {
    const insertUser = database.prepare(
      "INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    const users = [
      { name: "admin", email: "admin@battery.local", password: "admin123", role: "system_admin" },
      { name: "editor", email: "editor@battery.local", password: "editor123", role: "knowledge_admin" },
      { name: "viewer", email: "viewer@battery.local", password: "viewer123", role: "viewer" },
      { name: "system", email: "system@battery.local", password: uuidv4(), role: "system_admin" },
    ];

    const insertUsers = database.transaction(() => {
      for (const u of users) {
        insertUser.run(uuidv4(), u.name, u.email, bcrypt.hashSync(u.password, 10), u.role, "active", now, now);
      }
    });
    insertUsers();
  }

  const systemUser = database.prepare("SELECT id FROM users WHERE name='system' LIMIT 1").get() as { id: string } | undefined;
  if (systemUser) {
    database.prepare("INSERT OR REPLACE INTO settings (key, value, value_type, description, updated_at) VALUES ('system_user_id', ?, 'string', 'Default user ID for unauthenticated requests', ?)")
      .run(systemUser.id, now);
  }

  const roleCount = database.prepare("SELECT COUNT(*) as count FROM roles").get() as { count: number };
  if (roleCount.count === 0) {
    const insertRole = database.prepare("INSERT INTO roles (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
    for (const [id, name, desc] of [
      ["role_viewer", "viewer", "只读用户"],
      ["role_operator", "operator", "产线操作员"],
      ["role_process_engineer", "process_engineer", "工艺工程师"],
      ["role_equipment_engineer", "equipment_engineer", "设备工程师"],
      ["role_quality_engineer", "quality_engineer", "质量工程师"],
      ["role_knowledge_admin", "knowledge_admin", "知识库管理员"],
      ["role_system_admin", "system_admin", "系统管理员"],
    ]) {
      insertRole.run(id, name, desc, now, now);
    }
  }

  const settingsCount = database.prepare("SELECT COUNT(*) as count FROM settings").get() as { count: number };
  if (settingsCount.count === 0) {
    const insertSetting = database.prepare("INSERT INTO settings (key, value, value_type, description, updated_at) VALUES (?, ?, ?, ?, ?)");
    for (const [key, value, valueType, desc] of [
      ["rag_top_k", "5", "number", "默认检索 TopK"],
      ["rag_temperature", "0.2", "number", "默认模型温度"],
      ["rag_max_context_chars", "12000", "number", "RAG 最大上下文字符数"],
      ["embedding_model", "BAAI/bge-small-zh-v1.5", "string", "默认 embedding 模型"],
      ["chroma_collection", "battery_line_knowledge_v1", "string", "默认 ChromaDB collection"],
    ]) {
      insertSetting.run(key, value, valueType, desc, now);
    }
  }

  seedDefaultTerminology(database);
}
