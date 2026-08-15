import type Database from "better-sqlite3";
import { createArtifactIndexes, createArtifactTables } from "./artifacts";
import { createChatIndexes, createChatTables } from "./chat";
import { createDocumentIndexes, createDocumentTables } from "./documents";
import { createIdentityIndexes, createIdentityTables } from "./identity";
import { createKnowledgeIndexes, createKnowledgeTables } from "./knowledge";
import { createPlatformIndexes, createPlatformTables } from "./platform";

export function createTables(database: Database.Database): void {
  createTablesV2(database);
}

export function createTablesV2(database: Database.Database): void {
  createIdentityTables(database);
  createDocumentTables(database);
  createChatTables(database);
  createArtifactTables(database);
  createKnowledgeTables(database);
  createPlatformTables(database);

  createIdentityIndexes(database);
  createDocumentIndexes(database);
  createChatIndexes(database);
  createArtifactIndexes(database);
  createKnowledgeIndexes(database);
  createPlatformIndexes(database);
}
