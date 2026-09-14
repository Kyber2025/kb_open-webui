"""Small, bounded metadata tasks and real conversation attribution."""
import hashlib
import json
import re
import uuid
from urllib.parse import urlparse


def conversation_headers(url, billing_base, metadata):
    # Send only to the configured platform host, never unrelated model providers.
    if not billing_base or urlparse(url).hostname != urlparse(billing_base).hostname:
        return {}
    value = (metadata or {}).get('chat_id')
    if isinstance(value, str) and re.fullmatch(r'[\x21-\x7e]{1,256}', value):
        return {'session_id': value}
    return {}


def title_messages(messages):
    # A title needs the first question, not the entire conversation/tool history.
    for message in messages or []:
        if message.get('role') != 'user':
            continue
        content = message.get('content')
        if isinstance(content, list):
            content = '\n'.join(str(p.get('text', '')) for p in content if p.get('type') == 'text')
        if isinstance(content, str) and content.strip():
            return [{'role': 'user', 'content': content[:1200]}]
    return []


async def title_once(redis, user_id, chat_id, generate):
    """Share a completed title for a week; serialize duplicate requests across nodes.

    Optional titles fail closed if coordination is unavailable, avoiding duplicate
    billed inference. No user text or identity is stored in the Redis key.
    """
    skip = None
    if redis is None or not isinstance(chat_id, str) or not chat_id:
        return skip
    digest = hashlib.sha256(json.dumps([str(user_id), chat_id]).encode()).hexdigest()
    key = f'kyber:title:{digest}'
    lock = key + ':lock'
    owner = uuid.uuid4().hex
    try:
        cached = await redis.get(key)
        if cached:
            return json.loads(cached)
        if not await redis.set(lock, owner, nx=True, ex=900):
            return skip
    except Exception:
        return skip
    try:
        # The preceding lock holder may have completed between GET and SET NX.
        cached = await redis.get(key)
        if cached:
            return json.loads(cached)
        result = await generate()
        if isinstance(result, dict) and result.get('choices') and not result.get('error'):
            await redis.set(key, json.dumps(result), ex=7 * 86400)
        return result
    finally:
        try:
            await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end return 0", 1, lock, owner)
        except Exception:
            pass
