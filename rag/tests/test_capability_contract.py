"""AI 能力服务泛化契约自测（蓝图执行清单第 6 项）。

覆盖：鉴权头兼容、namespace 默认回退、scopes 过滤语义、/extract 字段契约。
运行方式（rag 目录内）：RAG_API_KEY= .venv/bin/python -m pytest tests
（RAG_API_KEY 置空以匹配 CI 无密钥环境；本地 .env 若配置了密钥，鉴权类 401 断言
需按“配置了密钥才校验”语义单独验证——本文件显式设置密钥后再断言）。
"""

import base64
import json
from pathlib import Path

import pytest
from app import main as app_main
from app.api import routes as routes_module
from app.core.config import config
from app.extraction import asset_extractor as asset_extractor_module
from app.retrieval import vector_store as vector_store_module
from app.schemas.models import ChatRequest
from fastapi import HTTPException
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    return TestClient(app_main.app)


# ---------------------------------------------------------------------------
# 1) 鉴权头兼容：X-Service-Key 与 X-API-Key 皆可；密钥未配置时不校验
# ---------------------------------------------------------------------------

def test_auth_accepts_service_key_and_legacy_key(client, monkeypatch):
    monkeypatch.setattr(config, "rag_api_key", "cap-test-key")
    assert client.get("/rag/usage").status_code == 401
    assert client.get("/rag/usage", headers={"X-API-Key": "cap-test-key"}).status_code == 200
    assert client.get("/rag/usage", headers={"X-Service-Key": "cap-test-key"}).status_code == 200
    assert client.get("/rag/usage", headers={"X-Service-Key": "wrong"}).status_code == 401
    assert client.get("/rag/usage", headers={"X-API-Key": "wrong"}).status_code == 401


def test_auth_skipped_when_key_unconfigured(client, monkeypatch):
    monkeypatch.setattr(config, "rag_api_key", "")
    assert client.get("/rag/usage", headers={}).status_code == 200


# ---------------------------------------------------------------------------
# 2) namespace 默认回退：空/电池别名 → 默认电池 collection，其余命名空间隔离
# ---------------------------------------------------------------------------

def test_namespace_resolution_defaults_to_battery_collection(monkeypatch):
    monkeypatch.setattr(config, "rag_namespace_default", "battery")
    assert vector_store_module.resolve_collection_name(None) == config.chroma_collection
    assert vector_store_module.resolve_collection_name("") == config.chroma_collection
    assert vector_store_module.resolve_collection_name("battery") == config.chroma_collection
    assert vector_store_module.resolve_collection_name(config.chroma_collection) == config.chroma_collection


def test_namespace_resolution_ep_docs_and_explicit_mapping(monkeypatch):
    monkeypatch.setenv("RAG_NAMESPACE_COLLECTION_EP_DOCS", "ep_docs_custom_v1")
    assert vector_store_module.resolve_collection_name("ep-docs") == "ep_docs_custom_v1"
    monkeypatch.delenv("RAG_NAMESPACE_COLLECTION_EP_DOCS")
    assert vector_store_module.resolve_collection_name("ep-docs") == "ns_ep_docs"
    assert vector_store_module.resolve_collection_name("ep-docs") != config.chroma_collection


def test_chat_request_accepts_ep_shape_aliases():
    request = ChatRequest.model_validate({
        "namespace": "ep-docs",
        "scopes": [{"productLine": "L1", "base": "B2"}],
        "history": [{"role": "user", "content": "绝缘电阻标准是什么"}],
        "question": "绝缘电阻测试标准是什么？",
    })
    assert request.query == "绝缘电阻测试标准是什么？"
    assert request.namespace == "ep-docs"
    assert request.scopes == [{"productLine": "L1", "base": "B2"}]
    assert request.history[0]["role"] == "user"


# ---------------------------------------------------------------------------
# 3) scopes 过滤语义（纯函数，无需 Chroma 实例）
# ---------------------------------------------------------------------------

def test_scope_where_empty_means_unrestricted():
    assert vector_store_module._scope_where(None) is None
    assert vector_store_module._scope_where([]) is None
    assert vector_store_module._scope_where([{}]) is None
    assert vector_store_module._scope_where([{"productLine": "", "base": None}]) is None


def test_scope_where_and_within_object_or_across_objects():
    single = vector_store_module._scope_where([{"productLine": "L1", "base": "B2"}])
    assert single == {"$and": [
        {"base": {"$contains": "B2"}},
        {"productLine": {"$contains": "L1"}},
    ]}
    multi = vector_store_module._scope_where([
        {"productLine": "L1"},
        {"productLine": "L2"},
    ])
    assert multi == {"$or": [
        {"productLine": {"$contains": "L1"}},
        {"productLine": {"$contains": "L2"}},
    ]}
    merged = vector_store_module._merge_where(
        {"security_level": {"$in": ["internal"]}},
        {"productLine": {"$contains": "L1"}},
    )
    assert merged == {"$and": [
        {"security_level": {"$in": ["internal"]}},
        {"productLine": {"$contains": "L1"}},
    ]}


# ---------------------------------------------------------------------------
# 4) /extract 字段契约：与 ep ExtractionResult 逐字段对齐；空字段语义 ""/[]/0.0
# ---------------------------------------------------------------------------

EXPECTED_EXTRACT_KEYS = [
    "name", "description", "assetTypeCode", "tags", "summary",
    "categoryCode", "scopeHints", "evidence", "confidence",
]


def test_extract_engine_returns_ep_contract_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "rag_allowed_dirs", [str(tmp_path)])
    monkeypatch.setattr(asset_extractor_module, "_llm_live", lambda: False)
    doc = tmp_path / "标准规范.txt"
    doc.write_text(
        "电芯分选工序规范：本文件规定电芯分选的作业要求。\n"
        "外观检测通过后进入OCV测试，测试电压1000V，交流内阻测试判定阈值不低于500MΩ，"
        "超过阈值判定为不合格并转入复测；K值自放电测试按标准窗口执行。\n"
        "所有检测记录完成后上传MES系统，由现场复核并判定放行；"
        "涉及异常需按质量异常流程隔离处置，防止不良品流入下工序。",
        encoding="utf-8",
    )
    result = asset_extractor_module.extract_asset_metadata(
        document_id="ep-docs:doc:1",
        file_path=str(doc),
        title="电芯分选工序规范",
        scopes=[{"productLine": "L1", "base": "B2"}],
        target_type="DOCUMENT",
    )
    payload = result.model_dump()
    assert list(payload.keys()) == EXPECTED_EXTRACT_KEYS
    assert payload["name"] == "电芯分选工序规范"
    assert isinstance(payload["summary"], str) and payload["summary"]
    assert isinstance(payload["tags"], list) and payload["tags"]
    assert isinstance(payload["evidence"], list) and payload["evidence"]
    # scope 维度值作为 hints 带回
    assert set(payload["scopeHints"]) == {"L1", "B2"}
    # 离线确定性路径：代码类字段无依据留空、置信度有界
    assert payload["assetTypeCode"] == ""
    assert payload["categoryCode"] == ""
    assert 0.0 <= payload["confidence"] <= 1.0


def test_extract_engine_empty_content_refuses_with_empty_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "rag_allowed_dirs", [str(tmp_path)])
    monkeypatch.setattr(asset_extractor_module, "_llm_live", lambda: False)
    empty = tmp_path / "empty.txt"
    empty.write_text("\n  \n", encoding="utf-8")
    payload = asset_extractor_module.extract_asset_metadata(
        document_id="empty-doc",
        file_path=str(empty),
        title="",
    ).model_dump()
    assert list(payload.keys()) == EXPECTED_EXTRACT_KEYS
    assert payload["name"] == "empty-doc"
    assert payload["confidence"] == 0.0
    assert payload["evidence"] == []
    assert payload["tags"] == []
    assert payload["summary"] == ""


def test_extract_route_contract_and_auth(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "rag_allowed_dirs", [str(tmp_path)])
    monkeypatch.setattr(config, "rag_api_key", "cap-route-key")
    monkeypatch.setattr(asset_extractor_module, "_llm_live", lambda: False)
    doc = tmp_path / "分选.txt"
    doc.write_text("分选工序规范：外观检测、OCV 测试与内阻判定流程。", encoding="utf-8")
    response = client.post(
        "/rag/extract",
        json={
            "namespace": "ep-docs",
            "targetType": "DOCUMENT",
            "targetId": 42,
            "title": "分选工序规范",
            "scopes": [{"base": "B2"}],
            "document_id": "ep-docs:doc:42",
            "file_path": str(doc),
        },
        headers={"X-Service-Key": "cap-route-key"},
    )
    assert response.status_code == 200
    assert list(response.json().keys()) == EXPECTED_EXTRACT_KEYS
    # 鉴权：错误/缺失密钥 401
    assert client.post(
        "/rag/extract",
        json={"document_id": "a", "file_path": str(doc)},
        headers={},
    ).status_code == 401
    assert client.post(
        "/rag/extract",
        json={"document_id": "a", "file_path": str(doc)},
        headers={"X-Service-Key": "nope"},
    ).status_code == 401
    # 纯 ep 形态缺 file_path：字节运输未定 → 400 明确提示
    missing_file = client.post(
        "/rag/extract",
        json={"namespace": "ep-docs", "targetType": "DOCUMENT", "targetId": 43,
              "title": "x", "scopes": []},
        headers={"X-Service-Key": "cap-route-key"},
    )
    assert missing_file.status_code == 400
    assert "file_path" in missing_file.json()["detail"]


# ---------------------------------------------------------------------------
# 5) 入库源解析：ep targetId 回退、file_path 与 fileContentBase64 双运输形态
# ---------------------------------------------------------------------------

def test_require_ingest_source_file_path_shape(tmp_path, monkeypatch):
    from app.schemas.models import IngestRequest
    monkeypatch.setattr(config, "rag_allowed_dirs", [str(tmp_path)])
    doc = tmp_path / "a.txt"
    doc.write_text("x", encoding="utf-8")
    request = IngestRequest.model_validate({
        "namespace": "ep-docs", "targetType": "DOCUMENT", "targetId": 7,
        "title": "样例", "scopes": [],
        "file_path": str(doc),
    })
    document_id, file_path, temp_path = routes_module._require_ingest_source(request)
    assert document_id == "ep-docs:DOCUMENT:7"
    assert file_path == str(doc)
    assert temp_path is None
    without_file = IngestRequest.model_validate({
        "namespace": "ep-docs", "targetType": "DOCUMENT", "targetId": 8,
        "title": "样例", "scopes": [],
    })
    with pytest.raises(HTTPException) as excinfo:
        routes_module._require_ingest_source(without_file)
    assert excinfo.value.status_code == 400


def test_require_ingest_source_base64_stages_into_allowed_dir(tmp_path, monkeypatch):
    from app.schemas.models import IngestRequest
    monkeypatch.setattr(config, "rag_allowed_dirs", [str(tmp_path)])
    request = IngestRequest.model_validate({
        "namespace": "ep-docs", "targetType": "DOCUMENT", "targetId": 9,
        "title": "样例", "scopes": [],
        "fileContentBase64": base64.b64encode("分选工序字节内容".encode()).decode("ascii"),
        "fileName": "分选规范.txt",
    })
    document_id, file_path, temp_path = routes_module._require_ingest_source(request)
    assert document_id == "ep-docs:DOCUMENT:9"
    assert temp_path == file_path
    staged = Path(file_path)
    assert staged.is_file()
    assert staged.resolve().is_relative_to(Path(str(tmp_path)).resolve())
    assert staged.name.endswith(".txt")
    staged.unlink(missing_ok=True)  # 等价调用方 finally 清理


def test_require_ingest_source_base64_validation(tmp_path, monkeypatch):
    from app.schemas.models import IngestRequest
    monkeypatch.setattr(config, "rag_allowed_dirs", [str(tmp_path)])
    bad_b64 = IngestRequest.model_validate({
        "namespace": "ep-docs", "targetId": 10, "scopes": [],
        "fileContentBase64": "!!!not-base64!!!", "fileName": "a.txt",
    })
    with pytest.raises(ValueError):
        routes_module._require_ingest_source(bad_b64)
    no_name = IngestRequest.model_validate({
        "namespace": "ep-docs", "targetId": 11, "scopes": [],
        "fileContentBase64": base64.b64encode(b"x").decode("ascii"),
    })
    with pytest.raises(HTTPException) as excinfo:
        routes_module._require_ingest_source(no_name)
    assert excinfo.value.status_code == 400
    no_ext = IngestRequest.model_validate({
        "namespace": "ep-docs", "targetId": 12, "scopes": [],
        "fileContentBase64": base64.b64encode(b"x").decode("ascii"), "fileName": "规范",
    })
    with pytest.raises(HTTPException) as excinfo:
        routes_module._require_ingest_source(no_ext)
    assert excinfo.value.status_code == 400


# ---------------------------------------------------------------------------
# 6) fileContentBase64 字节运输路由链路
# ---------------------------------------------------------------------------

def test_extract_route_accepts_file_content_base64(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "rag_allowed_dirs", [str(tmp_path)])
    monkeypatch.setattr(config, "rag_api_key", "cap-b64-key")
    monkeypatch.setattr(asset_extractor_module, "_llm_live", lambda: False)
    content = (
        "电芯分选工序规范：本文件规定电芯分选工序的作业要求。\n"
        "外观检测通过后进入OCV测试，测试电压1000V，交流内阻判定阈值不高于500MΩ，"
        "超过阈值转入复测并隔离处置。\n"
        "所有检测记录完成后上传MES系统复核放行。"
    )
    response = client.post(
        "/rag/extract",
        json={
            "namespace": "ep-docs", "targetType": "DOCUMENT", "targetId": 90,
            "title": "电芯分选工序规范", "scopes": [],
            "fileContentBase64": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "fileName": "电芯分选工序规范.txt",
        },
        headers={"X-Service-Key": "cap-b64-key"},
    )
    assert response.status_code == 200, response.text
    assert list(response.json().keys()) == EXPECTED_EXTRACT_KEYS
    # 路由 finally 应清理暂存文件
    staged_root = Path(str(tmp_path)) / "capability-staging"
    leftovers = [f for f in staged_root.glob("**/*") if f.is_file()] if staged_root.exists() else []
    assert leftovers == []


def test_ingest_route_accepts_file_content_base64(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "rag_allowed_dirs", [str(tmp_path)])
    monkeypatch.setattr(config, "rag_api_key", "cap-b64-key")
    captured: dict = {}

    def fake_ingest(document_id, file_path, metadata=None, namespace=None, scopes=None):
        captured["document_id"] = document_id
        captured["file_path"] = file_path
        captured["namespace"] = namespace
        captured["scopes"] = scopes
        return {"document_id": document_id, "chunk_count": 1, "index_status": "ready"}

    monkeypatch.setattr(routes_module.pipeline, "ingest_document", fake_ingest)
    response = client.post(
        "/rag/documents/ingest",
        json={
            "namespace": "ep-docs", "targetType": "DOCUMENT", "targetId": 91,
            "title": "电芯分选工序规范", "scopes": [{"productLine": "L1"}],
            "fileContentBase64": base64.b64encode("电芯分选工序字节".encode()).decode("ascii"),
            "fileName": "分选规范.txt",
        },
        headers={"X-Service-Key": "cap-b64-key"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["document_id"] == "ep-docs:DOCUMENT:91"
    assert body["ok"] is True
    assert captured["namespace"] == "ep-docs"
    assert captured["scopes"] == [{"productLine": "L1"}]
    staged = Path(captured["file_path"])
    assert staged.is_relative_to(Path(str(tmp_path)).resolve())
    assert not staged.exists()  # finally 已清理暂存文件


# ---------------------------------------------------------------------------
# 7) 联调契约样本 fixture 存在且 JSON 合法（帮助 ep 侧联调）
# ---------------------------------------------------------------------------

def test_ep_contract_sample_fixture_is_valid_json():
    fixture_path = "tests/fixtures/ep_capability_requests.json"
    with open(fixture_path, encoding="utf-8") as f:
        payload = json.load(f)
    assert "chat_stream" in payload
    assert "documents_ingest" in payload
    assert "extract" in payload
    # 字节运输样本可解码（帮助 ep 直接联调）
    for key in ("documents_ingest", "extract"):
        sample = payload[key]
        assert sample.get("fileName", "").endswith(".txt")
        decoded = base64.b64decode(sample["fileContentBase64"], validate=True)
        assert decoded
    # ep 三个请求都只带 namespace/scopes 等契约字段
    for key in ("chat_stream", "documents_ingest", "extract"):
        assert isinstance(payload[key], dict)
