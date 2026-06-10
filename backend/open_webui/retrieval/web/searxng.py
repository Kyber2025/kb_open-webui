from __future__ import annotations

import hashlib
import json
import logging
import os

from open_webui.retrieval.web.main import SearchResult, get_filtered_results
from open_webui.utils.redis import get_redis_client
from open_webui.utils.session_pool import get_session

log = logging.getLogger(__name__)

# SearXNG request headers — identifies the bot to instance operators.
_SEARXNG_HEADERS = {
    'User-Agent': 'Open WebUI (https://github.com/open-webui/open-webui) RAG Bot',
    'Accept': 'text/html',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
}

# SERP cache: identical searches within the TTL are served from Redis instead
# of hitting SearXNG (whose uWSGI worker pool is the throughput choke point
# when web search runs per-message). 0 disables. Best-effort: no Redis or any
# Redis error → search normally.
WEB_SEARCH_CACHE_TTL = int(os.environ.get('WEB_SEARCH_CACHE_TTL', '1200'))

_redis_client = None
_redis_tried = False


def _get_cache():
    global _redis_client, _redis_tried
    if not _redis_tried:
        _redis_tried = True
        _redis_client = get_redis_client(async_mode=True)
    return _redis_client


def _cache_key(query_url: str, query: str, count: int, params: dict) -> str:
    payload = json.dumps(
        {'u': query_url, 'q': query.strip().lower(), 'n': count, 'p': params},
        sort_keys=True,
        ensure_ascii=False,
    )
    return 'websearch:searxng:' + hashlib.sha256(payload.encode('utf-8')).hexdigest()


async def search_searxng(
    query_url: str,
    query: str,
    count: int,
    filter_list: list[str | None] | None = None,
    **kwargs,
) -> list[SearchResult]:
    """Query a SearXNG instance and return results sorted by relevance score.

    Optional keyword arguments (language, safesearch, time_range, categories)
    are forwarded directly as SearXNG query parameters.
    """
    # Normalise legacy ``<query>``-style URLs by stripping any query string.
    if '<query>' in query_url:
        query_url = query_url.split('?')[0]

    params = {
        'q': query,
        'format': 'json',
        'pageno': 1,
        'safesearch': kwargs.get('safesearch', '1'),
        'language': kwargs.get('language', 'all').strip().rstrip(','),
        'time_range': kwargs.get('time_range', ''),
        'categories': ''.join(kwargs.get('categories', [])),
        'theme': 'simple',
        'image_proxy': 0,
    }

    log.debug('searching %s', query_url)

    # Filter list participates in the key: different filters → different results.
    cache_key = _cache_key(query_url, query, count, {**params, 'f': filter_list or []})
    cache = _get_cache() if WEB_SEARCH_CACHE_TTL > 0 else None
    if cache is not None:
        try:
            cached = await cache.get(cache_key)
            if cached:
                return [SearchResult(**item) for item in json.loads(cached)]
        except Exception:
            log.debug('searxng cache read failed', exc_info=True)

    session = await get_session()
    async with session.get(query_url, headers=_SEARXNG_HEADERS, params=params) as response:
        response.raise_for_status()
        payload = await response.json()

    results = sorted(payload.get('results', []), key=lambda x: x.get('score', 0), reverse=True)
    if filter_list:
        results = get_filtered_results(results, filter_list)

    search_results = [
        SearchResult(
            link=item.get('url', ''),
            title=item.get('title'),
            snippet=item.get('content'),
        )
        for item in results[:count]
    ]

    if cache is not None and search_results:
        try:
            await cache.set(
                cache_key,
                json.dumps([r.model_dump() for r in search_results], ensure_ascii=False),
                ex=WEB_SEARCH_CACHE_TTL,
            )
        except Exception:
            log.debug('searxng cache write failed', exc_info=True)

    return search_results
