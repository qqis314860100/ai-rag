from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Mapping, Sequence

from app.artifacts.knowledge_assets import build_published_asset_retrieval_terms


@dataclass(frozen=True)
class FailedQuestionEvalCase:
    id: str
    question: str
    expected_terms: tuple[str, ...] = ()
    expected_asset_ids: tuple[str, ...] = ()
    event_type: str = "refusal"


@dataclass(frozen=True)
class FailedQuestionEvalOutcome:
    case_id: str
    matched_asset_ids: tuple[str, ...]
    matched_terms: tuple[str, ...]
    expected_asset_hit: bool
    would_refuse: bool


@dataclass(frozen=True)
class FailedQuestionEvalMetrics:
    total: int
    recall_rate: float
    false_refusal_rate: float
    strong_asset_hit_rate: float
    expected_asset_hit_rate: float


@dataclass(frozen=True)
class FailedQuestionLoopEvalReport:
    schema_version: str = "knowledge-gap-loop-eval/v1"
    before: FailedQuestionEvalMetrics = field(default_factory=lambda: FailedQuestionEvalMetrics(0, 0.0, 0.0, 0.0, 0.0))
    after: FailedQuestionEvalMetrics = field(default_factory=lambda: FailedQuestionEvalMetrics(0, 0.0, 0.0, 0.0, 0.0))
    recall_delta: float = 0.0
    false_refusal_delta: float = 0.0
    strong_asset_hit_delta: float = 0.0
    outcomes_before: tuple[FailedQuestionEvalOutcome, ...] = ()
    outcomes_after: tuple[FailedQuestionEvalOutcome, ...] = ()

    @property
    def improved(self) -> bool:
        return self.recall_delta > 0 and self.false_refusal_delta < 0


def evaluate_failed_question_learning_loop(
    cases: Sequence[FailedQuestionEvalCase],
    *,
    before_assets: Sequence[Mapping[str, Any]] = (),
    after_assets: Sequence[Mapping[str, Any]] = (),
) -> FailedQuestionLoopEvalReport:
    before_outcomes = tuple(_evaluate_case(case, before_assets) for case in cases)
    after_outcomes = tuple(_evaluate_case(case, after_assets) for case in cases)
    before_metrics = _metrics(before_outcomes)
    after_metrics = _metrics(after_outcomes)
    return FailedQuestionLoopEvalReport(
        before=before_metrics,
        after=after_metrics,
        recall_delta=round(after_metrics.recall_rate - before_metrics.recall_rate, 4),
        false_refusal_delta=round(after_metrics.false_refusal_rate - before_metrics.false_refusal_rate, 4),
        strong_asset_hit_delta=round(after_metrics.strong_asset_hit_rate - before_metrics.strong_asset_hit_rate, 4),
        outcomes_before=before_outcomes,
        outcomes_after=after_outcomes,
    )


def _evaluate_case(case: FailedQuestionEvalCase, assets: Sequence[Mapping[str, Any]]) -> FailedQuestionEvalOutcome:
    matched_assets: list[str] = []
    matched_terms: list[str] = []
    for asset in assets:
        asset_id = str(asset.get("id") or "")
        retrieval_terms = build_published_asset_retrieval_terms(asset)
        terms = _matching_terms(case, retrieval_terms)
        if not terms:
            continue
        if asset_id:
            matched_assets.append(asset_id)
        matched_terms.extend(terms)

    matched_asset_ids = tuple(_dedupe(matched_assets))
    return FailedQuestionEvalOutcome(
        case_id=case.id,
        matched_asset_ids=matched_asset_ids,
        matched_terms=tuple(_dedupe(matched_terms)),
        expected_asset_hit=bool(set(case.expected_asset_ids).intersection(matched_asset_ids)),
        would_refuse=not matched_asset_ids,
    )


def _metrics(outcomes: Sequence[FailedQuestionEvalOutcome]) -> FailedQuestionEvalMetrics:
    total = len(outcomes)
    if total == 0:
        return FailedQuestionEvalMetrics(total=0, recall_rate=0.0, false_refusal_rate=0.0, strong_asset_hit_rate=0.0, expected_asset_hit_rate=0.0)

    recalled = sum(1 for item in outcomes if not item.would_refuse)
    false_refusals = sum(1 for item in outcomes if item.would_refuse)
    strong_hits = sum(1 for item in outcomes if item.matched_asset_ids)
    expected_hits = sum(1 for item in outcomes if item.expected_asset_hit)
    return FailedQuestionEvalMetrics(
        total=total,
        recall_rate=round(recalled / total, 4),
        false_refusal_rate=round(false_refusals / total, 4),
        strong_asset_hit_rate=round(strong_hits / total, 4),
        expected_asset_hit_rate=round(expected_hits / total, 4),
    )


def _matching_terms(case: FailedQuestionEvalCase, retrieval_terms: Sequence[str]) -> list[str]:
    text = _normalize(case.question)
    expected = {_normalize(term) for term in case.expected_terms if term.strip()}
    matches: list[str] = []
    for term in retrieval_terms:
        normalized = _normalize(term)
        if not normalized:
            continue
        # 评估只判断发布资产是否能召回同类问题，不把任意短词命中当作有效改善。
        if normalized in expected or normalized in text or any(expected_term in normalized for expected_term in expected):
            matches.append(term)
    return matches


def _normalize(value: str) -> str:
    return re.sub(r"[\s，,。.!！?？:：;；/\\-]+", "", value).lower()


def _dedupe(values: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
