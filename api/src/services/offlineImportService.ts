import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createDocument, updateDocument } from "../db/documents";
import { ingestDocument } from "./ragClient";

const OFFLINE_EXTENSIONS: Record<string, string> = {
  ".csv": "csv",
  ".json": "json",
  ".pdf": "pdf",
};

export interface OfflineImportInput {
  packagePath: string;
  sourceSystem: string;
  category: string;
  securityLevel: string;
  process?: string;
  station?: string;
  version?: string;
  owner?: string;
  tags?: string[];
  createdBy?: string;
  requestId?: string;
}

function importRoot(): string {
  return path.resolve(process.env.OFFLINE_IMPORT_ROOT || "./data/offline-import");
}

function resolvePackagePath(packagePath: string): string {
  const root = importRoot();
  const resolved = path.isAbsolute(packagePath)
    ? path.resolve(packagePath)
    : path.resolve(root, packagePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`离线导入目录必须位于 ${root} 内。`);
  }
  return resolved;
}

function walkFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(fullPath));
    } else if (entry.isFile() && OFFLINE_EXTENSIONS[path.extname(entry.name).toLowerCase()]) {
      result.push(fullPath);
    }
  }
  return result.sort();
}

function fileHash(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function titleFromFile(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

export async function importOfflinePackage(input: OfflineImportInput) {
  const packageDir = resolvePackagePath(input.packagePath);
  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    throw new Error("离线导入目录不存在或不是目录。");
  }

  const files = walkFiles(packageDir).slice(0, 500);
  const results = [];
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    const fileType = OFFLINE_EXTENSIONS[ext];
    const stat = fs.statSync(filePath);
    const doc = createDocument({
      title: titleFromFile(filePath),
      category: input.category,
      process: input.process,
      station: input.station,
      version: input.version,
      owner: input.owner,
      securityLevel: input.securityLevel,
      tags: [...(input.tags ?? []), input.sourceSystem].filter(Boolean),
      filePath,
      fileName: path.basename(filePath),
      fileType,
      fileSize: stat.size,
      fileHash: fileHash(filePath),
      createdBy: input.createdBy,
    });

    updateDocument(doc.id, { indexStatus: "processing" });
    try {
      const ingest = await ingestDocument(doc.id, filePath, {
        title: doc.title,
        category: doc.category,
        security_level: doc.security_level,
        process: doc.process ?? undefined,
        station: doc.station ?? undefined,
        version: doc.version,
        tags: JSON.parse(doc.tags_json || "[]"),
      }, input.requestId);
      updateDocument(doc.id, {
        indexStatus: ingest.index_status || "ready",
        chunkCount: ingest.chunk_count,
      });
      results.push({ document_id: doc.id, file_name: doc.file_name, status: "ready", chunk_count: ingest.chunk_count });
    } catch (error) {
      const message = error instanceof Error ? error.message : "离线导入索引失败";
      updateDocument(doc.id, { indexStatus: "failed", indexError: message });
      results.push({ document_id: doc.id, file_name: doc.file_name, status: "failed", error: message });
    }
  }

  return {
    package_path: packageDir,
    source_system: input.sourceSystem,
    accepted_extensions: Object.values(OFFLINE_EXTENSIONS),
    total: results.length,
    items: results,
  };
}

