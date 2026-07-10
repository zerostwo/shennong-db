from collections.abc import Awaitable, Callable

from shennong_db.cache import AsyncQueryCache, stable_cache_key
from shennong_db.schemas.semantic import SemanticQueryResponse


async def cached_semantic_query_response(
    *,
    cache: AsyncQueryCache,
    namespace: str,
    payload: dict,
    ttl_seconds: int,
    producer: Callable[[], Awaitable[SemanticQueryResponse]],
) -> SemanticQueryResponse:
    key = stable_cache_key(namespace, payload)

    async def produce_dict() -> dict:
        response = await producer()
        return response.model_dump(mode="json")

    data, cached = await cache.get_or_set(key, ttl_seconds, produce_dict)
    response = SemanticQueryResponse.model_validate(data)
    return response.model_copy(update={"meta": response.meta.model_copy(update={"cached": cached})})
